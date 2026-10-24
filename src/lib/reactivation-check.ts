/**
 * CAN THIS EMAIL BE REACTIVATED? — answered from the stores the LOGIN flow
 * actually trusts, not from one table.
 *
 * THE BUG THIS CLOSES
 * The mentor portal's Re-activate Client page asked Supabase `users` only
 * (`getUserByEmail`). A client whose registration lives in the Upstash KV
 * registration store — which is where AGENTS.md says registrations, approval
 * state and the payment flag belong — has no `users` row until they first sign
 * in to the app, so a real, paid customer was told "this is not your client's
 * registered email" and could not be released.
 *
 * WHAT IS ASKED, AND WHY EACH ONE COUNTS
 *   users            — the app's own row (id / is_paid / is_admin).
 *   kvRegistered     — the KV registration record (/api/mentor-status). This is
 *                      the store the admin console registers, approves and marks
 *                      paid in, so an email here IS a registered account.
 *   paidLedger       — the `paid_emails` ledger with a real `paid_at`.
 *   cloudAccess      — /api/check-access, the ONE verdict the login gate reads
 *                      (KV record → paid ledger → portal payments → licence
 *                      key → Whop).
 *   mentorKeys       — licence keys issued to / held by the email in the KV
 *                      licence store (plus the legacy Supabase table). A key IS
 *                      payment for a client — the same rule the app's gate and
 *                      the old page already applied.
 *   portalAccounts   — the mentor portal account row for the email AND its own
 *                      payment record (`portal_payments`). Marked paid on the
 *                      portal is payment on its own.
 *
 * A FAILED READ IS NEVER A VERDICT.
 *
 * Every store is asked inside its own try/catch, retried once two seconds
 * later, and records either its answer or `unavailable` together with the
 * exact address, HTTP status and cause. One unreachable store used to reject
 * the whole `Promise.all` — the page then threw a raw `TypeError: Failed to
 * fetch` at the mentor with no diagnostic at all. Now the check COMPLETES with
 * the stores that answered, and when a paid record could not be read it says
 * "could not complete — one record source was unreachable" instead of
 * pretending the client is unpaid.
 *
 * The check is DELIBERATELY read-only: it never marks anybody paid, never
 * touches a licence key, an expiry date or a subscription. Reactivation itself
 * stays a device-unbinding action.
 */
import { OWNER_EMAILS, isPaymentExemptEmail } from "./auth-store";
import { countLicensesInKv } from "./license-cloud";
import { describeError, readPortalAccount, PORTAL_RETRY_DELAY_MS } from "./portal-paid";
import {
  checkAccessServer,
  emailHasLicenseKey,
  emailPaidInLedger,
  getUserByEmail,
} from "./supabase-users";

export type ReactivationStoreName =
  | "users"
  | "kvRegistered"
  | "paidLedger"
  | "cloudAccess"
  | "mentorKeys"
  | "portalAccounts";

export type ReactivationStoreAnswer = {
  /** Which store was asked. */
  store: ReactivationStoreName;
  /** What it answered, in words — shown verbatim in the diagnostic line. */
  answer: string;
  /** The store knows this email. */
  registered: boolean;
  /** The store says the email has paid. */
  paid: boolean;
  /**
   * The store COULD NOT BE READ. Never counted as "no" — the caller must not
   * refuse a client on the strength of a failed request.
   */
  unavailable?: boolean;
};

export type ReactivationCheck = {
  email: string;
  /** At least one store knows the email. */
  registered: boolean;
  /** At least one authoritative store says it has paid (or it is exempt). */
  paid: boolean;
  /** True when at least one record source could not be read. */
  incomplete: boolean;
  /** A specific, user-facing refusal when reactivation must not proceed. */
  error?: string;
  /** One line: every store that was asked and what it answered. */
  diagnostic: string;
  stores: ReactivationStoreAnswer[];
};

/** The plain message shown when a source could not be read — never a TypeError. */
export const UNREACHABLE_SOURCE_MESSAGE =
  "Re-activation check could not complete — one record source was unreachable. Please try again.";

const STORE_LABELS: Record<ReactivationStoreName, string> = {
  users: "users table",
  kvRegistered: "KV registrations",
  paidLedger: "paid ledger",
  cloudAccess: "cloud access gate",
  mentorKeys: "mentor licence keys",
  portalAccounts: "portal accounts",
};

