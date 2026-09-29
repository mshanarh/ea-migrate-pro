/**
 * Supabase registration flow (browser side, anon key only):
 *   1. Upsert the user into public.users (created unpaid if new).
 *   2. Insert a session row into public.user_sessions.
 *   3. Return the access outcome — "checkout" for unpaid, "allow" for
 *      paid, "admin" for admins.
 *
 * While Supabase env vars are missing the module degrades gracefully and
 * the legacy local payment store decides, so the app never blocks. A
 * partially-migrated schema (e.g. a missing column) must never lock a
 * customer out either — failures here fail open to the legacy local gate.
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

/**
 * Registration gate. Fail-open by design: every Supabase error path lands on
 * the legacy local payment store instead of an error screen, so a schema
 * hiccup degrades the check rather than blocking sign-in. The ONLY case that
 * blocks an email is an explicit unpaid decision from a successfully read
 * row — so nobody can skip checkout just because the database hiccuped.
 */
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
    // 42703 = PostgREST "column does not exist" — the table predates a
    // migration. Treat as read failure, not a registration failure.
    console.warn("[supabase] user upsert failed:", upsertError.code, upsertError.message);
    return { outcome: "allow", user: null, error: upsertError.message };
  }

  // 2. Session row — best-effort. Some deployments lack the license_key
  //    column; retry without it so the session still records.
  const { error: sessionError } = await dbClient.from("user_sessions").insert({
    email: address,
    ...(licenseKey ? { license_key: licenseKey } : {}),
  });
  if (sessionError?.code === "42703") {
    const { error: retryError } = await dbClient.from("user_sessions").insert({ email: address });
    if (retryError) console.warn("[supabase] session insert failed:", retryError.message);
  } else if (sessionError) {
    console.warn("[supabase] session insert failed:", sessionError.message);
  }

  // 3. Re-read the row (covers "insert raced, upsert ignored" — the select
  //    after ignoreDuplicates can be null when the row already existed).
  let user = inserted as UserRow | null;
  if (!user) {
    const { data: fetched, error: fetchError } = await dbClient
      .from("users")
      .select("id, email, is_paid, is_admin, created_at")
      .eq("email", address)
      .maybeSingle();
    if (fetchError) console.warn("[supabase] user read failed:", fetchError.code, fetchError.message);
    user = (fetched as UserRow | null) ?? null;
  }

  // An unreadable row must NOT force the user to pay — fail open.
  if (!user) return { outcome: "allow", user: null };
  if (user.is_admin) return { outcome: "admin", user };
  if (user.is_paid) return { outcome: "allow", user };
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

/*
 * ── Static-host fallbacks ────────────────────────────────────────────────
 * Freebuff/production builds this app as a STATIC Vite site, where TanStack
 * Start server functions do not exist — every adminListUsers/adminSet* call
 * would fail at the network level. RLS lets the anon key read all users and
 * (with the schema's update policy) flip the is_paid / is_admin flags, so
 * the admin page falls back to these direct browser calls whenever a server
 * function is unreachable. They are also the natural no-service-role path.
 */

/** Admin list straight from the browser with the anon key. */
export async function listUsersAnon(): Promise<{ users: UserRow[]; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { users: [], error: "Supabase is not configured" };
  const { data, error } = await dbClient
    .from("users")
    .select("id, email, is_paid, is_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return { users: [], error: error.message };
  return { users: (data ?? []) as UserRow[] };
}

/** Flip is_paid / is_admin for one email straight from the browser. */
export async function setUserFlagAnon(
  email: string,
  patch: { is_paid?: boolean; is_admin?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { ok: false, error: "Supabase is not configured" };
  const { error } = await dbClient.from("users").update(patch).eq("email", clean(email));
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Count current admins straight from the browser (for owner bootstrap). */
export async function countAdminsAnon(): Promise<number> {
  const dbClient = db();
  if (!dbClient) return 0;
  const { count } = await dbClient
    .from("users")
    .select("email", { count: "exact", head: true })
    .eq("is_admin", true);
  return count ?? 0;
}

/* ── Device binding + email reactivation ───────────────────────────────
 * One email = one device, enforced in the CLOUD (users.device_email /
 * device_id) so it holds across browsers and the Android wrapper. Sign-in
 * compares the local device id against the cloud binding; a mismatch
 * offers "Reactivate", which releases the old device and binds this one.
 * Works for EVERY email — clients and admins alike. When the columns are
 * missing (pre-SQL) the check degrades to "no binding" — never a lockout.
 */

export type DeviceBindingCheck = { boundToOtherDevice: boolean; error?: string };

/** Read the cloud binding for one email (null = unbound / unreadable). */
export async function getDeviceBinding(email: string): Promise<{ deviceEmail: string | null; deviceId: string | null } | null> {
  const dbClient = db();
  if (!dbClient) return null;
  const { data, error } = await dbClient
    .from("users")
    .select("device_email, device_id")
    .eq("email", clean(email))
    .maybeSingle();
  if (error) {
    // 42703 = columns not added yet (SQL not run) — treat as unbound.
    if (error.code !== "42703") console.warn("[device-binding] read failed:", error.message);
    return null;
  }
  const row = data as { device_email?: string | null; device_id?: string | null } | null;
  return { deviceEmail: row?.device_email ?? null, deviceId: row?.device_id ?? null };
}

/**
 * Check whether this email is bound to a DIFFERENT device.
 * Used at sign-in: true → the UI offers "Reactivate to sign in here".
 */
export async function checkDeviceBinding(email: string, localDeviceId: string): Promise<DeviceBindingCheck> {
  const binding = await getDeviceBinding(email);
  if (!binding || !binding.deviceId) return { boundToOtherDevice: false };
  return { boundToOtherDevice: binding.deviceId !== localDeviceId };
}

/**
 * REACTIVATE: release the previously bound device and bind THIS one.
 * The old device simply loses the binding — the email's subscription,
 * license keys and payment state are untouched (mirrors the mentor
 * portal's Re-activate Client semantics, but self-service at sign-in).
 */
export async function reactivateEmailToDevice(email: string, localDeviceId: string): Promise<{ ok: boolean; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { ok: false, error: "Supabase is not configured" };
  const { error } = await dbClient
    .from("users")
    .update({ device_email: clean(email), device_id: localDeviceId })
    .eq("email", clean(email));
  if (error?.code === "42703") {
    return { ok: false, error: "Reactivation is not enabled yet — run supabase/device-reactivation.sql in the Supabase SQL Editor." };
  }
  return error ? { ok: false, error: error.message } : { ok: true };
}
