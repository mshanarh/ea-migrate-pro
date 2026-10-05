/**
 * Supabase registration flow (browser side, anon key only):
 *   1. Upsert the user into public.users (created unpaid if new).
 *   2. Insert a session row into public.user_sessions.
 *   3. Return the access outcome — "checkout" for anything not on the payment
 *      ledger, "allow" for a paid account. There is no "admin" outcome: an
 *      admin with no payment record is answered exactly like any other unpaid
 *      account.
 *
 * This is the APP's sign-in path, and it has exactly one question to answer:
 * has this email been marked as paid? It deliberately does NOT touch
 * `mentor_approvals` and does NOT alert the admin — mentor approval belongs
 * to the mentor portal signup (src/routes/signup.tsx) and has no bearing on
 * whether somebody may use the app.
 *
 * FAIL CLOSED. Every runtime failure — an upsert error, a read error, a row
 * that does not exist — now returns "checkout" rather than "allow". An error
 * is not evidence that somebody paid, and the previous fail-open behaviour
 * handed the app to accounts the database had never confirmed. The one
 * environment-level exception is Supabase being UNCONFIGURED at build time
 * (missing VITE_SUPABASE_URL), which is not attacker-controllable; there the
 * module keeps its documented offline fallback.
 */
import { OWNER_EMAILS, isPaymentExemptEmail } from "./auth-store";
import { supabase, supabaseConfigured, type UserRow } from "./supabase";

export type RegistrationOutcome = "allow" | "checkout";

/**
 * The result of a registration attempt.
 *
 * `verified` is the flag the login screen gates on: it is true ONLY when the
 * database POSITIVELY confirmed this email is entitled (paid, admin, a
 * platform owner, or the holder of a license_keys row). It is false for every
 * checkout answer AND for every error path — so "did the call succeed?" can
 * never be mistaken for "may this account in?".
 */
export type RegistrationResult = {
  outcome: RegistrationOutcome;
  user: UserRow | null;
  verified: boolean;
  error?: string;
};

function clean(email: string) {
  return email.trim().toLowerCase();
}

/** Never let a broken registration keep the user off their next step. */
function db() {
  return supabaseConfigured ? supabase : null;
}

/**
 * Registration gate. FAIL CLOSED on every runtime error: a failed upsert, a
 * failed read or a missing row all answer "checkout", because none of them is
 * proof that this email paid. Only a positive signal lets somebody through: a
 * `paid_emails` LEDGER row carrying a timestamp (the console's own Paid list),
 * or a license_keys row issued for that address (a key only exists because
 * somebody paid for it). Neither `is_paid`, nor `is_admin`, nor an email in
 * OWNER_EMAILS opens this app — a role is not a receipt, and only a payment
 * record is.
 */