function clean(email: string): string {
  return email.trim().toLowerCase();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ONE LINE FOR THE LOGS AND THE SCREEN — built from the per-store answers so
 * the two can never disagree about what was checked.
 */
export function formatReactivationDiagnostic(
  email: string,
  stores: ReadonlyArray<ReactivationStoreAnswer>,
): string {
  const parts = stores.map((entry) => `${STORE_LABELS[entry.store]}: ${entry.answer}`);
  return `[reactivation] ${email} — ${parts.join(" | ")}`;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; detail: string };

/**
 * RUN A STORE READ AT MOST TWICE.
 *
 * The first failure is retried two seconds later: a cold function or a dropped
 * socket is not an answer. Both failures are reported with their own message —
 * the caller turns that into `unavailable`, never into a refusal.
 */
async function attemptTwice<T>(label: string, run: () => Promise<T>): Promise<Attempt<T>> {
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      last = describeError(error);
      if (attempt === 1) {
        console.warn(
          `[reactivation] ${label} attempt 1 failed: ${last} — retrying once in ${PORTAL_RETRY_DELAY_MS}ms`,
        );
        await wait(PORTAL_RETRY_DELAY_MS);
      }
    }
  }
  return { ok: false, detail: last };
}

function unavailable(store: ReactivationStoreName, detail: string): ReactivationStoreAnswer {
  return { store, answer: `unavailable (${detail})`, registered: false, paid: false, unavailable: true };
}

/** The KV registration record's existence — the admin console's own store. */
async function askKvRegistration(email: string): Promise<ReactivationStoreAnswer> {
  const store: ReactivationStoreName = "kvRegistered";
  if (typeof window === "undefined") {
    return { store, answer: "not asked (no browser)", registered: false, paid: false };
  }
  const url = "/api/mentor-status";
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const reply = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(12_000),
      });
      if (reply.status === 503) {
        lastFailure = `${url} → HTTP 503 (registration store unavailable)`;
        if (attempt === 1) {
          await wait(PORTAL_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
      const payload = (await reply.json().catch(() => null)) as
        | { ok?: boolean; found?: boolean; status?: string }
        | null;
      // A static host answers /api/* with the SPA shell — HTML is not an answer.
      if (!payload || typeof payload.ok !== "boolean") {
        return unavailable(
          store,
          `${url} → HTTP ${reply.status} but the body was not the registration record (is the API deployed?)`,
        );
      }
      if (!reply.ok) {
        return unavailable(store, `${url} → HTTP ${reply.status} ${reply.statusText || ""}`.trim());
      }
      if (payload.found !== true) {
        return { store, answer: "no registration", registered: false, paid: false };
      }
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      return { store, answer: `registered (${status})`, registered: true, paid: false };
    } catch (error) {
      lastFailure = `${url} → no HTTP response (${describeError(error)})`;
      if (attempt === 1) {
        console.warn(`[reactivation] ${lastFailure} — retrying once in ${PORTAL_RETRY_DELAY_MS}ms`);
        await wait(PORTAL_RETRY_DELAY_MS);
      }
    }
  }
  return unavailable(store, lastFailure || `${url} → unknown failure`);
}

/** The mentor portal account row plus the portal's own payment record. */
async function askPortalAccounts(email: string): Promise<ReactivationStoreAnswer> {
  const store: ReactivationStoreName = "portalAccounts";
  const portal = await readPortalAccount(email);

  if (portal.state === "unavailable") {
    return unavailable(store, portal.detail);
  }
  if (portal.state === "not-configured") {
    return {
      store,
      answer: `not checked — ${portal.detail}`,
      registered: false,
      paid: false,
      unavailable: true,
    };
  }
  return {
    store,
    answer: portal.detail,
    registered: portal.state === "account",
    paid: portal.paid,
  };
}

/**
 * MENTOR CLIENTS — a licence key issued to (or held by) this email.
 *
 * The KV licence store is the live one; the Supabase `license_keys` table is
 * still read because keys issued before the move live there. Either way a key
 * is payment, and a paid client must be releasable.
 */
