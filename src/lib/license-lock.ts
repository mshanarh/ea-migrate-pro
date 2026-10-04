/**
 * THE SINGLE-USE LICENCE LOCK, WITHOUT A SERVER.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The strong version of this lock lives in `api/activation.ts`, the Vercel
 * serverless function: `users.license_key` is the one activation column the
 * public anon key cannot rewrite (verified live — UPDATE answers 42501), so a
 * customer cannot release their own key. That is the better implementation,
 * and it is tried first.
 *
 * IT CANNOT BE THE ONLY ONE. The app ships as a STATIC build (vercel.json
 * points at `dist/`, and the build copies `.vercel/output/static`), and a
 * TanStack server-function call answers `405` there — no Node process to run
 * the handler. Verified against the live deployment:
 *
 *     POST https://eamigratepro.vercel.app/_serverFn/<id>   →  405
 *
 * So on production the server lock is simply not available, and a lock that
 * only exists there would refuse EVERY activation: nobody could ever start the
 * bot again. This module is the lock that works with nothing but the anon key
 * that already ships in the browser bundle.
 *
 * HOW IT GETS FIRST-WRITE-WINS WITHOUT A SERVER
 * ────────────────────────────────────────────
 * A row in `app_settings` keyed `lock:<KEY>`. Everything below was probed
 * against the live database (scripts/probe-lock-fallback.ts):
 *
 *   • anon INSERT                     → allowed
 *   • anon INSERT of the SAME key     → REFUSED (23505, unique key)
 *   • anon SELECT                     → allowed (the holder is readable)
 *   • anon DELETE                     → REFUSED (42501)
 *
 * The unique key does the atomic work: the first INSERT wins and every later
 * one is refused by the database itself, so two devices racing for one key
 * cannot both win. The row cannot be deleted with the anon key, so a customer
 * cannot release their own lock by clearing site data.
 *
 * THE HONEST LIMITATION: an attacker who already knows a key can burn it —
 * insert the lock row first and the real owner is refused forever. That is
 * denial, not theft: it cannot hand the key to anybody, because the claim is
 * decided by the row EXISTING and the holder is read back for display. Keys are
 * only ever known to the person they were issued to, and a burned key is
 * repaired by an admin deleting one row (see ADMIN_UNLOCK below). It is a
 * weaker guarantee than the server lock and it is used only because the server
 * lock does not exist in production.
 */
import { supabase, supabaseConfigured } from "@/lib/supabase";

/** The one message the customer is shown when the key is already claimed. */
export const ALREADY_IN_USE = "This licence key is already in use.";

const LOCK_PREFIX = "lock:";

export type LockOutcome =
  | { ok: true; alreadyInUse: boolean }
  | { ok: false; error: string; alreadyInUse: boolean };

/** How to undo a burned key. Deliberately a human action, never a button in the app. */
export const ADMIN_UNLOCK = "Delete the app_settings row whose key is lock:<KEY> (Supabase → Table editor).";

function lockRowKey(key: string): string {
  return `${LOCK_PREFIX}${key}`;
}

function readHolder(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return ((JSON.parse(value) as { email?: unknown }).email ?? "") as string;
  } catch {
    return "";
  }
}

/**
 * Claim `key` for `email`, or refuse because somebody else already holds it.
 *
 * Same three outcomes as the server lock, with the same wording, so the app
 * cannot behave differently depending on which deployment it is running on.
 * The same account re-entering its own key is a NO-OP rather than a refusal —
 * that is the phone that already has the bot, not a second activation.
 */
export async function claimKeyWithoutServer(key: string, email: string): Promise<LockOutcome> {
  if (!supabaseConfigured || !supabase) {
    // No database at all: there is no licence to check either, and the rest of
    // the app cannot run. Say so rather than pretend the key is free.
    return { ok: false, error: "Activation is unavailable right now.", alreadyInUse: false };
  }
  const cleanKey = key.trim().toUpperCase().replace(/\s+/g, "");
  const address = email.trim().toLowerCase();
  if (!cleanKey || !address) return { ok: false, error: "Missing email or key.", alreadyInUse: false };

  // READ FIRST so the account that already owns the key is not refused by its
  // own lock, and so a device holding it can re-enter it safely.
  const { data: existing, error: readError } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("key", lockRowKey(cleanKey))
    .limit(1);
  if (readError) {
    console.warn("[key-lock] read failed:", readError.message);
    return { ok: false, error: "We could not check that licence key. Please try again.", alreadyInUse: false };
  }
  const rows = (existing ?? []) as Array<{ value?: string | null }>;
  if (rows.length > 0) {
    const holder = readHolder(rows[0]?.value);
    // An unreadable holder is still a CLAIMED key — the row existing is the
    // lock. Falling back to "unlocked" here would hand out a live key.
    if (!holder || holder === address) return { ok: true, alreadyInUse: true };
    return { ok: false, error: ALREADY_IN_USE, alreadyInUse: true };
  }

  // INSERT is the atomic step: the database refuses a duplicate key, so exactly
  // one racer can win this.
  const { error: claimError } = await supabase.from("app_settings").insert({
    key: lockRowKey(cleanKey),
    value: JSON.stringify({ email: address, at: new Date().toISOString() }),
  });
  if (!claimError) return { ok: true, alreadyInUse: false };

  // 23505 = unique violation → somebody else inserted between our read and our
  // write. That is a refusal, not a retry.
  if (claimError.code === "23505") {
    return { ok: false, error: ALREADY_IN_USE, alreadyInUse: true };
  }
  console.warn("[key-lock] claim failed:", claimError.code, claimError.message);
  return { ok: false, error: "We could not check that licence key. Please try again.", alreadyInUse: false };
}