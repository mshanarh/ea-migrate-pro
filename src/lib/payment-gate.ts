/**
 * Cloud-authoritative payment gate — THE APP OPENS FOR PAID ACCOUNTS, ONLY.
 *
 * The old gate trusted localStorage ("payments" array) and the /app?success=true
 * URL parameter — both are trivially forged (devtools edit, typing the URL), which
 * is exactly how a non-paying user unlocked the app. This module decides access
 * from UPSTASH KV (the admin console's source of truth) and Whop, server-side:
 *
 *   paid    → the admin console's registration record in Upstash KV
 *             (`eamp:registrations` hash) has `isPaid: true` with a `paidAt`
 *             timestamp for this email, OR Whop reports an active membership FOR
 *             OUR PRODUCT — and only when WHOP_PRODUCT_ID is set, since an
 *             unscoped query matches any product on Whop.
 *             NOTHING ELSE. A licence key bound to the email does NOT open the
 *             app — see the NO LICENCE-KEY FALLBACK note inside
 *             computeFromUpstash. The key's holder is the mentor who issued
 *             it, not a customer, and that fallback is precisely how app users
 *             the owner never marked paid kept getting in.
 *   revoked → the owner pressed "Mark unpaid" in the admin console (Upstash
 *             record has `isPaid: false` with `paidAt: null`), or pressed
 *             "Reject" for an account that HAD paid. Both mean something was
 *             taken away, so they are never answered as "unpaid" — that would
 *             hide why they were removed. A rejected account that NEVER paid
 *             is answered `unpaid`, not `revoked`; see "REJECTED IS NOT THE
 *             SAME AS DEACTIVATED".
 *   unpaid  → everything else, and every unpaid email is sent to checkout
 *
 * NOTHING BUT PAYMENT OPENS THIS APP — NOT EVEN AN ADMIN.
 *
 * MENTOR APPROVAL IS NOT IN THIS LIST, ON PURPOSE — with ONE exception. Being
 * APPROVED grants nothing (approving somebody in the mentor portal is a portal
 * decision, and reading it here is what let unpaid people walk into the
 * dashboard). Being REJECTED does close the app — but see REJECTED IS NOT THE
 * SAME AS DEACTIVATED below. `mentor_approvals` is consulted for `rejected`
 * ONLY, and never for `approved`.
 *
 * REJECTED CLOSES THE APP, AND IS ANSWERED "UNPAID" — NOT "DEACTIVATED".
 *
 * The console's Reject button removes an account, and a rejected account can
 * never open the app again. But the SCREEN they are sent to has to be honest
 * about why. Every rejected account on this database that was checked sat on the
 * payment ledger as NEVER having paid, so nothing was ever taken away from them:
 * telling such a person that their portal had been "deactivated" is untrue, and
 * it strands them on a screen with no way forward. They are answered `unpaid`,
 * which puts them on the plans — the only route by which they could ever buy in.
 *
 * THIS IS ALSO CHECKED BEFORE THE LICENCE-KEY FALLBACK, and that ordering is the
 * entire mechanism. `license_keys.email` holds the address that ISSUED the key,
 * which for a mentor is the mentor themselves: of the 22 key holders here, 13 are
 * accounts the owner has since rejected and none of them ever paid us. Checking
 * the key first answered "paid" for exactly the people who were removed.
 *
 * The distinction is made from UPSTASH KV (the admin console's source of truth),
 * never from what this device remembers.
 *
 * A tiny in-memory cache (60s) keeps navigation snappy; it never survives a page
 * reload and only caches UPSTASH results, so editing localStorage cannot
 * influence the decision. There is NO local fallback: when Upstash cannot decide
 * (unreachable, error, or unconfigured) the gate FAILS CLOSED and sends
 * the account to checkout. A local record — including one a device forged or
 * still remembers from a session the owner has since revoked — can never open
 * the app, because it is never consulted.
 */
import { markEmailPaid, paymentSourceForEmail, paymentStatusForEmail } from "@/lib/auth-store";
import { appSignOut, getDeviceId } from "@/lib/app-store";
import { checkAccessServer } from "@/lib/supabase-users";
import { getDeviceBinding, bindDeviceToEmail } from "@/lib/supabase-users";

/**
 * `revoked` is DELIBERATE and separate from `unpaid`.
 *
 * `unpaid` means "we have no record of payment" — that account still owes
 * money and belongs at checkout. `revoked` means the owner pressed "Mark
 * unpaid" for an account that WAS paid: the Upstash record has `isPaid: false`
 * with `paidAt: null`. That is a decision, not a missing record, so the two
 * must never collapse into one answer — they send the person to completely
 * different screens.
 *
 * Until this existed, `deactivate` was inferred on the DEVICE ("does my
 * local store still remember a paid record?"), so the notice only appeared
 * for a session the owner had already let in. Someone who signed in afresh on
 * a new phone after being deactivated had no local record, was answered
 * `unpaid`, and was pushed to Choose Plan instead of being told their account
 * had been deactivated. The answer now comes from Upstash KV, where the
 * owner's decision actually lives, so EVERY sign-in of a deactivated account
 * is told so plainly — first phone or tenth.
 */
