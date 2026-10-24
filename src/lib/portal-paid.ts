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
// THE PORTAL'S OWN PAY RECORD, READ FROM UPSTASH KV.
//
// AGENTS.md: registrations, approval state, payment flags and licence limits
// live in the Vercel KV/Upstash store behind /api/register, /api/admin-users
// and /api/admin-approve. The portal's payment flag is one of those records,
// not a Supabase table. This module reads only that KV record over the same
// REST setup the /api/register and /api/admin-approve checks use, so a
// browser build with no Supabase credentials is still a healthy one for
// this purpose.

/** The Upstash REST path the admin console's `Mark paid` writes through, one
 * store above the raw registration hash where the paid flag lives.
 * /api/check-access and /api/mentor-status read the same shape. */
const KV_PAID_PATH = "/api/portal-payments";

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

function restUrl(path: string): string {
  return `${KV_PAID_PATH}${path}`;
}

/** Ask the portal's payment flag over the same REST client the other KV checks
 * use. A network-level failure has no status, so the probe reports "no
 * response" plus the cause instead of inventing a number. */
async function probeStatus(): Promise<string> {
  const url = KV_PAID_PATH + "?select=email,paid,paid_at&limit=1";
  const apiKey = import.meta.env["VITE_KV_API_KEY"] as string | undefined;
  const host = import.meta.env["VITE_KV_REST_HOST"] as string | undefined;
  if (!host || !apiKey) return `no VITE_KV_REST_HOST or VITE_KV_API_KEY in this build`;
  try {
    const reply = await fetch(`${host}${url}`, {
      headers: {
        "content-type": "application/json",
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    return `HTTP ${reply.status}${reply.ok ? "" : ` ${reply.statusText || "error"}`}`;
  } catch (error) {
    return `no HTTP response (${describeError(error)})`;
  }
}

type QueryReply = { data?: unknown; error?: { message?: string } | null };

async function readRows(build: (url: string, apiKey: string) => Promise<QueryReply>): Promise<{ rows: Array<Record<string, unknown>> } | { failure: string }> {
  const host = import.meta.env["VITE_KV_REST_HOST"] as string | undefined;
  const apiKey = import.meta.env["VITE_KV_API_KEY"] as string | undefined;
  if (!host || !apiKey) {
    return {
      failure: `KV is not configured in this build (VITE_KV_REST_HOST ${host ? "is set" : "missing"}, VITE_KV_API_KEY ${apiKey ? "is set" : "missing"})`,
    };
  }
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const reply = await build(host, apiKey);
      if (reply.error) throw new Error(reply.error.message ?? "unknown KV error");
      const rows = Array.isArray(reply.data) ? (reply.data as Array<Record<string, unknown>>) : [];
      return { rows };
    } catch (error) {
      lastFailure = describeError(error);
      if (attempt === 1) {
        console.warn(`[portal] ${KV_PAID_PATH} attempt 1 failed: ${lastFailure} — retrying once in ${PORTAL_RETRY_DELAY_MS}ms`);
        await delay(PORTAL_RETRY_DELAY_MS);
      }
    }
  }
  const status = await probeStatus();
  const detail = `${KV_PAID_PATH} → ${lastFailure} · probe: ${status}`;
  console.warn(`[portal] ${detail}`);
  return { failure: detail };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Is this email PAID according to the portal's own payment record?
 * The read never throws and never reports "not paid" for a failed request. */
export async function readPortalPayment(email: string): Promise<PortalPaymentRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "not-paid", detail: "no email to check" };

  const result = await readRows((host, apiKey) =>
    fetch(`${host}${KV_PAID_PATH}?email=${encodeURIComponent(clean)}&select=paid,paid_at&limit=1`, {
      headers: { apikey: apiKey, authorization: `Bearer ${apiKey}` },
    }).then((reply) => reply.json() as Promise<QueryReply>),
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

/** The portal ACCOUNT row for this email, plus its payment record.
 * Registration alone is never payment — that split is preserved here. */
export async function readPortalAccount(email: string): Promise<PortalAccountRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "no-account", paid: false, detail: "no email to check" };

  const payment = await readPortalPayment(clean);
  const result = await readRows((host, apiKey) =>
    fetch(`${host}${KV_PAID_PATH}?email=${encodeURIComponent(clean)}&select=email&limit=1`, {
      headers: { apikey: apiKey, authorization: `Bearer ${apiKey}` },
    }).then((reply) => reply.json() as Promise<QueryReply>),
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

/** One retry, this long after the first failure. */
