/**
 * Supabase registration flow (browser side, anon key only):
 *   1. Upsert the user into public.users (created unpaid if new).
 *   2. Insert a session row into public.user_sessions.
 *   3. Return the access outcome — "checkout" for unpaid, "allow" for
 *      paid, "admin" for admins.
 *
 * While Supabase env vars are missing the module degrades gracefully and
 * the legacy local payment store decides, so the app never blocks.
 */
import { supabase, supabaseConfigured, type UserRow } from "./supabase";

export type RegistrationOutcome = "allow" | "checkout" | "admin";

function clean(email: string) {
  return email.trim().toLowerCase();
}

/** Never let a broken registration keep the user off their next step. */
function db() {
  return supabaseConfigured ? supabase : null;
}

export async function registerWithEmail(
  email: string,
  licenseKey?: string,
): Promise<{ outcome: RegistrationOutcome; user: UserRow | null; error?: string }> {
  const dbClient = db();
  const address = clean(email);
  if (!dbClient || !address) {
    return { outcome: "allow", user: null, ...(supabaseConfigured ? {} : { error: "supabase-not-configured" }) };
  }

  // 1. Upsert — an existing row is NOT modified (admin/paid flags stay).
  const { data: inserted, error: upsertError } = await dbClient
    .from("users")
    .upsert({ email: address }, { onConflict: "email", ignoreDuplicates: true })
    .select("id, email, is_paid, is_admin, created_at")
    .maybeSingle();

  if (upsertError) {
    console.warn("[supabase] user upsert failed:", upsertError.message);
    return { outcome: "allow", user: null, error: upsertError.message };
  }

  // 2. Session row — best-effort; a missing session never blocks sign-in.
  const { error: sessionError } = await dbClient.from("user_sessions").insert({
    email: address,
    ...(licenseKey ? { license_key: licenseKey } : {}),
  });
  if (sessionError) console.warn("[supabase] session insert failed:", sessionError.message);

  // 3. Re-read the row (covers "insert raced, upsert ignored" — the select
  //    after ignoreDuplicates can be null when the row already existed).
  let user = inserted as UserRow | null;
  if (!user) {
    const { data: fetched } = await dbClient
      .from("users")
      .select("id, email, is_paid, is_admin, created_at")
      .eq("email", address)
      .maybeSingle();
    user = (fetched as UserRow | null) ?? null;
  }

  if (user?.is_admin) return { outcome: "admin", user };
  if (user?.is_paid) return { outcome: "allow", user };
  return { outcome: "checkout", user };
}

/** Read one user's flags from Supabase ("read own user by email"). */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const dbClient = db();
  const address = clean(email);
  if (!dbClient || !address) return null;
  const { data } = await dbClient
    .from("users")
    .select("id, email, is_paid, is_admin, created_at")
    .eq("email", address)
    .maybeSingle();
  return (data as UserRow | null) ?? null;
}
