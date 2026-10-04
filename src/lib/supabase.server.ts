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

/**
 * Whop membership verification — SERVER-side, using WHOP_API_KEY (a secret
 * that must be set in the production environment; the anon key is public).
 * This is the only trustworthy answer to "did this email actually pay?":
 * the ?success=true URL parameter is forged by typing the URL, which is
 * exactly how a non-payer unlocked the app before this check existed.
 */
export const whopVerifyMembership = createServerFn({ method: "POST" })
  .validator((data: EmailInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; paid: boolean; error?: string }> => {
    const apiKey = (process.env["WHOP_API_KEY"] ?? process.env["VITE_WHOP_API_KEY"] ?? "").trim();
    const productId = (process.env["WHOP_PRODUCT_ID"] ?? process.env["VITE_WHOP_PRODUCT_ID"] ?? "").trim();
    if (!apiKey) return { ok: false, paid: false, error: "WHOP_API_KEY is not configured" };
    // AN UNSCOPED WHOP QUERY CANNOT PROVE PAYMENT, SO IT IS NOT ASKED.
    // `product` is what narrows the membership list to OUR product. Without it
    // the API answers with every membership on the account, so a person who
    // ever bought anything from any other seller on Whop would be confirmed as
    // a paying customer of this one — and this is a path that opens the app
    // without an entry in the payment ledger. That is precisely the "not marked
    // paid, still got in" case, so an unset product id answers "no" rather than
    // falling back to a broader-than-honest query. Set WHOP_PRODUCT_ID (or
    // VITE_WHOP_PRODUCT_ID) to re-enable this.
    if (!productId) return { ok: false, paid: false, error: "WHOP_PRODUCT_ID is not configured" };
    try {
      const url = new URL("https://api.whop.com/api/v1/memberships");
      url.searchParams.set("page_size", "100");
      if (productId) url.searchParams.set("product", productId);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, paid: false, error: `Whop API ${response.status}` };
      }
      const payload = (await response.json()) as {
        data?: Array<{ status?: string; user?: { email?: string } }>;
      };
      const clean = data.email.trim().toLowerCase();
      const paid = (payload.data ?? []).some(
        (membership) =>
          membership.user?.email?.trim().toLowerCase() === clean &&
          (membership.status === "active" || membership.status === "trialing" || membership.status === "past_due"),
      );
      if (paid) {
        // NO WRITES HERE. This check used to "back-fill" `users.is_paid = true`
        // so future checks would be database-only, and that single line is how
        // accounts the owner never marked paid ended up on the console's Paid
        // list anyway. `WHOP_PRODUCT_ID` is optional, so with it unset this
        // query is NOT scoped to our product: any membership the email has
        // over Whop, on any product, satisfied it — and the back-fill then
        // stamped that on the account permanently. A READ that writes the
        // payment flag is the approve-to-paid drift, so it is gone: payment is
        // recorded by the console's own ledger (Mark paid) or by a real licence
        // key activation, and nothing else. Genuine payers are unaffected —
        // the answer above is what opens the app.
        console.log("[whop] active membership confirmed for", clean, "(no payment flag written)");
      }
      return { ok: true, paid };
    } catch (error) {
      return { ok: false, paid: false, error: error instanceof Error ? error.message : "Whop check failed" };
    }
  });

/**
 * Secure license-key issuance — runs SERVER-side with the service-role key,
 * which bypasses RLS. The old browser-side anon upsert in send-email.ts
 * becomes a forge hole once RLS is tightened (anyone could insert a row for
 * their own email), so issuance moves here. Called from the mentor portal's
 * license-issuance flow instead of the anon client.
 */
export const issueLicenseKeySecure = createServerFn({ method: "POST" })
  .validator(
    (data: { licenseKey: string; email: string; eaName?: string | null; expiry?: string | null; eaImage?: string | null }) => data,
  )
  .handler(
    async ({ data }): Promise<{ ok: boolean; error?: string }> => {
      const db = serviceClient();
      if (!db) return { ok: false, error: "Supabase is not configured" };
      const row: Record<string, unknown> = {
        key: data.licenseKey.trim().toUpperCase(),
        email: data.email.trim().toLowerCase(),
      };
      if (data.eaName) row["ea_name"] = data.eaName;
      if (data.expiry) row["expiry"] = data.expiry;
      // The EA PICTURE rides on the key row: activation on any device can
      // then show the mentor's uploaded image without needing the mentor's
      // portal record (which may not have mirrored yet).
      if (data.eaImage) row["ea_image"] = data.eaImage;
      // The live table's primary key is `id` (uuid) — `key` has NO unique
      // constraint, so upsert(onConflict: "key") always failed and the row
      // never landed. INSERT plainly; upsert only on a real duplicate.
      let result = await db.from("license_keys").insert(row);
      if (result.error?.code === "23505") {
        result = await db.from("license_keys").upsert(row);
      } else if (result.error?.code === "42703") {
        // Legacy table without the optional columns — core row only.
        result = await db.from("license_keys").insert({ key: row["key"], email: row["email"] });
      }
      return result.error ? { ok: false, error: result.error.message } : { ok: true };
    },
  );