export async function registerWithEmail(
  email: string,
  licenseKey?: string,
): Promise<RegistrationResult> {
  const dbClient = db();
  const address = clean(email);
  if (!address) return { outcome: "checkout", user: null, verified: false, error: "missing-email" };
  // UNCONFIGURED SUPABASE → CHECKOUT. There is no database to verify against,
  // so there is no way to confirm anybody paid; "we cannot check" must never
  // read as "this account is fine". This only affects a build with no
  // VITE_SUPABASE_URL, which is not attacker-controllable.
  if (!dbClient) {
    return { outcome: "checkout", user: null, verified: false, error: "supabase-not-configured" };
  }

  // 1. Upsert — an existing row is NOT modified (admin/paid flags stay).
  // Runs for EVERY email INCLUDING owners: the device-binding write below
  // (bindDeviceToEmail at sign-in) needs the row to exist, and an owner who
  // never registered would otherwise have no row to bind.
  const { data: inserted, error: upsertError } = await dbClient
    .from("users")
    .upsert({ email: address }, { onConflict: "email", ignoreDuplicates: true })
    .select("id, email, is_paid, is_admin, created_at")
    .maybeSingle();

  if (upsertError) {
    // 42703 = PostgREST "column does not exist" — the table predates a
    // migration. FAIL CLOSED: a failed upsert means the row could not be
    // created AND could not be read, which is exactly the state an unverified
    // account has. An error must never be read as "this account is fine".
    console.warn("[supabase] user upsert failed:", upsertError.code, upsertError.message);
    return { outcome: "checkout", user: null, verified: false, error: upsertError.message };
  }

  // 2. NO APPROVAL ROW, NO ADMIN ALERT FROM THE APP.
  //    Typing an email into the app is a PAYMENT ATTEMPT, not a request to be
  //    reviewed. It used to write a `mentor_approvals` pending row and email
  //    the admin on every single sign-in, so the console filled up with people
  //    who only ever wanted to buy something, and approving one of them was
  //    mistaken for a decision about the app. The mentor-portal signup form
  //    (src/routes/signup.tsx) still creates the pending row and still alerts
  //    the admin — that is the path where approval actually means something.

  // 3. Session row — best-effort. Some deployments lack the license_key
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

  // A MISSING ROW IS NOT PERMISSION. This used to fail OPEN ("an unreadable
  // row must not force the user to pay"), which meant a deleted row, a
  // transient read failure or a schema mismatch handed the app to an account
  // the database has never confirmed. Anything that is not a positive proof
  // of payment is now treated exactly like an unpaid account: checkout.
  //
  // PLATFORM OWNERS ARE NOT AN EXEMPTION HERE ANY MORE, AND NEITHER IS
  // is_admin. Both used to answer "verified" with no payment record at all,
  // which is exactly the hole this gate exists to close — a role is not a
  // receipt. Both lists still govern what they are good for (portal admin
  // rights); neither opens the trading app.
  if (!user) return { outcome: "checkout", user: null, verified: false };
  // PAYMENT IS THE ONLY THING THAT OPENS THE APP.
  //   a ledger row     → the console's "Mark paid" wrote it. `paid_emails` is
  //                      the same table the console's Paid tab reads, so
  //                      "paid" here means exactly what "Paid" means there.
  //   nothing else     → checkout, on Android, iOS and the web alike.
  //
  // THE LICENCE-KEY GRANT IS GONE, and it was the second way in. It used to
  // read `license_keys.email`, which is the address HOLDING the key — for a
  // mentor that is the mentor who ISSUED it to a client. Measured live: 24 key
  // holders, 20 of them with no ledger row at all, so they are distributors
  // rather than paying customers. Treating that as payment is what let app
  // users the owner never marked paid keep opening the app. A paying customer
  // who has not activated a key is still answered by their ledger row, which
  // the console's "Mark paid" writes, so nobody has to pay twice to be let in.
  //
  // `users.is_paid` is deliberately NOT read: it is a mirror column the anon
  // key may write, so it drifts and it can be forged. Mentor approval is
  // deliberately NOT consulted: approving somebody in the mentor portal says
  // nothing about the app, and treating it as permission is what let unpaid
  // people in.
  if (await emailPaidInLedger(address)) return { outcome: "allow", user, verified: true };
  return { outcome: "checkout", user, verified: false };
}

/**
 * REMEMBER THE NAME somebody typed on the app's sign-in screen.
 *
 * The admin console's "App users" list has to answer "who is this?", and the
 * trading app only ever asks for an email — so the name has to be captured
 * somewhere. `users` has no name column and this deployment has no DDL path
 * (every SQL entry point answers PGRST202), so it is stored in
 * `portal_accounts.data` alongside the fields the website signup already keeps
 * there, under `appName`.
 *
 * THE BLOB IS MERGED, NEVER REPLACED. `portal_accounts.data` IS a mentor's
 * whole account record — licences, EAs, settings — so writing our one field
 * over it would delete their work. A name is written ONCE: an account that
 * already has one is left exactly as it is, which also means this can never
 * become a way to rewrite somebody else's record.
 *
 * Best effort by design: a failed write must not block a sign-in, so the caller
 * treats a false result as "the name was simply not remembered".
 */