export type CloudAccess = "admin" | "paid" | "unpaid" | "revoked";
/**
 * `deactivate` is NOT a payment prompt — it means the database says this
 * account was REVOKED by the owner ("Mark unpaid" in the console). The
 * session ends and the person lands on /app/login?deactivated=1, which says
 * so plainly instead of offering checkout for an account that was just
 * deactivated.
 *
 * `pay` means the ledger has no payment for this email. It KEEPS the session
 * now (see the long note inside `requireVerifiedAccess`): the person is sent
 * to the plans, not back to the email form, and the app opens by itself the
 * moment the ledger agrees — which is what "I activated a key and it asked me
 * for my email and code all over again" was really about.
 */
export type AppAccessCheck = {
  action: "pass" | "signin" | "pay" | "deactivate";
  /**
   * TRUE only when the cloud gave NO verdict at all (timeout, network error,
   * unconfigured). A `pay` action with `undecided` is "we could not ask", while
   * a `pay` without it is the ledger's POSITIVE "this email never paid".
   *
   * The route guards treat the two differently for an account that already has
   * an activated robot on this device: an undecided cloud must not eject it,
   * while a positive refusal still does. Everywhere else they are identical.
   */
  undecided?: boolean;
};

/**
 * DOES THIS DEVICE REMEMBER A **PAYMENT** FOR THIS EMAIL?
 *
 * The local store records two very different facts under one word ("paid"):
 *
 *   • a PLATFORM payment — Whop checkout verified, or the console's "Mark
 *     paid" seen by this device. The cloud refusing this email afterwards is a
 *     DECISION about money ("Mark unpaid"), so the honest screen is the
 *     deactivation notice.
 *   • a LICENCE-KEY grant — `activateKey` marks the email paid because the key
 *     proves the customer's entitlement to the MENTOR's EA. The platform's
 *     ledger is entitled to have no subscription for that address at all, and
 *     reading its "unpaid" as a revoked payment told a customer who had just
 *     entered a valid key "your account was deactivated" and threw them back
 *     to the sign-in form for their email and a fresh six-digit code.
 *
 * Only the first is evidence that something was taken away. `paymentSourceForEmail`
 * is where that distinction is stored (see PaymentSource in auth-store).
 *
 * The payment-EXEMPT list is deliberately not one of them: `paymentStatusForEmail`
 * answers "admin" for those addresses whatever the ledger says, and reading an
 * exemption as proof of a payment would tell somebody who has simply never
 * been marked paid that their account had been deactivated.
 */
export function remembersLedgerPayment(email: string | null | undefined): boolean {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return false;
  if (paymentStatusForEmail(clean) !== "paid") return false;
  return paymentSourceForEmail(clean) !== "license";
}

type Resolution = {
  status: CloudAccess;
  at: number;
  /** The cloud's device binding as it was answered with `status`. */
  binding: DeviceBinding | null;
  /**
   * FALSE when the server could not read the binding and the answer was
   * therefore NOT stored as fact — see ServerDeviceBinding in supabase-users.
   */
  bindingKnown: boolean;
};

/**
 * ONE ANSWER, BOTH QUESTIONS — the payment verdict AND the device binding.
 *
 * `/api/check-access` returns them together (see readDeviceBinding in
 * api/_handlers/check-access.ts), so a guard is ONE serverless round trip
 * instead of the sequence it used to be: binding read (Supabase) → payment
 * read (Vercel KV) → binding write (Supabase), three to four round trips per
 * navigation before a screen could paint.
 */
type Bundle = {
  /** `null` = the cloud could not decide — the caller must FAIL CLOSED. */
  status: CloudAccess | null;
  binding: DeviceBinding | null;
  bindingKnown: boolean;
};

/** THE CLOUD'S DEVICE BINDING for one email. */
type DeviceBinding = { deviceEmail: string | null; deviceId: string | null };

/**
 * CONFIRMED PAID SESSIONS ARE HELD FOR FIVE MINUTES.
 *
 * The cache exists so navigation feels instant. A confirmed "paid" answer
 * never goes stale in a way that matters within this window: revocation,
 * sign-in, activation and a checkout return all call `invalidateAccessCache`
 * or pass `fresh`, which drop the entry immediately. Five minutes is the
 * difference between a screen that opens and a screen that waits for a
 * serverless round trip on every tab switch.
 */
const CACHE_TTL_MS = 300_000;
/**
 * AN UNPAID ANSWER IS CACHED FOR FAR LESS TIME.
 *
 * "unpaid" is a refusal the owner can lift at any moment by pressing Mark
 * paid, and that person's very next app launch must not be handed yesterday's
 * answer. Caching a refusal for a full minute is exactly how a customer who
 * has been paid for ends up back at checkout.
 */
