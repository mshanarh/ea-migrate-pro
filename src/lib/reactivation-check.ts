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
 *                      (KV record → paid ledger → claimed licence key → Whop).
 *   mentorKeys       — licence keys issued to / held by the email in the KV
 *                      licence store (plus the legacy Supabase table). A key IS
 *                      payment for a client — the same rule the app's gate and
 *                      the old page already applied.
 *   portalAccounts   — a mentor portal account row for the email (accounts that
 *                      registered on the portal before the KV store existed).
 *
 * The check is DELIBERATELY read-only: it never marks anybody paid, never
 * touches a licence key, an expiry date or a subscription. Reactivation itself
 * stays a device-unbinding action.
 *
 * FAILURES ARE REPORTED, NOT GUESSED: every store records what it answered, and
 * `diagnostic` is one line naming all of them — logged in the console and shown
 * on screen — so a refusal says exactly which store is missing the email.
 */
import { OWNER_EMAILS, isPaymentExemptEmail } from "./auth-store";
import { countLicensesInKv } from "./license-cloud";
import { supabase, supabaseConfigured } from "./supabase";
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
};

export type ReactivationCheck = {
  email: string;
  /** At least one store knows the email. */
  registered: boolean;
  /** At least one authoritative store says it has paid (or it is exempt). */
  paid: boolean;
  /** A specific, user-facing refusal when reactivation must not proceed. */
  error?: string;
  /** One line: every store that was asked and what it answered. */
  diagnostic: string;
  stores: ReactivationStoreAnswer[];
};

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

/** The KV registration record's existence — the admin console's own store. */
async function askKvRegistration(email: string): Promise<ReactivationStoreAnswer> {
  const store: ReactivationStoreName = "kvRegistered";
  if (typeof window === "undefined") {
    return { store, answer: "not asked (no browser)", registered: false, paid: false };
  }
  try {
    const reply = await fetch("/api/mentor-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(12_000),
    });
    if (reply.status === 503) {
      return { store, answer: "store unavailable", registered: false, paid: false };
    }
    const payload = (await reply.json().catch(() => null)) as
      | { ok?: boolean; found?: boolean; status?: string }
      | null;
    // A static host answers /api/* with the SPA shell — HTML is not an answer.
    if (!payload || typeof payload.ok !== "boolean") {
      return { store, answer: "store unavailable", registered: false, paid: false };
    }
    if (payload.found !== true) {
      return { store, answer: "no registration", registered: false, paid: false };
    }
    const status = typeof payload.status === "string" ? payload.status : "unknown";
    return { store, answer: `registered (${status})`, registered: true, paid: false };
  } catch {
    return { store, answer: "store unreachable", registered: false, paid: false };
  }
}

/** A mentor portal account row — where pre-KV portal registrations live. */
async function askPortalAccounts(email: string): Promise<ReactivationStoreAnswer> {
  const store: ReactivationStoreName = "portalAccounts";
  if (!supabaseConfigured || !supabase) {
    return { store, answer: "not configured", registered: false, paid: false };
  }
  try {
    const { data, error } = await supabase
      .from("portal_accounts")
      .select("email")
      .eq("email", email)
      .limit(1);
    if (error) return { store, answer: `read failed (${error.message})`, registered: false, paid: false };
    const found = Array.isArray(data) && data.length > 0;
    return { store, answer: found ? "account found" : "no account", registered: found, paid: false };
  } catch {
    return { store, answer: "read failed", registered: false, paid: false };
  }
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
  const legacy = await emailHasLicenseKey(email).catch(() => false);
  try {
    const kv = await countLicensesInKv(email);
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
    return {
      store,
      answer: legacy ? "legacy key (KV unavailable)" : "store unavailable — no legacy key",
      registered: legacy,
      paid: legacy,
    };
  } catch {
    return {
      store,
      answer: legacy ? "legacy key (KV unreachable)" : "store unreachable — no legacy key",
      registered: legacy,
      paid: legacy,
    };
  }
}

/**
 * ASK EVERY STORE, IN PARALLEL, THEN DECIDE ONCE.
 *
 * Read-only by construction: nothing here writes, and the only consequence of a
 * "yes" is that the caller may clear a device binding.
 */
export async function checkReactivationEmail(input: string): Promise<ReactivationCheck> {
  const email = clean(input);
  const [user, kvRegistered, ledgerPaid, cloud, mentorKeys, portalAccounts] = await Promise.all([
    getUserByEmail(email).catch(() => null),
    askKvRegistration(email),
    emailPaidInLedger(email).catch(() => false),
    checkAccessServer(email).catch(() => ({ ok: false, isPaid: false, status: "unpaid" as const })),
    askMentorKeys(email),
    askPortalAccounts(email),
  ]);

  const exempt = isPaymentExemptEmail(email) || OWNER_EMAILS.includes(email);

  const users: ReactivationStoreAnswer = {
    store: "users",
    answer: user
      ? `row found${user.is_paid ? " (paid)" : ""}${user.is_admin ? " (admin)" : ""}`
      : "no row",
    registered: Boolean(user),
    paid: Boolean(user?.is_paid || user?.is_admin),
  };
  const paidLedger: ReactivationStoreAnswer = {
    store: "paidLedger",
    answer: ledgerPaid ? "paid" : "not paid",
    registered: ledgerPaid,
    paid: ledgerPaid,
  };
  const cloudAccess: ReactivationStoreAnswer = {
    store: "cloudAccess",
    answer: cloud.ok ? String(cloud.status) : "unavailable",
    // "paid"/"admin" mean a KV record or the ledger answered positively.
    registered: cloud.ok && (cloud.status === "paid" || cloud.status === "admin"),
    paid: cloud.ok && (cloud.status === "paid" || cloud.status === "admin"),
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
  const diagnostic = formatReactivationDiagnostic(email, stores);

  if (!registered) {
    return {
      email,
      registered: false,
      paid: false,
      diagnostic,
      stores,
      error:
        `Not reactivated — ${email} is not registered in any store. ` +
        `Checked: ${stores.map((entry) => `${STORE_LABELS[entry.store]} (${entry.answer})`).join(", ")}.`,
    };
  }
  if (!paid) {
    return {
      email,
      registered: true,
      paid: false,
      diagnostic,
      stores,
      error:
        `Not reactivated — this email is registered but not marked paid. ` +
        `Ask the platform admin to mark it paid (KV registration / paid ledger), then try again. ` +
        `Detail: ${diagnostic}`,
    };
  }
  return { email, registered: true, paid: true, diagnostic, stores };
}