export async function recordAppUserName(email: string, name: string): Promise<{ ok: boolean }> {
  const dbClient = db();
  const address = clean(email);
  const label = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!dbClient || !address || !label) return { ok: false };
  try {
    const { data, error } = await dbClient.from("portal_accounts").select("data").eq("email", address).limit(1);
    if (error) {
      console.warn("[app-name] read failed:", error.message);
      return { ok: false };
    }
    const existing = ((data ?? []) as Array<{ data?: string | null }>)[0];
    let blob: Record<string, unknown> = {};
    if (existing?.data) {
      try {
        const parsed = JSON.parse(existing.data) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) blob = parsed as Record<string, unknown>;
      } catch {
        /* a corrupted blob is not ours to fix — write the name into a fresh one */
      }
    }
    // FIRST WRITE WINS — see the note above.
    if (typeof blob["appName"] === "string" && blob["appName"].trim()) return { ok: true };
    blob["appName"] = label;
    const payload = { email: address, data: JSON.stringify(blob) };
    const write = existing
      ? await dbClient.from("portal_accounts").update(payload).eq("email", address)
      : await dbClient.from("portal_accounts").insert(payload);
    if (write.error) {
      console.warn("[app-name] write failed:", write.error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.warn("[app-name] save failed:", error);
    return { ok: false };
  }
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

/**
 * Does ANY license_keys row belong to this email? A mentor-issued key IS
 * proof of payment — the same rule the app's payment gate applies — so the
 * Re-activate Client page must accept key-holders whose users.is_paid flag
 * was never set (e.g. the admin console's Paid button only wrote
 * localStorage before the cloud write existed).
 */
export async function emailHasLicenseKey(email: string): Promise<boolean> {
  const dbClient = db();
  const address = clean(email);
  if (!dbClient || !address) return false;
  const { data } = await dbClient.from("license_keys").select("key").eq("email", address).limit(1).maybeSingle();
  if (data) return true;
  const { data: loose } = await dbClient.from("license_keys").select("key").ilike("email", address).limit(1).maybeSingle();
  return !!loose;
}

/**
 * Does the console's payment LEDGER record this email as paid?
 *
 * A `paid_emails` row carrying a timestamp is the one and only definition of
 * "paid" on this side of the app, and it is the very same row the admin
 * console lists under Paid — so the sign-in screen and the console can no
 * longer disagree about who has paid. A row with `paid_at = null` is a
 * revocation marker ("Mark unpaid") and deliberately does NOT count as paid
 * here; the gate answers that case separately, as "deactivated".
 */
export async function emailPaidInLedger(email: string): Promise<boolean> {
  const dbClient = db();
  const address = clean(email);
  if (!dbClient || !address) return false;
  const { data, error } = await dbClient
    .from("paid_emails")
    .select("paid_at")
    .eq("email", address)
    .limit(10);
  if (error || !Array.isArray(data)) return false;
  return data.some((row) => (row as { paid_at?: string | null }).paid_at != null);
}

/**
 * CLOUD PROOF OF A KEY ACTIVATION. TWO writes, both via the anon key:
 *   1. CLAIM the key — an open key (email null) gets the activator's email
 *      written onto the license_keys row, so the single-use lock in
 *      api/activation.ts has an owner to compare against.
 *   2. BIND the device in the cloud — the sign-in path binds too, but the
 *      License view used to skip binding completely, which is why admins were
 *      never asked to reactivate after delete + reinstall.
 *
 * IT NO LONGER WRITES PAYMENT, AND THAT IS THE POINT.
 *
 * This used to also do `users.is_paid = true` and upsert a `paid_emails` row
 * with a timestamp. Both are reachable with the PUBLIC anon key (verified live),
 * so a browser could grant itself the one entitlement the whole app is built
 * around: hold any activatable licence key, post the two writes, and the ledger
 * then says the owner marked you paid. "Only people I marked paid can use the
 * app" is not true while the app can write that table itself.
 *
 * Payment is written in exactly one place — the console's "Mark paid"
 * (setUserPaid in src/lib/admin-store.ts). Activation proves you hold a key; it
 * does not decide what you paid.
 */
export async function recordKeyActivationInCloud(
  key: string,
  email: string,
  deviceId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { ok: false, error: "Supabase is not configured" };
  const address = clean(email);
  const cleanKey = key.trim().toUpperCase().replace(/\s+/g, "");
  if (!address || !cleanKey) return { ok: false, error: "Missing email or key." };
  // SERVER-SIDE CLAIM (preferred). The database checks that this key really
  // exists and is not already owned by somebody else, then records the device
  // binding in one transaction. This replaced a raw client write of is_paid,
  // which meant anyone could post is_paid=true for their own email and grant
  // themselves the app. Falls back to the direct writes below only when the
  // function has not been installed yet.
  try {
    const { data: claimed, error: claimRpcError } = await dbClient.rpc("claim_license_key", {
      p_key: cleanKey,
      p_email: address,
      p_device: deviceId ?? null,
    });
    if (!claimRpcError) {
      if (claimed === true) return { ok: true };
      return { ok: false, error: "That license key is not valid for this email." };
    }
    if (claimRpcError.code !== "42883" && claimRpcError.code !== "PGRST202") {
      console.warn("[key-activation] claim_license_key failed:", claimRpcError.message);
    }
  } catch {
    /* function missing — fall through to the legacy direct writes */
  }
  // 1. Claim an open key (row bound to someone else is left alone — the
  //    license lookup already rejected that case before activation).
  const { error: claimError } = await dbClient
    .from("license_keys")
    .update({ email: address })
    .eq("key", cleanKey)
    .is("email", null);
  if (claimError && claimError.code !== "42703") {
    console.warn("[key-activation] cloud claim failed:", claimError.message);
  }
  // 2. Bind THIS device (only when the row is unbound — never steal).
  //
  // NO PAYMENT WRITE HERE — see the doc comment above. This used to write
  // `users.is_paid = true` and upsert a `paid_emails` row with a timestamp, so
  // any browser holding an activatable key could grant itself the one
  // entitlement this app is built around. Only the console's Mark paid
  // (setUserPaid in src/lib/admin-store.ts) writes payment now, and a real
  // re-payment clears the revocation marker there, exactly as it must.
  if (deviceId) {
    const { data: bound } = await dbClient.from("users").select("device_id").eq("email", address).maybeSingle();
    const boundDeviceId = (bound as { device_id?: string | null } | null)?.device_id ?? null;
    if (!boundDeviceId) {
      const { error: bindError } = await dbClient
        .from("users")
        .update({ device_email: address, device_id: deviceId })
        .eq("email", address);
      if (bindError) console.warn("[key-activation] device bind failed:", bindError.message);
    }
  }
  return { ok: true };
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

/**
 * Reactivation permission — an admin unlocks the mentor's Re-activate
 * Client tool per-mentor (users.reactivation_enabled). Locked by default:
 * a mentor without the flag cannot release ANY device.
 */
export async function getReactivationEnabled(email: string): Promise<boolean> {
  const address = clean(email);
  // ADMINS are always unlocked — a database hiccup (or the PostgREST schema
  // cache lagging after a column was added) must never re-lock the owner.
  if (OWNER_EMAILS.includes(address) || isPaymentExemptEmail(address)) return true;
  const dbClient = db();
  if (!dbClient) return false;
  const { data, error } = await dbClient
    .from("users")
    .select("reactivation_enabled")
    .eq("email", clean(email))
    .maybeSingle();
  if (error) {
    if (error.code !== "42703") console.warn("[reactivation] flag read failed:", error.message);
    return false; // column missing (SQL not run) = locked
  }
  return (data as { reactivation_enabled?: boolean } | null)?.reactivation_enabled === true;
}

/** Admin toggle for the 🔒 next to Approve in the console. */
export async function setReactivationEnabled(email: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { ok: false, error: "Supabase is not configured" };
  const address = clean(email);
  // UPDATE ... select() makes the write VERIFIABLE: an UPDATE that matches
  // zero rows (mentor never entered their email in the app, so no users row)
  // used to return success and the flag "locked again" on every reload.
  const { data, error } = await dbClient
    .from("users")
    .update({ reactivation_enabled: enabled })
    .eq("email", address)
    .select("email");
  if (error?.code === "42703") {
    return { ok: false, error: "Run supabase/fix-license-keys-columns.sql first (reactivation_enabled column missing)." };
  }
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) {
    // Row missing — create it so the flag has something to stick to. The
    // insert policy only allows unpaid/non-admin rows, which is exactly
    // what a not-yet-seen mentor is.
    const { error: insertError } = await dbClient
      .from("users")
      .upsert({ email: address, reactivation_enabled: enabled }, { onConflict: "email", ignoreDuplicates: false });
    if (insertError?.code === "42501") {
      return { ok: false, error: "This email has a protected row (paid/admin) — toggle it from the app admin console instead." };
    }
    if (insertError?.code === "42703") {
      return { ok: false, error: "Run supabase/fix-license-keys-columns.sql first (reactivation_enabled column missing)." };
    }
    if (insertError) return { ok: false, error: insertError.message };
  }
  // Read-back confirmation: the PostgREST schema cache has briefly served a
  // stale schema after new columns were added (the 42703 toast). Verify the
  // value actually stuck and say so.
  const { data: verify, error: verifyError } = await dbClient
    .from("users")
    .select("reactivation_enabled")
    .eq("email", address)
    .maybeSingle();
  if (verifyError) return { ok: false, error: "Saved, but the read-back failed: " + verifyError.message };
  const saved = (verify as { reactivation_enabled?: boolean } | null)?.reactivation_enabled === true;
  if (saved !== enabled) return { ok: false, error: "The database did not confirm the change — try again in a moment." };
  return { ok: true };
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
 * BIND this device to the email (first activation) — the write that makes
 * "one email, one device" hold across reinstalls:
 *   • the users row must exist (registerWithEmail upserts it first — this
 *     is why the old bind call silently failed: it ran BEFORE the row was
 *     created, so a delete+reinstall never detected the old device),
 *   • an UNBOUND row (device_id null) binds to this device,
 *   • a row already bound to THIS device is a no-op,
 *   • a row bound to a DIFFERENT device is REFUSED — the user must ask
 *     their mentor to release it (/dashboard/reactivate). Applies to
 *     EVERYONE — clients and admins alike.
 * Subscription, license keys and payment state are untouched.
 */
export async function bindDeviceToEmail(email: string, localDeviceId: string): Promise<{ ok: boolean; error?: string }> {
  const dbClient = db();
  if (!dbClient) return { ok: false, error: "Supabase is not configured" };
  const address = clean(email);
  if (!address || !localDeviceId) return { ok: false, error: "Missing email or device." };
  const { data, error: readError } = await dbClient
    .from("users")
    .select("device_id")
    .eq("email", address)
    .maybeSingle();
  if (readError) {
    if (readError.code === "42703") return { ok: false, error: "Device binding is not enabled yet — run supabase/fix-license-keys-columns.sql in the Supabase SQL Editor." };
    return { ok: false, error: readError.message };
  }
  if (!data) {
    // No row = this email never registered. It is NOT the user's email.
    return { ok: false, error: "Not bound — this is not a registered email. Sign in with the email you registered with." };
  }
  const boundDeviceId = (data as { device_id?: string | null }).device_id ?? null;
  if (boundDeviceId === localDeviceId) return { ok: true }; // already this device
  if (boundDeviceId) {
    // Bound elsewhere — never steal the binding from the sign-in screen.
    return { ok: false, error: "Account already used — please tell your mentor to reactivate." };
  }
  const { error } = await dbClient
    .from("users")
    .update({ device_email: address, device_id: localDeviceId })
    .eq("email", address);
  if (error?.code === "42703") {
    return { ok: false, error: "Device binding is not enabled yet — run supabase/fix-license-keys-columns.sql in the Supabase SQL Editor." };
  }
  return error ? { ok: false, error: error.message } : { ok: true };
}
