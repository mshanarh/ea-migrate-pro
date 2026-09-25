/**
 * Supabase server functions — the ONLY place the service-role key is used.
 * Runs on the server; the key never reaches the browser. The service role
 * bypasses RLS, so the admin page's Approve / Make Admin buttons can never
 * be blocked by row-level policies.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAILS } from "./auth-store";
import { supabase as anonClient, supabaseConfigured } from "./supabase";
import type { UserRow } from "./supabase";

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type FlagInput = { email: string; value: boolean };
type EmailInput = { email: string };

/**
 * Full user list for /app/admin — newest registrations first.
 *
 * Uses the service-role key when present; otherwise falls back to the anon
 * key, which RLS allows to read every row (see supabase/schema.sql). The
 * anon fallback keeps the admin list working on any host that doesn't get
 * the secret key (the anon key is public by design).
 */
export const adminListUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean; users: UserRow[]; error?: string }> => {
    const db = serviceClient();
    const client = db ?? (supabaseConfigured ? anonClient : null);
    if (!client) return { enabled: false, users: [], error: "Supabase is not configured" };
    const listClient = client as NonNullable<ReturnType<typeof serviceClient>>;
    const { data, error } = await listClient
      .from("users")
      .select("id, email, is_paid, is_admin, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { enabled: true, users: [], error: error.message };
    return { enabled: true, users: (data ?? []) as UserRow[] };
  },
);

/** Approve button — sets is_paid = value for one email. */
export const adminSetUserPaid = createServerFn({ method: "POST" })
  .validator((data: FlagInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const db = serviceClient();
    if (!db) return { ok: false, error: "Supabase is not configured" };
    const { error } = await db
      .from("users")
      .update({ is_paid: data.value })
      .eq("email", data.email.toLowerCase());
    return error ? { ok: false, error: error.message } : { ok: true };
  });

/** Make Admin button — sets is_admin = value for one email. */
export const adminSetUserAdmin = createServerFn({ method: "POST" })
  .validator((data: FlagInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const db = serviceClient();
    if (!db) return { ok: false, error: "Supabase is not configured" };
    const { error } = await db
      .from("users")
      .update({ is_admin: data.value })
      .eq("email", data.email.toLowerCase());
    return error ? { ok: false, error: error.message } : { ok: true };
  });

/**
 * First-admin bootstrap: while the users table has NO admin at all, the
 * platform owner (OWNER_EMAILS) may claim the role on /app/admin. Once any
 * admin exists this always refuses — new admins are created with the
 * Make Admin button by an existing admin.
 */
export const adminClaimFirstAdmin = createServerFn({ method: "POST" })
  .validator((data: EmailInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const db = serviceClient();
    if (!db) return { ok: false, error: "Supabase is not configured" };
    const email = data.email.toLowerCase();
    if (!OWNER_EMAILS.includes(email)) return { ok: false, error: "Only the platform owner can bootstrap the first admin" };
    const { count } = await db
      .from("users")
      .select("email", { count: "exact", head: true })
      .eq("is_admin", true);
    if ((count ?? 0) > 0) return { ok: false, error: "An admin already exists" };
    const { error } = await db.from("users").update({ is_admin: true }).eq("email", email);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