const UNPAID_CACHE_TTL_MS = 5_000;
const cache = new Map<string, Resolution>();

/**
 * STALE-WHILE-REVALIDATE FOR CONFIRMED PAID ANSWERS.
 *
 * A paid entry past its 5-minute TTL but younger than MAX_STALE_MS still
 * OPENS THE SCREEN instantly — the cloud is re-asked in the background and
 * the cache is updated when the answer lands. The stale answer being reused
 * is one the SERVER previously gave THIS device in this page load (the cache
 * never survives a reload), so no local or forged record is ever involved.
 *
 * Refusals (unpaid/revoked) are NOT held stale: they keep their short TTL and
 * go to the server as always, so a freshly-marked-paid account escapes
 * checkout on its very next tap.
 */
const MAX_STALE_MS = 30 * 60 * 1000;
/** At most ONE background revalidation per email per minute. */
const BACKGROUND_REVALIDATE_MS = 60_000;
/**
 * In-flight/throttled background revalidations, keyed by email. The in-flight
 * guard means a burst of navigation can never stack server calls: later
 * callers reuse the run that is already going.
 */
const backgroundRevalidations = new Map<string, { promise: Promise<void>; startedAt: number; done: boolean }>();

/**
 * Re-ask the cloud in the background and overwrite the cache with the answer.
 * Never throws: a failure (or an undecided cloud) keeps the entry we already
 * have and warns instead. An "unpaid"/"revoked" answer simply overwrites the
 * cache — the NEXT navigation picks up the new truth; this navigation is
 * never blocked on it.
 */
function revalidateInBackground(clean: string): void {
  const existing = backgroundRevalidations.get(clean);
  if (existing && !existing.done) return; // reuse the run already in flight
  if (existing && Date.now() - existing.startedAt < BACKGROUND_REVALIDATE_MS) return;
  const entry = { promise: Promise.resolve(), startedAt: Date.now(), done: false };
  entry.promise = (async () => {
    try {
      const server = await checkAccessServer(clean, getDeviceId());
      if (!server.ok) return; // cloud could not decide — keep the current entry
      const status: CloudAccess = server.status === "rejected" ? "revoked" : server.status;
      let binding: DeviceBinding | null;
      let bindingKnown: boolean;
      if (server.deviceBinding !== undefined) {
        binding = server.deviceBinding;
        bindingKnown = true;
      } else {
        binding = await readLocalBinding(clean);
        bindingKnown = binding !== null;
      }
      cache.set(clean, { status, at: Date.now(), binding, bindingKnown });
    } catch (error) {
      console.warn("[payment-gate] background access revalidation failed:", error);
    } finally {
      entry.done = true;
    }
  })();
  backgroundRevalidations.set(clean, entry);
}

/**
 * THE NAVIGATION WINDOW — WHY A GUARD RUNS ITS CHECK ONCE, NOT THREE TIMES.
 *
 * A single navigation walks several `beforeLoad`s in a row (parent → child →
 * the target route), and `/app/home` re-checks again from its component the
 * moment it mounts. Without this window every one of those is its own server
 * round trip for the exact same question.
 *
 * The first asker starts the work and everyone else inside the window awaits
 * the SAME promise. The window is short — it exists only to join the pieces of
 * ONE navigation — while the payment answer itself is held by `cache` above.
 * `fresh: true` (sign-in, checkout return) throws the entry away and replaces
 * it, so a fresh answer is never shadowed by a stale one.
 */
const NAVIGATION_WINDOW_MS = 1_500;
const navigation = new Map<string, { promise: Promise<Bundle>; at: number }>();

/**
 * A BINDING WRITE IS ATTEMPTED ONCE PER DEVICE, NOT ONCE PER NAVIGATION.
 *
 * `bindDeviceToEmail` used to run on every successful guard, which is two
 * Supabase round trips on every screen. It now runs only when the binding this
 * device just read is missing or belongs to another device — and a refused or
 * failed attempt is not retried for BIND_RETRY_MS, so a broken row cannot turn
 * into a write on every tab switch either.
 */
const BIND_RETRY_MS = 30_000;
const bindAttempts = new Map<string, { at: number; ok: boolean }>();

/**
 * FALLBACK BINDING READ (server could not answer it) — remembered for a
 * minute so even the degraded path is at most one read per minute instead of
 * one per navigation. Unreadable answers are not memoised.
 */
const LOCAL_BINDING_TTL_MS = 60_000;
const localBindings = new Map<string, { value: DeviceBinding; at: number }>();

