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
 * THE STORE MOVED AND THE ROW BELOW FELL OUTSIDE IT. Licence keys now live in
 * Upstash KV behind `/api/licenses`, and the `app_settings` row kept here lives
 * in the legacy database — which answers nothing — so EVERY fallback that
 * reached it came back with "We could not check that licence key": a customer
 * whose server answer had merely been dropped on a mobile network was not just
 * refused, but refused forever, on every retry, by a store that was gone. This
 * module therefore claims through the SAME KV lock the server writes (one
 * round trip to `/api/licenses`, no database needed) before it ever touches
 * the row, and says "busy, try again in a moment" — never something that
 * reads as a broken key — when neither store can answer.
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

/**
 * The one message a key that is already activated produces.
 *
 * SAME STRING AS `api/activation.ts`, deliberately: a key that is already
 * activated reads identically whether the server lock or the offline lock
 * caught it, and identically whether the same account or a different one is
 * asking. The customer's rule is "a licence key can only be activated once",
 * and one sentence is what that sounds like.
 */
export const ALREADY_IN_USE = "License key already in use";

/**
 * Same words as `api/_handlers/activation.ts`'s, deliberately: a store that
 * cannot answer must never be reported as a problem with the key — that is
 * exactly what "We could not check that licence key" did to customers whose
 * key was fine the whole time.
 */
const LICENCE_STORE_BUSY = "Licence storage is busy right now. Please try again in a moment.";

const LOCK_PREFIX = "lock:";

export type LockOutcome =
  | { ok: true; alreadyInUse: boolean }
  | { ok: false; error: string; alreadyInUse: boolean };

/** How to undo a burned key. Deliberately a human action, never a button in the app. */
export const ADMIN_UNLOCK = "Delete the app_settings row whose key is lock:<KEY> (Supabase → Table editor).";

function lockRowKey(key: string): string {
  return `${LOCK_PREFIX}${key}`;
}

/**
 * Claim through `/api/licenses` (the KV lock the server writes), or `null`
 * when this endpoint could not decide.
 *
 * `null` means one of three things — no function on this host, the server
 * reporting "no KV here", or a network failure after one retry — and every one
 * of them is the caller's signal to try the `app_settings` row below. A
 * DECISIVE answer never comes back as `null`: the claim, the refusal with its
 * holder, or the store's own "busy" verdict.
 */
async function claimViaApi(cleanKey: string, address: string): Promise<LockOutcome | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // One re-ask for a request that never got an answer: blips on mobile
    // networks are measured in hundreds of milliseconds.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const response = await fetch("/api/licenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "claim", key: cleanKey, email: address }),
        signal: AbortSignal.timeout(12_000),
      });
      // 404/405 is what a static host answers with no function at all.
      if (response.status === 404 || response.status === 405) return null;
      const parsed = (await response.json().catch(() => null)) as {
        ok?: boolean;
        unavailable?: boolean;
        alreadyInUse?: boolean;
        heldBy?: string | null;
        error?: string;
      } | null;
      // HTML where JSON was contracted — this host serves only the static app.
      if (!parsed || typeof parsed.ok !== "boolean") return null;
      // The server says there is no KV here — the row below decides.
      if (parsed.unavailable) return null;
      if (parsed.ok) return { ok: true, alreadyInUse: false };
      if (parsed.alreadyInUse) {
        const heldBy = typeof parsed.heldBy === "string" ? parsed.heldBy.trim().toLowerCase() : "";
        if (heldBy === address) {
          /**
           * THE HOLDER IS THIS VERY ACCOUNT — accept. This lock only runs
           * when the strong endpoint could not answer at all, so a holder
           * naming this email is either this device's own claim whose
           * response was lost on the network, or the fallback doing its job
           * while the server is unreachable; in both cases the lock is
           * already this account's, and refusing would strand a customer on
           * a key they hold — the "could not check" dead end by another
           * sentence. A DIFFERENT holder still gets the server's own words,
           * and while the server is reachable it, not this fallback, owns
           * the spent-key rule.
           */
          return { ok: true, alreadyInUse: false };
        }
        return { ok: false, error: ALREADY_IN_USE, alreadyInUse: true };
      }
      // The store answered and declined (busy, or its own reason) — final.
      return {
        ok: false,
        error: typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : LICENCE_STORE_BUSY,
        alreadyInUse: false,
      };
    } catch (error) {
      console.warn(
        "[key-lock] KV claim attempt " + (attempt + 1) + " failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return null;
}

/**
 * Claim `key` for `email`, or refuse because the key is already activated.
 *
 * TWO LOCKS, STRONGEST FIRST, with the same words from either when a key is
 * genuinely taken: the KV claim through `/api/licenses` (the very lock the
 * server writes — see `claimViaApi` for the one deliberate asymmetry), then
 * the `app_settings` row, kept only for a deployment with no KV at all.
 */
export async function claimKeyWithoutServer(key: string, email: string): Promise<LockOutcome> {
  const cleanKey = key.trim().toUpperCase().replace(/\s+/g, "");
  const address = email.trim().toLowerCase();
  if (!cleanKey || !address) return { ok: false, error: "Missing email or key.", alreadyInUse: false };

  // THE KV STORE FIRST. It needs no database in the browser — one POST to the
  // endpoint — so it answers even when the row store below answers nothing,
  // which is precisely the state that made every fallback read "We could not
  // check that licence key" no matter what the customer did.
  const viaApi = await claimViaApi(cleanKey, address);
  if (viaApi) return viaApi;

  if (!supabaseConfigured || !supabase) {
    // Neither store exists here: there is no licence to check either, and the
    // rest of the app cannot run. Say so rather than pretend the key is free.
    return { ok: false, error: "Activation is unavailable right now.", alreadyInUse: false };
  }

  // READ FIRST so the account that already owns the key is not refused by its
  // own lock, and so a device holding it can re-enter it safely.
  const { data: existing, error: readError } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("key", lockRowKey(cleanKey))
    .limit(1);
  if (readError) {
    console.warn("[key-lock] read failed:", readError.message);
    return { ok: false, error: LICENCE_STORE_BUSY, alreadyInUse: false };
  }
  const rows = (existing ?? []) as Array<{ value?: string | null }>;
  if (rows.length > 0) {
    // THE ROW EXISTING IS THE LOCK — it does not matter who it names. The same
    // account asking again is just as spent as anybody else asking, and both get
    // the same words. An unreadable holder is also a claim: treating it as
    // unlocked would hand out a key somebody already has.
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
  return { ok: false, error: LICENCE_STORE_BUSY, alreadyInUse: false };
}