async function askMentorKeys(email: string): Promise<ReactivationStoreAnswer> {
  const store: ReactivationStoreName = "mentorKeys";
  const legacyRead = await attemptTwice("license_keys", () => emailHasLicenseKey(email));
  const legacy = legacyRead.ok ? legacyRead.value : false;
  const kvRead = await attemptTwice("KV licence keys", () => countLicensesInKv(email));

  if (!kvRead.ok) {
    return legacy
      ? { store, answer: "legacy key (KV unreachable)", registered: true, paid: true }
      : unavailable(store, `KV licence store unreachable — ${kvRead.detail}`);
  }

  const kv = kvRead.value;
  if (kv.enabled && kv.ok) {
    const count = Number.isFinite(kv.count) ? kv.count : 0;
    const answers: string[] = [];
    if (count > 0) answers.push(`${count} key${count === 1 ? "" : "s"}`);
    if (legacy) answers.push("legacy key");
    const registered = count > 0 || legacy;
    return {
      store,
      answer: registered ? answers.join(" + ") : "no keys issued",
      registered,
      paid: registered,
    };
  }

  if (legacy) {
    return { store, answer: "legacy key (KV unavailable)", registered: true, paid: true };
  }
  return unavailable(
    store,
    legacyRead.ok ? "KV licence store unavailable and no legacy key" : `legacy key read failed — ${legacyRead.detail}`,
  );
}

/**
 * ASK EVERY STORE, IN PARALLEL — EACH INSIDE ITS OWN GUARD.
 *
 * Read-only by construction: nothing here writes, and the only consequence of a
 * "yes" is that the caller may clear a device binding.
 */
export async function checkReactivationEmail(input: string): Promise<ReactivationCheck> {
  const email = clean(input);

  const [userRead, kvRegistered, ledgerRead, cloudRead, mentorKeys, portalAccounts] = await Promise.all([
    attemptTwice("users table", () => getUserByEmail(email)),
    askKvRegistration(email),
    attemptTwice("paid ledger", () => emailPaidInLedger(email)),
    attemptTwice("cloud access gate", () => checkAccessServer(email)),
    askMentorKeys(email),
    askPortalAccounts(email),
  ]);

  const exempt = isPaymentExemptEmail(email) || OWNER_EMAILS.includes(email);

  const users: ReactivationStoreAnswer = !userRead.ok
    ? unavailable("users", userRead.detail)
    : {
        store: "users",
        answer: userRead.value
          ? `row found${userRead.value.is_paid ? " (paid)" : ""}${userRead.value.is_admin ? " (admin)" : ""}`
          : "no row",
        registered: Boolean(userRead.value),
        paid: Boolean(userRead.value?.is_paid || userRead.value?.is_admin),
      };

  const paidLedger: ReactivationStoreAnswer = !ledgerRead.ok
    ? unavailable("paidLedger", ledgerRead.detail)
    : {
        store: "paidLedger",
        answer: ledgerRead.value ? "paid" : "not paid",
        registered: ledgerRead.value,
        paid: ledgerRead.value,
      };

  const cloudAccess: ReactivationStoreAnswer = !cloudRead.ok
    ? unavailable("cloudAccess", cloudRead.detail)
    : !cloudRead.value.ok
      ? unavailable("cloudAccess", "the access endpoint could not decide (one of ITS sources was unreachable)")
      : {
          store: "cloudAccess",
          answer: String(cloudRead.value.status),
          // "paid"/"admin" mean a KV record, the ledger, the portal payment
          // record or a licence key answered positively.
          registered: cloudRead.value.status === "paid" || cloudRead.value.status === "admin",
          paid: cloudRead.value.status === "paid" || cloudRead.value.status === "admin",
        };

  const stores: ReactivationStoreAnswer[] = [
    users,
    kvRegistered,
    paidLedger,
    cloudAccess,
    mentorKeys,
    portalAccounts,
  ];
  const paid = exempt || stores.some((entry) => entry.paid);
  const registered = paid || stores.some((entry) => entry.registered);
  const incomplete = stores.some((entry) => entry.unavailable === true);
  const diagnostic = formatReactivationDiagnostic(email, stores);
  console.info(diagnostic);

  if (paid) {
    return { email, registered: true, paid: true, incomplete, diagnostic, stores };
  }

  // A SOURCE WE COULD NOT READ COULD BE THE ONE THAT KNOWS THIS EMAIL. Saying
  // "not registered" or "not paid" would be a guess dressed as a verdict.
  if (incomplete) {
    return {
      email,
      registered,
      paid: false,
      incomplete,
      diagnostic,
      stores,
      error: UNREACHABLE_SOURCE_MESSAGE,
    };
  }

  if (!registered) {
    return {
      email,
      registered: false,
      paid: false,
      incomplete,
      diagnostic,
      stores,
      error: `Not reactivated — ${email} is not registered in any store.`,
    };
  }
  return {
    email,
    registered: true,
    paid: false,
    incomplete,
    diagnostic,
    stores,
    error:
      "Not reactivated — this email is registered but not marked paid. " +
      "Ask the platform admin to mark it paid (KV registration / paid ledger / portal payment), then try again.",
  };
}
