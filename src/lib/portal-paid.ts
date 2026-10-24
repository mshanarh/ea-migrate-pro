/**
 * THE PORTAL'S PAID RECORD, READ HONESTLY.
 *
 * Every viewer of this file has the same problem: a Supabase read that fails
 * with a bare `TypeError: Failed to fetch` tells nobody WHY. The address of the
 * table, the HTTP status and the underlying cause are the three facts needed to
 * tell a wrong URL from a CORS block from a server error, so they are captured
 * here, together with ONE retry two seconds later (a cold lambda or a dropped
 * socket is not an answer).
 *
 * STATES, AND WHAT THEY MEAN
 *   paid           — `portal_payments.paid = true` (the portal's own payment
 *                    record; being paid here is enough on its own).
 *   not-paid       — the store answered and has no paid record.
 *   unavailable    — the store could not be reached. THIS IS NOT "NOT PAID":
 *                    callers must never turn it into a refusal.
 *   not-configured — this build has no Supabase credentials at all. Also not
 *                    evidence of anything, but it is a deployment fact rather
 *                    than a network failure, so it is kept separate.
 */
import { supabase, supabaseConfigured } from "./supabase";

const SUPABASE_URL = ((import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ?? "").trim();
const SUPABASE_ANON_KEY = ((import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ?? "").trim();

/** One retry, this long after the first failure. */
export const PORTAL_RETRY_DELAY_MS = 2000;

export type PortalReadState = "paid" | "not-paid" | "unavailable" | "not-configured";

export type PortalPaymentRead = {
  state: PortalReadState;
  /** Timestamp the portal recorded, when it has one. */
  paidAt?: string;
  /** One line for a diagnostic block — never shown as the user-facing error. */
  detail: string;
};

export type PortalAccountRead = {
  state: "account" | "no-account" | "unavailable" | "not-configured";
  /** True when the portal's own payment record says paid. */
  paid: boolean;
  paidAt?: string;
  detail: string;
};

/** Describe any thrown value — including a fetch failure's `cause`. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeText =
      cause === undefined
        ? ""
        : ` (cause: ${typeof cause === "string" ? cause : ((cause as Error)?.message ?? String(cause))})`;
    return `${error.name}: ${error.message}${causeText}`;
  }
  return String(error);
}

function restUrl(table: string): string {
  return `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${table}`;
}

/**
 * Ask the REST endpoint directly for a status code.
 *
 * A network-level failure in `fetch` (CORS, DNS, offline) has NO status, and
 * that distinction is exactly what the diagnostic has to preserve — so the
 * probe reports "no response" plus the cause instead of inventing a number.
 */
async function probeStatus(table: string): Promise<string> {
  if (!SUPABASE_URL) return "no VITE_SUPABASE_URL in this build";
  const suffix = `?select=email&limit=1`;
  if (!SUPABASE_ANON_KEY) return `${restUrl(table)}${suffix} → no VITE_SUPABASE_ANON_KEY in this build`;
  try {
    const reply = await fetch(`${restUrl(table)}${suffix}`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(8_000),
    });
    return `HTTP ${reply.status}${reply.ok ? "" : ` ${reply.statusText || "error"}`}`;
  } catch (error) {
    return `no HTTP response (${describeError(error)})`;
  }
}

/** Wait between attempts — exported so a test never has to sleep for real. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type QueryReply = { data?: unknown; error?: { message?: string } | null };

async function readRows(
  table: string,
  columns: string,
  build: (client: NonNullable<typeof supabase>) => PromiseLike<QueryReply>,
): Promise<{ rows: Array<Record<string, unknown>> } | { failure: string }> {
  if (!supabaseConfigured || !supabase) {
    return {
      failure: `Supabase is not configured in this build (VITE_SUPABASE_URL ${SUPABASE_URL ? "is set" : "is missing"}, anon key ${SUPABASE_ANON_KEY ? "is set" : "is missing"})`,
    };
  }
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const reply = await build(supabase);
      if (reply.error) throw new Error(reply.error.message ?? "unknown Supabase error");
      const rows = Array.isArray(reply.data) ? (reply.data as Array<Record<string, unknown>>) : [];
      return { rows };
    } catch (error) {
      lastFailure = describeError(error);
      if (attempt === 1) {
        console.warn(
          `[portal] ${restUrl(table)} (${columns}) attempt 1 failed: ${lastFailure} — retrying once in ${PORTAL_RETRY_DELAY_MS}ms`,
        );
        await delay(PORTAL_RETRY_DELAY_MS);
      }
    }
  }
  const status = await probeStatus(table);
  const detail = `${restUrl(table)} (${columns}) → ${lastFailure} · probe: ${status}`;
  console.warn(`[portal] ${detail}`);
  return { failure: detail };
}

/**
 * Is this email PAID according to the portal's own payment record?
 * The read never throws and never reports "not paid" for a failed request.
 */
export async function readPortalPayment(email: string): Promise<PortalPaymentRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "not-paid", detail: "no email to check" };
  if (!supabaseConfigured || !supabase) {
    return {
      state: "not-configured",
      detail: `portal_payments not readable: Supabase is not configured (VITE_SUPABASE_URL ${SUPABASE_URL ? "set" : "missing"})`,
    };
  }

  const result = await readRows("portal_payments", "paid,paid_at", (client) =>
    client.from("portal_payments").select("paid, paid_at").eq("email", clean).limit(1),
  );
  if ("failure" in result) return { state: "unavailable", detail: result.failure };

  const row = result.rows[0];
  if (!row) return { state: "not-paid", detail: "no portal payment record" };
  const paidAt = typeof row["paid_at"] === "string" ? (row["paid_at"] as string) : undefined;
  const paid = row["paid"] === true || Boolean(paidAt);
  return {
    state: paid ? "paid" : "not-paid",
    ...(paidAt ? { paidAt } : {}),
    detail: paid ? `portal payment paid${paidAt ? ` at ${paidAt}` : ""}` : "portal payment not paid",
  };
}

/**
 * The portal ACCOUNT row for this email, plus its payment record.
 * Registration alone is never payment — that split is preserved here.
 */
export async function readPortalAccount(email: string): Promise<PortalAccountRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "no-account", paid: false, detail: "no email to check" };
  if (!supabaseConfigured || !supabase) {
    return {
      state: "not-configured",
      paid: false,
      detail: `portal_accounts not readable: Supabase is not configured (VITE_SUPABASE_URL ${SUPABASE_URL ? "set" : "missing"})`,
    };
  }

  const payment = await readPortalPayment(clean);
  const result = await readRows("portal_accounts", "email", (client) =>
    client.from("portal_accounts").select("email").eq("email", clean).limit(1),
  );
  if ("failure" in result) {
    return {
      state: "unavailable",
      paid: payment.state === "paid",
      ...(payment.paidAt ? { paidAt: payment.paidAt } : {}),
      detail: result.failure,
    };
  }

  const found = result.rows.length > 0;
  const paymentText =
    payment.state === "paid"
      ? "paid"
      : payment.state === "not-paid"
        ? "not paid"
        : payment.state === "not-configured"
          ? "payment store not configured"
          : `payment read unavailable (${payment.detail})`;
  return {
    state: found ? "account" : "no-account",
    paid: payment.state === "paid",
    ...(payment.paidAt ? { paidAt: payment.paidAt } : {}),
    detail: found ? `account found · ${paymentText}` : `no account · ${paymentText}`,
  };
}
