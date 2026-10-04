/**
 * Cloud-authoritative payment gate — THE APP OPENS FOR PAID ACCOUNTS, ONLY.
 *
 * The old gate trusted localStorage ("payments" array) and the /app?success=true
 * URL parameter — both are trivially forged (devtools edit, typing the URL), which
 * is exactly how a non-paying user unlocked the app. This module decides access
 * from SUPABASE (and Whop, server-side) only:
 *
 *   paid    → the console's payment LEDGER (`paid_emails`) holds a row with a
 *             timestamp for this email, OR a license_keys row is bound to the
 *             email (the key only exists because they paid), OR Whop reports an
 *             active membership FOR OUR PRODUCT — and only when WHOP_PRODUCT_ID
 *             is set, since an unscoped query matches any product on Whop
 *   revoked → the owner pressed "Mark unpaid" (`paid_emails` row with
 *             `paid_at = null`) or pressed "Reject" (`mentor_approvals.status
 *             = 'rejected'`). Both are DELIBERATE decisions, not missing
 *             records, so they are never answered as "unpaid" — that would send
 *             the person to checkout and hide the fact that the account was
 *             taken away.
 *   unpaid  → everything else, and every unpaid email is sent to checkout
 *
 * NOTHING BUT PAYMENT OPENS THIS APP — NOT EVEN AN ADMIN.
 *
 * The owner list, `users.is_admin` and `users.is_paid` are all GONE from the
 * grant path. Each one was a way in that had nothing to do with money:
 *   • the owner list answered "admin" before any database call, so every
 *     platform address opened the app forever with no payment record;
 *   • `is_admin` opened the app for anybody an admin had flagged;
 *   • `is_paid` is a MIRROR column the anon key may write, so it could be set
 *     by anything holding the public key.
 * The console shows Paid from the same `paid_emails` ledger this gate reads, so
 * what the owner sees and what the app enforces are now the same table. If you
 * are not on that table, the app does not open — that includes the owner, and
 * that is deliberate.
 *
 * MENTOR APPROVAL IS NOT IN THIS LIST, ON PURPOSE — with ONE exception. Being
 * APPROVED grants nothing (approving somebody in the mentor portal is a portal
 * decision, and reading it here is what let unpaid people walk into the
 * dashboard). Being REJECTED does revoke: the console's Reject button is the
 * owner telling the platform "this account is deactivated", and the only
 * honest way to honour that on a device that never had a local paid record is
 * to read the rejection itself. `mentor_approvals` is therefore consulted for
 * `rejected` ONLY, and never for `approved`.
 *
 * A tiny in-memory cache (60s) keeps navigation snappy; it never survives a page
 * reload and only caches DATABASE results, so editing localStorage cannot
 * influence the decision. There is NO local fallback: when the database cannot
 * decide (unreachable, error, or unconfigured) the gate FAILS CLOSED and sends
 * the account to checkout. A local record — including one a device forged or
 * still remembers from a session the owner has since revoked — can never open
 * the app, because it is never consulted.
 */
import { markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { appSignOut, getDeviceId } from "@/lib/app-store";
import { supabase, supabaseConfigured } from "@/lib/supabase";

/**
 * `revoked` is DELIBERATE and separate from `unpaid`.
 *
 * `unpaid` means "we have no record of payment" — that account still owes
 * money and belongs at checkout. `revoked` means the owner pressed "Mark
 * unpaid" for an account that WAS paid: `paid_emails` carries a row with
 * `paid_at = null` (see isExplicitlyRevoked). That is a decision, not a
 * missing record, so the two must never collapse into one answer — they send
 * the person to completely different screens.
 *
 * Until this existed, `deactivate` was inferred on the DEVICE ("does my
 * local store still remember a paid record?"), so the notice only appeared
 * for a session the owner had already let in. Someone who signed in afresh on
 * a new phone after being deactivated had no local record, was answered
 * `unpaid`, and was pushed to Choose Plan instead of being told their account
 * had been deactivated. The answer now comes from the database, where the
 * owner's decision actually lives, so EVERY sign-in of a deactivated account
 * is told so plainly — first phone or tenth.
 */
export type CloudAccess = "admin" | "paid" | "unpaid" | "revoked";
/**
 * `deactivate` is NOT a payment prompt — it means the database says this
 * account was REVOKED by the owner ("Mark unpaid" in the console). The
 * session ends and the person lands on /app/login?deactivated=1, which says
 * so plainly instead of offering checkout for an account that was just
 * deactivated. A cloud-decided unpaid account that was NEVER paid also ends
 * its session and returns to `signin` — the first page, where the email is
 * entered.
 */
export type AppAccessCheck = { action: "pass" | "signin" | "pay" | "deactivate" };

type Resolution = { status: CloudAccess; at: number };

const CACHE_TTL_MS = 60_000;
/**
 * AN UNPAID ANSWER IS CACHED FOR FAR LESS TIME.
 *
 * The cache exists so navigation feels instant, and a confirmed "paid" never
 * goes stale in a way that hurts anybody. "unpaid" is the opposite: the owner
 * marks somebody paid in the console and that person's very next app launch
 * must not be handed yesterday's answer. Caching a refusal for a full minute
 * is exactly how a customer who has been paid for ends up back at checkout.
 */
const UNPAID_CACHE_TTL_MS = 5_000;
const cache = new Map<string, Resolution>();

/**
 * SESSION VERSION — the blunt instrument that forces every cached session on
 * every device to re-check the cloud database exactly once.
 *
 * The gate's in-memory cache only lives for a page load, but a device that has
 * been sitting on the app (an Android WebView, a phone home-screen app, a
 * browser tab left open for days) is holding a session that was granted under
 * the OLD rules. Bumping this number makes each of those sessions invalid on
 * its very next check: the local session is signed out once, the cloud is
 * re-read, and only an account the database still unlocks gets back in.
 *
 * Bump this whenever the access rules change. Nothing in Supabase is touched.
 */
export const SESSION_VERSION = 3;
const SESSION_VERSION_KEY = "eamp_session_v3";

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

/** Drop any remembered answer for this email — used the moment a payment lands. */
export function invalidateAccessCache(email: string | null | undefined): void {
  const clean = (email ?? "").trim().toLowerCase();
  if (clean) cache.delete(clean);
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
  // owner included, now goes to computeFromDatabase below and is answered by
  // the ledger.
  if (!supabase) return null; // unconfigured — caller decides the fallback

  const cached = cache.get(clean);
  if (!options?.fresh && cached) {
    // Only a POSITIVE answer is worth holding for a minute. "unpaid" and
    // "revoked" are both refusals the owner can lift at any moment by
    // pressing Mark paid, so they get the short TTL like everything else.
    const ttl =
      cached.status === "paid" || cached.status === "admin" ? CACHE_TTL_MS : UNPAID_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.status;
  }

  try {
    const status = await computeFromDatabase(clean);
    cache.set(clean, { status, at: Date.now() });
    return status;
  } catch (error) {
    console.warn("[payment-gate] cloud check failed:", error);
    return null;
  }
}

/** Is any license key bound to this email? Exact match, then case-insensitive. */
async function emailHasLicenseKeyCloud(clean: string): Promise<boolean> {
  const { data: license } = await supabase!
    .from("license_keys")
    .select("key")
    .eq("email", clean)
    .limit(1)
    .maybeSingle();
  if (license) return true;
  const { data: licenseLoose } = await supabase!
    .from("license_keys")
    .select("key")
    .ilike("email", clean)
    .limit(1)
    .maybeSingle();
  return !!licenseLoose;
}

/**
 * DEVICE-BINDING LIVENESS — true when the cloud has a users row for this
 * email whose device_id no longer matches THIS device. Bindings are only
 * written at a fresh sign-in (and at key activation), so a cleared binding
 * means the session predates the global access reset and must end. The
 * check fails OPEN (network hiccup = no kick) so a flaky connection can
 * never log someone out.
 */
async function deviceBindingRevoked(email: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select("device_id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) return false;
    if (!row) return false; // no users row — the payment decision handles it
    const boundDeviceId = (row as { device_id?: string | null } | null)?.device_id ?? null;
    return boundDeviceId !== getDeviceId();
  } catch {
    return false;
  }
}

/**
 * EXPLICIT REVOCATION — has the owner marked this email UNPAID on purpose?
 *
 * `paid_emails` is the console's own payment ledger. `setUserPaid(email,
 * false)` writes a row for the email with `paid_at = null`: the row says "we
 * know this account, and the answer right now is NO". A row with a timestamp
 * is a normal payment and says nothing here.
 *
 * WHY THIS MUST BE CHECKED FIRST. Without it, "Mark unpaid" did not actually
 * revoke anybody: `computeFromDatabase` read `users.is_paid`, saw false, and
 * then fell through to the licence-key check — and because activating a key
 * binds a `license_keys` row to the email, that fallback answered "paid" and
 * reopened the app for the very person the owner had just locked out. The
 * console said unpaid; the gate said paid; the customer kept trading.
 *
 * A revocation marker is a DELIBERATE human decision, so it outranks every
 * derived signal below it (licence keys, Whop). Nothing outranks it — not an
 * admin flag, not a platform owner. The console's Reject button writes one of
 * these too, which is what makes "portal deactivated" a real verdict rather
 * than a message the app can only show to accounts it once let in.
 *
 * It answers with its own CloudAccess value ("revoked") rather than a bare
 * boolean folded into "unpaid", because "we revoked this" and "this person
 * never paid" are different messages and the login screen shows them
 * differently.
 *
 * Fails OPEN on a read error: an unreachable ledger must not lock out paying
 * customers. The other checks still decide in that case.
 */
async function isExplicitlyRevoked(clean: string): Promise<boolean> {
  if (!supabase) return false;
  // REJECTED IN THE ADMIN CONSOLE IS A REVOCATION. The owner pressing "Reject"
  // is the platform saying "this account is deactivated". Until this was
  // consulted, that decision lived only in `mentor_approvals` and nothing on a
  // phone ever read it — so a rejected member saw Choose Plan on sign-in, and
  // a rejected member with the app open kept it open. This is the ONLY thing
  // this module reads from `mentor_approvals`; "approved" is still never
  // consulted and still grants nothing.
  try {
    const { data: approval } = await supabase
      .from("mentor_approvals")
      .select("status")
      .eq("email", clean)
      .limit(1);
    const rows = Array.isArray(approval) ? approval : [];
    if (rows.some((row) => (row as { status?: string | null }).status === "rejected")) return true;
  } catch {
    /* a failed approval read falls through to the ledger check */
  }
  try {
    // `.limit(1)` rather than `.maybeSingle()`: a single-row read ERRORS with
    // PGRST116 when an earlier cleanup left two rows for one email, and an
    // error here would fail OPEN and quietly undo the revocation. Reading the
    // rows and asking "is any of them a marker?" cannot be defeated that way.
    const { data, error } = await supabase
      .from("paid_emails")
      .select("paid_at")
      .eq("email", clean)
      .limit(10);
    if (error || !Array.isArray(data) || data.length === 0) return false;
    return data.some((row) => (row as { paid_at?: string | null }).paid_at === null);
  } catch {
    return false;
  }
}

async function computeFromDatabase(clean: string): Promise<CloudAccess> {
  // THE OWNER'S EXPLICIT "UNPAID" IS THE FIRST WORD ON IT. See
  // isExplicitlyRevoked — every check after this one is a DERIVED signal, and
  // letting any of them override a deliberate revocation is what made "Mark
  // unpaid" a button that did nothing.
  if (await isExplicitlyRevoked(clean)) return "revoked";

  // THE APP OPENS FOR PAID ACCOUNTS. THAT IS THE WHOLE RULE. NOT EVEN FOR ADMINS.
  //
  // `users.is_admin` and `users.is_paid` used to grant access here. Both are
  // gone:
  //   • is_admin is a ROLE, not a payment. Reading it meant anybody an admin
  //     had flagged could open the trading app without paying a cent.
  //   • is_paid is a MIRROR of the ledger that the anon key is allowed to
  //     write, so it drifts and it can be set by anything holding the public
  //     key. The ledger row is the real record; the mirror is not.
  //
  // Mentor approval is a PORTAL decision and still has nothing to do with the
  // app: `isExplicitlyRevoked` above reads `mentor_approvals` for "rejected"
  // ONLY, so a rejection deactivates and an approval still grants nothing. An
  // unpaid email is sent to checkout, on every platform.
  const { data: ledger } = await supabase!
    .from("paid_emails")
    .select("paid_at")
    .eq("email", clean)
    .limit(10);
  const ledgerRows = (Array.isArray(ledger) ? ledger : []) as Array<{ paid_at?: string | null }>;
  if (ledgerRows.some((row) => row.paid_at != null)) return "paid";

  // A license_keys row bound to this email is payment in practice — the key
  // only exists because somebody paid for it. Exact match first, then a
  // case-insensitive fallback.
  if (await emailHasLicenseKeyCloud(clean)) return "paid";

  // Whop — the checkout source of truth, verified SERVER-side with the
  // WHOP_API_KEY (never from the browser). DYNAMIC import: supabase.server
  // reads process.env at module init and registers TanStack server
  // functions — statically importing it into the client graph crashed the
  // Android WebView bundle ("Dashboard didn't load"). Any failure here just
  // means "no Whop confirmation"; the database still decides.
  try {
    const { whopVerifyMembership } = await import("@/lib/supabase.server");
    const whop = await whopVerifyMembership({ data: { email: clean } });
    if (whop.ok && whop.paid) return "paid";
  } catch {
    /* server functions unavailable in this bundle — DB decision stands */
  }

  return "unpaid";
}

/**
 * The gate every /app route guard must await. Fail-closed for cloud-decided
 * unpaid emails; falls back to the legacy local store only when the cloud
 * cannot be reached at all (Supabase unconfigured) so dev never blocks.
 */
export async function requireVerifiedAccess(email: string | null): Promise<AppAccessCheck> {
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
  //
  // GLOBAL ACCESS RESET — everyone: if the database no longer binds this
  // device to the email (the reset cleared every binding), the stale session
  // is dead. appSignOut clears it ONCE and the route sends the person to
  // /app/login, where the cloud gate decides who gets back in: unpaid emails
  // go to checkout, paid emails re-bind on sign-in.
  if (await deviceBindingRevoked(email)) {
    appSignOut();
    return { action: "signin" };
  }
  let cloud: CloudAccess | null = null;
  try {
    cloud = await resolveCloudAccess(email);
  } catch {
    // NEVER let a gate error crash a route (that was the "Dashboard didn't
    // load" screen on Android) — an undecided cloud falls through to the
    // FAIL-CLOSED branch below, never to the local store.
    cloud = null;
  }
  if (cloud === "admin" || cloud === "paid") {
    // Reconcile the local store so in-app UI (which reads it) agrees with
    // the cloud decision. This is a downstream mirror, never the source.
    markEmailPaid(email);
    return { action: "pass" };
  }
  // DEACTIVATED BY THE OWNER. The database holds a revocation marker for this
  // email (`paid_emails.paid_at = null`) or a console REJECTION
  // (`mentor_approvals.status = 'rejected'`), which is a decision the owner
  // made in the console and not a missing payment record. It is answered HERE,
  // from the cloud, and never from this device's memory: the previous
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
    // A local PAID record beside an UNPAID cloud answer can still mean the
    // owner flipped the flag before the ledger marker existed (Mark unpaid on
    // an account whose `paid_emails` row had been cleaned up). Same outcome,
    // kept as a second door rather than the only one.
    //
    // ONLY a genuine local "paid" record counts. `paymentStatusForEmail` also
    // answers "admin" for the hardcoded payment-exempt list, and treating that
    // as evidence of a revoked payment would tell somebody who has simply never
    // been marked paid that they were deactivated — the wrong message for an
    // account that owes money and belongs at checkout.
    if (paymentStatusForEmail(email) === "paid") {
      appSignOut();
      return { action: "deactivate" };
    }
    // NEVER PAID — THE APP MUST NOT OPEN. The session ends here and the
    // caller sends the person to /app/login?pay=1, which renders the CHOOSE
    // PLAN screen (monthly + lifetime). This is `pay`, not `signin`: the
    // person has already told us who they are, so the email form would be a
    // pointless extra step in front of the only decision left — which plan.
    // Nothing inside the app may open for an unpaid account.
    appSignOut();
    return { action: "pay" };
  }
  // CLOUD UNDECIDED — FAIL CLOSED. This branch used to hand the decision back
  // to the legacy LOCAL store (`paymentStatusForEmail`), so a stale or forged
  // local "paid" record opened the app whenever Supabase could not answer: a
  // transient query error was enough. Nothing local may ever grant access, so
  // an undecidable account is treated exactly like an unpaid one and sent to
  // checkout — recoverable if the person really has paid, and a hole closed if
  // they have not. The in-app UI reconciles from the cloud, never from here.
  return { action: "pay" };
}

/**
 * Verify a Whop checkout return (?success=true). Returns true ONLY when the
 * database or the server-side Whop check confirms payment. Never trusts the
 * URL parameter itself, and never consults mentor approval.
 */
export async function verifyPaymentReturn(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  try {
    // ALWAYS FRESH — this is the moment somebody has just handed over money
    // and is waiting on the answer. A cached "unpaid" here sends a paying
    // customer straight back to the checkout page they just completed.
    const cloud = await resolveCloudAccess(clean, { fresh: true });
    if (cloud === "admin" || cloud === "paid") {
      markEmailPaid(clean);
      return true;
    }
    if (cloud === "unpaid" || cloud === "revoked") return false;
  } catch {
    /* fall through to the explicit Whop check */
  }
  // resolveCloudAccess already ran the Whop check inside computeFromDatabase
  // for the unpaid branch — run it explicitly here for a fresh answer.
  try {
    const { whopVerifyMembership } = await import("@/lib/supabase.server");
    const whop = await whopVerifyMembership({ data: { email: clean } });
    if (whop.ok && whop.paid) {
      markEmailPaid(clean);
      return true;
    }
  } catch {
    /* server functions unavailable */
  }
  return false;
}