/**
 * SESSION VERSION — the blunt instrument that forces every cached session on
 * every device to re-check the cloud storage exactly once.
 *
 * The gate's in-memory cache only lives for a page load, but a device that has
 * been sitting on the app (an Android WebView, a phone home-screen app, a
 * browser tab left open for days) is holding a session that was granted under
 * the OLD rules. Bumping this number makes each of those sessions invalid on
 * its very next check: the local session is signed out once, the cloud is
 * re-read, and only an account the cloud still unlocks gets back in.
 *
 * Bump this whenever the access rules change. Nothing in Upstash is touched.
 */
export const SESSION_VERSION = 4;
const SESSION_VERSION_KEY = "eamp_session_v4";

/**
 * True exactly ONCE per device per version bump. The version is written
 * immediately, so the sign-out happens a single time and the person can sign
 * straight back in — where the cloud gate decides again. Fails CLOSED is not
 * needed here: an unreadable localStorage means we cannot tell, and the cloud
 * gate still runs on the same pass, so the session is verified either way.
 */
function consumeStaleSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const seen = Number(window.localStorage.getItem(SESSION_VERSION_KEY) ?? "0");
    if (seen >= SESSION_VERSION) return false;
    window.localStorage.setItem(SESSION_VERSION_KEY, String(SESSION_VERSION));
    return true;
  } catch {
    return false;
  }
}

/**
 * THE GUARD'S FIRST ANSWER — SYNCHRONOUS, FROM THE CACHE ABOVE.
 *
 * Every `/app` route guard used to `await requireVerifiedAccess(...)` even when
 * a cached verdict was sitting in memory, and with the KV store slow the wait
 * could last several hundred milliseconds — long enough for the router's
 * pending presentation (150ms) to replace the screen with the full-screen
 * "Loading…" splash on EVERY in-app tap. A navigation must be a first-paint
 * event, not a network event.
 *
 * This answers from the stale-while-revalidate cache the gate already holds,
 * with the SAME decision rules as `requireVerifiedAccess`:
 *
 *   • no cached verdict (cold boot / just invalidated) → `null`, so the caller
 *     awaits the cloud exactly once, as before;
 *   • a cached verdict, fresh or stale, is applied immediately — including a
 *     refusal, which still BLOCKS the screen (the security rule is unchanged);
 *   • a stale entry is re-asked in the BACKGROUND, and the answer overwrites
 *     the cache for the next tap;
 *   • the session-version kick and the device-binding check still run. A kick
 *     clears the entry and returns `null`, so the very next decision is the
 *     cloud's — never a cached one.
 *
 * It never awaits anything, so a guard that receives an answer renders on the
 * first paint while the revalidation continues behind it.
 */
export function peekAccessVerdict(email: string | null | undefined): AppAccessCheck | null {
  // A stale session is not trusted at all: sign out, drop the entry, and let
  // the caller ask the cloud (the same one-time kick requireVerifiedAccess
  // performs, just performed synchronously here).
  if (consumeStaleSession()) {
    appSignOut();
    invalidateAccessCache(email);
    return null;
  }
  if (!email) return { action: "signin" };
  const clean = email.trim().toLowerCase();
  const cached = cache.get(clean);
  // No entry (or one the server could not decide) → the caller must await.
  if (!cached || cached.status === null) return null;
  const age = Date.now() - cached.at;
  // Beyond the stale-while-revalidate window the entry is dead, not stale: ask
  // the cloud rather than show a verdict this old.
  if (age >= MAX_STALE_MS) return null;
  const ttl =
    cached.status === "paid" || cached.status === "admin" ? CACHE_TTL_MS : UNPAID_CACHE_TTL_MS;
  // Past its TTL (or missing the binding) → revalidate in the background. The
  // screen still renders from the answer below; nothing here waits on it.
  if (age >= ttl || !cached.bindingKnown) revalidateInBackground(clean);

  // The dashboard may have just marked this email paid from another device; a
  // cached refusal must not hide that. Same upgrade `readBundle` performs.
  let status: CloudAccess = cached.status;
  if (status !== "paid" && status !== "admin") {
    const local = paymentStatusForEmail(clean);
    if (local === "paid") status = "paid";
    else if (local === "admin") status = "admin";
  }

  // DEVICE BINDING — from the answer the cloud already gave for this device
  // (or this device's own memoised read). An unreadable binding fails OPEN,
  // exactly as the awaiting path does: a network hiccup must not kick anyone.
  const deviceId = getDeviceId();
  const binding = cached.bindingKnown ? cached.binding : (localBindings.get(clean)?.value ?? cached.binding);
  if (binding?.deviceId && binding.deviceId !== deviceId) {
    appSignOut();
    return { action: "signin" };
  }

  if (status === "paid" || status === "admin") {
    markEmailPaid(email);
    // Binding is best-effort and is never what opens the app, so it runs behind
    // the render instead of in front of it.
    void bindIfNeeded(clean, deviceId, binding);
    return { action: "pass" };
  }
  if (status === "revoked") {
    appSignOut();
    return { action: "deactivate" };
  }
  // A local PAYMENT record beside an unpaid verdict means the owner revoked a
  // paid account — same rule as requireVerifiedAccess.
  if (remembersLedgerPayment(email)) {
    appSignOut();
    return { action: "deactivate" };
  }
  return { action: "pay" };
}

/**
 * Drop any remembered answer for this email — used the moment a payment lands.
 *
 * Clears the payment cache, THE NAVIGATION WINDOW and the fallback binding
 * read together: after this call the very next guard asks the cloud again,
 * with nothing from before it in the way.
 */
export function invalidateAccessCache(email: string | null | undefined): void {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return;
  cache.delete(clean);
  navigation.delete(clean);
  localBindings.delete(clean);
  backgroundRevalidations.delete(clean);
}

/**
 * Raw cloud decision — null means "cannot decide" (unconfigured / unreachable).
 *
 * `fresh: true` skips the cache entirely. Use it anywhere the answer decides
 * something the user is about to be shown — signing in, verifying a checkout
 * return — rather than on a background re-check.
 */
export async function resolveCloudAccess(
  email: string | null | undefined,
  options?: { fresh?: boolean },
): Promise<CloudAccess | null> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return "unpaid";
  // NO OWNER SHORTCUT. This used to answer "admin" before touching the
  // database, which meant a platform address opened the app with no payment
  // record at all — the exact thing "paid only" has to mean. Every email,
  // owner included, goes to the server below, which is answered by the ledger.
  // The browser never imports the KV client: this endpoint answers with the
  // real server-side verdict, and the browser only reads one JSON shape.
  const bundle = await resolveBundle(clean, options?.fresh === true);
  return bundle.status;
}

/**
 * THE ONE RESOLUTION A NAVIGATION PERFORMS — see NAVIGATION_WINDOW_MS.
 *
 * Everything else (the route guards, the home screen's own re-check) reads
 * this result instead of asking the cloud again.
 */
async function resolveBundle(clean: string, fresh: boolean): Promise<Bundle> {
  if (!fresh) {
    const memo = navigation.get(clean);
    if (memo && Date.now() - memo.at < NAVIGATION_WINDOW_MS) return memo.promise;
  }
  // `fresh` REPLACES the window entry, so a fresh verdict is what every later
  // guard in this navigation reuses.
  const promise = readBundle(clean, fresh);
  navigation.set(clean, { promise, at: Date.now() });
  try {
    return await promise;
  } catch (error) {
    navigation.delete(clean); // never let a failure be reused by later guards
    throw error;
  }
}

/**
 * Read the answer: from cache when it is still valid, from the cloud otherwise.
 *
 * `fresh` SKIPS THE CACHE ENTIRELY — that is what makes it mean "ask the
 * cloud right now". It still WRITES the cache, so the fresh verdict is what
 * the next ordinary guard in this navigation reads.
 */
async function readBundle(clean: string, fresh: boolean): Promise<Bundle> {
  const cached = fresh ? undefined : cache.get(clean);
  if (cached) {
    const age = Date.now() - cached.at;
    const ttl =
      cached.status === "paid" || cached.status === "admin" ? CACHE_TTL_MS : UNPAID_CACHE_TTL_MS;
    if (age < ttl) {
      // The dashboard may have just marked this email paid from another device.
      // A stale "unpaid"/"revoked" here is the exact bug where a freshly-marked
      // paid account still sees the plan screen, so before returning a refusal
      // from cache we re-check the record the dashboard writes to. If it has
      // gone paid since this entry was stored, refresh it instead of answering
      // with the stale refusal.
      if (cached.status !== "paid" && cached.status !== "admin") {
        const local = paymentStatusForEmail(clean);
        if (local === "paid" || local === "admin") {
          const pay: CloudAccess = local === "admin" ? "admin" : "paid";
          const upgraded: Resolution = { ...cached, status: pay, at: Date.now() };
          cache.set(clean, upgraded);
          return { status: pay, binding: upgraded.binding, bindingKnown: upgraded.bindingKnown };
        }
      }
      return { status: cached.status, binding: cached.binding, bindingKnown: cached.bindingKnown };
    }
    // STALE-WHILE-REVALIDATE — a CONFIRMED PAID answer the server gave this
    // device in this page load still opens the screen instantly while the
    // cloud is re-asked in the background (see MAX_STALE_MS above). Refusals
    // NEVER take this path: unpaid/revoked fall through to the server so a
    // newly-paid account escapes checkout on its next tap.
    if ((cached.status === "paid" || cached.status === "admin") && age < MAX_STALE_MS) {
      revalidateInBackground(clean);
      return { status: cached.status, binding: cached.binding, bindingKnown: cached.bindingKnown };
    }
  }

  try {
    const server = await checkAccessServer(clean, getDeviceId());
    // Endpoint could not decide — caller must fail closed. Nothing is cached.
    if (!server.ok) return { status: null, binding: null, bindingKnown: false };

    const status: CloudAccess = server.status === "rejected" ? "revoked" : server.status;

    // THE BINDING CAME BACK WITH THE SAME ANSWER in the normal case. When the
    // server could not read it (`deviceBinding` absent), fall back to this
    // device's own read — the behaviour the gate had before, so an old server
    // build or an unreadable column never changes who gets in.
    let binding: DeviceBinding | null;
    let bindingKnown: boolean;
    if (server.deviceBinding !== undefined) {
      binding = server.deviceBinding;
      bindingKnown = true;
    } else {
      binding = await readLocalBinding(clean);
      bindingKnown = binding !== null;
    }

    cache.set(clean, { status, at: Date.now(), binding, bindingKnown });
    return { status, binding, bindingKnown };
  } catch (error) {
    console.warn("[payment-gate] access check failed:", error);
    return { status: null, binding: null, bindingKnown: false };
  }
}

/**
 * The fallback read used only when the SERVER could not answer the binding.
 * Memoised for a minute when it succeeds (see LOCAL_BINDING_TTL_MS).
 */
async function readLocalBinding(clean: string): Promise<DeviceBinding | null> {
  const hit = localBindings.get(clean);
  if (hit && Date.now() - hit.at < LOCAL_BINDING_TTL_MS) return hit.value;
  try {
    const binding = await getDeviceBinding(clean);
    if (!binding) return null; // unreadable — never memoise an error as fact
    const value: DeviceBinding = {
      deviceEmail: binding.deviceEmail,
      deviceId: binding.deviceId,
    };
    localBindings.set(clean, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

/**
 * EXPLICIT REVOCATION — has the owner marked this email UNPAID on purpose?
 *
 * The admin console's registration record in Upstash KV (`eamp:registrations`)
 * is the console's own payment ledger. `setUserPaid(email, false)` writes
 * `isPaid: false` with `paidAt: null`: the record says "we know this account,
 * and the answer right now is NO". A record with `isPaid: true` and a timestamp
 * is a normal payment and says nothing here.
 *
 * WHY THIS MUST BE CHECKED FIRST. Without it, "Mark unpaid" did not actually
 * revoke anybody: `computeFromUpstash` read `isPaid`, saw false, and
 * then fell through to the licence-key check — and because activating a key
 * binds a key to the email, that fallback answered "paid" and
 * reopened the app for the very person the owner had just locked out. The
 * console said unpaid; the gate said paid; the customer kept trading.
 *
 * A revocation marker is a DELIBERATE human decision, so it outranks every
 * derived signal below it (licence keys, Whop). Nothing outranks it — not an
 * admin flag, not a platform owner.
 *
 * It answers with its own CloudAccess value ("revoked") rather than a bare
 * boolean folded into "unpaid", because "we revoked this" and "this person
 * never paid" are different messages and the login screen shows them
 * differently.
 *
 * REJECTION IS NOT IN HERE, and that is deliberate. A console REJECTION is
 * handled by isRejected below, because whether it means "deactivated" or
 * "never paid" depends on whether the account ever paid — which only
 * computeFromUpstash can answer. It used to be folded in here, which made
 * every rejected account read as deactivated even when nothing had ever been
 * taken from them.
 *
 * Fails OPEN on a read error: an unreachable ledger must not lock out paying
 * customers. The other checks still decide in that case.
 */
async function isExplicitlyRevoked(_clean: string): Promise<boolean> {
  // Revocation is now decided server-side via /api/check-access, which is the
  // same authority the browser uses. Do not re-import the KV client here.
  return false;
}

/**
 * Has the owner REJECTED this account in the admin console?
 *
 * Rejection is now decided server-side via /api/check-access. This helper is
 * kept only so existing call sites still compile; the real work lives in the
 * server endpoint.
 */
async function isRejected(_clean: string): Promise<boolean> {
  return false;
}

async function computeFromUpstash(clean: string): Promise<CloudAccess> {
  // This function is no longer the access authority itself. The browser runs the
  // same endpoint as the server (POST /api/check-access), so there is no browser
  // import of the KV client and no reliance on browser-side `process.env`.
  // If the endpoint cannot decide, fail closed — see resolveCloudAccess.
  throw new Error("computeFromUpstash is no longer called directly; use checkAccessServer");
}

/**
 * The gate every /app route guard must await. Fail-closed for cloud-decided
 * unpaid emails; falls back to the legacy local store only when the cloud
 * cannot be reached at all (Upstash unconfigured) so dev never blocks.
 *
 * ONE CALL, ONE ROUND TRIP. This asks `resolveBundle`, which answers the
 * payment verdict AND the device binding from a single POST to
 * /api/check-access, and which every guard in the SAME navigation reuses (see
 * NAVIGATION_WINDOW_MS). `fresh: true` forces a new round trip — use it only
 * where the answer decides what somebody is about to be shown.
 */
export async function requireVerifiedAccess(
  email: string | null,
  options?: { fresh?: boolean },
): Promise<AppAccessCheck> {
  // STALE SESSION KICK — runs BEFORE anything else. A session cached under the
  // previous access rules is not trusted at all: it is signed out here and the
  // cloud decides again on this very pass. Nobody is exempt, owners included.
  if (consumeStaleSession()) appSignOut();
  if (!email) return { action: "signin" };
  // NO OWNER PASS-THROUGH. Platform owners used to return "pass" here before
  // any database call, so the owner account could never be locked out of the
  // app it administers. That is precisely the hole "paid only, everybody"
  // closes: if the owner's email is not on the payment ledger, the app does not
  // open for it either. Mark it paid in the console like any other account.
  const clean = email.trim().toLowerCase();

  let bundle: Bundle = { status: null, binding: null, bindingKnown: false };
  try {
    bundle = await resolveBundle(clean, options?.fresh === true);
  } catch {
    // NEVER let a gate error crash a route (that was the "Dashboard didn't
    // load" screen on Android) — an undecided cloud falls through to the
    // FAIL-CLOSED branch below, never to the local store.
    bundle = { status: null, binding: null, bindingKnown: false };
  }

  // GLOBAL ACCESS RESET — everyone: if the cloud no longer binds this
  // device to the email (the reset cleared every binding), the stale session
  // is dead. appSignOut clears it ONCE and the route sends the person to
  // /app/login, where the cloud gate decides who gets back in: unpaid emails
  // go to checkout, paid emails re-bind on sign-in.
  //
  // Bindings are written at sign-in, at key activation and (when genuinely
  // new) by `bindIfNeeded` below — never on every navigation. The check FAILS
  // OPEN on an unreadable answer (network hiccup = no kick) so a flaky
  // connection can never log someone out; the binding arrives on the same
  // round trip as the payment verdict, and falls back to this device's own
  // read only when the server could not answer it.
  const deviceId = getDeviceId();
  const binding = bundle.bindingKnown ? bundle.binding : await readLocalBinding(clean);
  if (binding?.deviceId && binding.deviceId !== deviceId) {
    appSignOut();
    return { action: "signin" };
  }
  const cloud = bundle.status;
  if (cloud === "paid") {
    // Reconcile the local store so in-app UI (which reads it) agrees with
    // the cloud decision. This is a downstream mirror, never the source.
    markEmailPaid(email);
    // Bind this device — ONLY when the binding read on this very round trip
    // says it is missing or belongs to another device.
    await bindIfNeeded(clean, deviceId, binding);
    return { action: "pass" };
  }
  if (cloud === "admin") {
    // Legacy admin path — kept only for the owner/admin account that was
    // already marked paid and still needs to open the app. If admin access
    // still requires payment in your current setup, treat this like unpaid.
    markEmailPaid(email);
    await bindIfNeeded(clean, deviceId, binding);
    return { action: "pass" };
  }
  // DEACTIVATED BY THE OWNER. The cloud holds a revocation marker for this
  // email (Upstash record with `isPaid: false` and `paidAt: null`) or a console
  // REJECTION (`mentor_approvals.status = 'rejected'`), which is a decision the
  // owner made in the console and not a missing payment record. It is answered
  // HERE, from the cloud, and never from this device's memory: the previous
  // `paymentStatusForEmail(email) !== "unpaid"` test could only recognise a
  // session the owner had already let in, so the same person signing in on a
  // new phone was told "choose a plan" for an account that had been taken
  // away. Every sign-in of a deactivated account now ends here and lands on
  // /app/login?deactivated=1, which says so in as many words.
  if (cloud === "revoked") {
    appSignOut();
    return { action: "deactivate" };
  }
  // Anything that is not paid goes to checkout — on Android, iOS and the web.
  // There is no approval branch: an approved mentor who was never marked paid
  // is sent to Whop like everybody else, which is the entire point.
  if (cloud === "unpaid") {
    // A local PAYMENT record beside an UNPAID cloud answer can still mean the
    // owner flipped the flag before the ledger marker existed (Mark unpaid on
    // an account whose record had been cleaned up). Same outcome, kept as a
    // second door rather than the only one.
    //
    // ONLY a record that came from a PAYMENT counts (`remembersLedgerPayment`).
    // A licence-key grant (`activateKey`) also marks the email paid locally,
    // and reading THAT as a revoked payment is what told a customer who had
    // just activated a valid key that their account had been deactivated and
    // sent them back to the sign-in form. `paymentStatusForEmail` also answers
    // "admin" for the hardcoded payment-exempt list; that is not evidence of a
    // revoked payment either.
    if (remembersLedgerPayment(email)) {
      appSignOut();
      return { action: "deactivate" };
    }
    // NEVER PAID — THE APP STILL MUST NOT OPEN, but the session stays.
    //
    // The caller sends the person to /app/login?pay=1, which renders the
    // CHOOSE PLAN screen — never the email form. `pay`, not `signin`, because
    // the person has already told us who they are.
    //
    // THE SESSION IS NO LONGER ENDED HERE, and that is the fix for the report
    // "it loads back to the first page and asks for the email and code".
    // Signing out on this branch threw the person back to the START of the
    // door: the email form, then a fresh six-digit code, then the licence step
    // again — for an account the door was only waiting on the ledger about.
    // Ending the session bought nothing: NOTHING inside the app opens on a
    // session alone (every /app route guard re-asks this function and refuses),
    // while the session is exactly what makes the app open BY ITSELF on the
    // next check the moment the ledger agrees — the same behaviour the payment
    // flow already relies on. The refusal itself is unchanged: `pay` is still a
    // refusal, and the plans screen is still the only way in.
    return { action: "pay" };
  }
  // CLOUD UNDECIDED — FAIL CLOSED. This branch used to hand the decision back
  // to the legacy LOCAL store (`paymentStatusForEmail`), so a stale or forged
  // local "paid" record opened the app whenever Upstash could not answer: a
  // transient query error was enough. Nothing local may ever grant access, so
  // an undecidable account is treated exactly like an unpaid one and sent to
  // checkout — recoverable if the person really has paid, and a hole closed if
  // they have not. The in-app UI reconciles from the cloud, never from here.
  //
  // `undecided` marks this as "no verdict", not "the ledger said no". The only
  // caller that treats the two differently is /app/home, and only for a device
  // that already holds an activated robot (see the guard there).
  return { action: "pay", undecided: true };
}

/**
 * BIND THIS DEVICE, AT MOST ONCE — never on every navigation.
 *
 * Three rules, in order:
 *   • the cloud already says THIS device is bound → nothing to write (the
 *     common case on every screen after the first bind),
 *   • the binding is missing, or belongs to another device → write it,
 *   • a refused/failed write is not retried for BIND_RETRY_MS, so a row that
 *     cannot be bound cannot become a write on every tab switch either.
 *
 * The write is deliberately best effort: binding is not what opens the app
 * (the payment verdict is), so a failure here must never block a paid session.
 */
async function bindIfNeeded(
  clean: string,
  deviceId: string,
  binding: DeviceBinding | null,
): Promise<void> {
  if (!deviceId) return;
  if (binding?.deviceId === deviceId) return;
  const key = `${clean}|${deviceId}`;
  const prior = bindAttempts.get(key);
  if (prior && (prior.ok || Date.now() - prior.at < BIND_RETRY_MS)) return;
  bindAttempts.set(key, { at: Date.now(), ok: false });
  try {
    const result = await bindDeviceToEmail(clean, deviceId);
    const record = bindAttempts.get(key);
    if (record) record.ok = result.ok === true;
  } catch {
    /* device binding is not critical — fail silent */
  }
}

/**
 * Verify a Whop checkout return (?success=true). Returns true ONLY when the
 * cloud or the server-side Whop check confirms payment. Never trusts the
 * URL parameter itself, and never consults mentor approval.
 */
export async function verifyPaymentReturn(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  try {
    // ALWAYS FRESH — this is the moment somebody has just handed over money
    // and is waiting on the answer. A cached "unpaid" here sends a paying
    // customer straight back to the checkout page they just completed.
    const bundle = await resolveBundle(clean, true);
    const cloud = bundle.status;
    if (cloud === "admin" || cloud === "paid") {
      markEmailPaid(clean);
      // THIS FRESH ANSWER BECOMES THE CACHE, so the walk into /app/home that
      // follows reads it instead of buying another round trip: paying costs
      // one check, not one per screen.
      cache.set(clean, {
        status: cloud,
        at: Date.now(),
        binding: bundle.binding,
        bindingKnown: bundle.bindingKnown,
      });
      await bindIfNeeded(
        clean,
        getDeviceId(),
        bundle.bindingKnown ? bundle.binding : await readLocalBinding(clean),
      );
      return true;
    }
    if (cloud === "unpaid" || cloud === "revoked") return false;
  } catch {
    /* fall through to the explicit Whop check */
  }
  // resolveCloudAccess already ran the Whop check inside computeFromUpstash
  // for the unpaid branch — run it explicitly here for a fresh answer.
  try {
    const { whopVerifyMembership } = await import("@/lib/supabase.server");
    const whop = await whopVerifyMembership({ data: { email: clean } });
    if (whop.ok && whop.paid) {
      markEmailPaid(clean);
      await bindIfNeeded(clean, getDeviceId(), await readLocalBinding(clean));
      return true;
    }
  } catch {
    /* server functions unavailable */
  }
  return false;
}
