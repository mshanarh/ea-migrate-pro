/**
 * THE PORTAL'S PAID RECORD, READ THROUGH THE SERVER.
 *
 * The portal's account + payment flag live in Upstash KV. KV credentials must
 * never reach the browser, so this module does not talk to KV at all: it calls
 * `/api/kv/portal-accounts`, which reads KV with the deployment's own
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN` (falling back to the read-only
 * token) and answers with a plain verdict plus a diagnostic line naming the
 * variable it used.
 *
 * STATES, AND WHAT THEY MEAN
 *   paid           — the portal's own KV payment flag says paid (`isPaid` with
 *                    a `paidAt`). Being paid here is enough on its own.
 *   not-paid       — KV answered and has no paid record.
 *   unavailable    — KV could not be read (missing server variables, network).
 *                    THIS IS NOT "NOT PAID": callers must never turn it into a
 *                    refusal.
 *   not-configured — kept for compatibility; same handling as unavailable.
 *
 * A failed read is retried ONCE, two seconds later, before it is reported.
 */

/** Where the server reads the portal account from. */
const ENDPOINT = "/api/kv/portal-accounts";

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
        : ` (cause: ${typeof cause === "string" ? cause : ((error as { cause?: { message?: string } }).cause?.message ?? String(cause))})`;
    return `${error.name}: ${error.message}${causeText}`;
  }
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ServerAnswer = {
  ok?: boolean;
  configured?: boolean;
  reachable?: boolean;
  registered?: boolean;
  paid?: boolean;
  paidAt?: string | null;
  variables?: { urlVar?: string | null; tokenVar?: string | null };
  detail?: string;
};

type PortalRead =
  | { kind: "ok"; answer: ServerAnswer }
  | { kind: "unavailable"; detail: string };

/**
 * ONE server read, retried once. The server already names the variable it used
 * (or the one missing), so the detail line is actionable instead of
 * "Failed to fetch".
 */
async function readFromServer(email: string): Promise<PortalRead> {
  const url = `${ENDPOINT}?email=${encodeURIComponent(email)}`;
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const reply = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (reply.status === 404) {
        // The route itself is missing from this deployment — a real answer.
        return { kind: "unavailable", detail: `${ENDPOINT} → HTTP 404 (route not deployed)` };
      }
      if (!reply.ok) {
        lastFailure = `${ENDPOINT} → HTTP ${reply.status} ${reply.statusText || ""}`.trim();
      } else {
        const answer = (await reply.json().catch(() => null)) as ServerAnswer | null;
        if (answer) return { kind: "ok", answer };
        lastFailure = `${ENDPOINT} → empty response body`;
      }
    } catch (error) {
      lastFailure = `${ENDPOINT} → no HTTP response (${describeError(error)})`;
    }
    if (attempt === 1) {
      console.warn(`[portal] ${lastFailure} — retrying once in ${PORTAL_RETRY_DELAY_MS}ms`);
      await delay(PORTAL_RETRY_DELAY_MS);
    }
  }
  return { kind: "unavailable", detail: lastFailure || `${ENDPOINT} → unknown failure` };
}

function serverDetail(answer: ServerAnswer, fallback: string): string {
  if (answer.detail) return answer.detail;
  const variables = answer.variables;
  if (variables?.urlVar) return `KV via ${variables.urlVar}`;
  return fallback;
}

/** Is this email PAID according to the portal's own payment record?
 * The read never throws and never reports "not paid" for a failed request. */
export async function readPortalPayment(email: string): Promise<PortalPaymentRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "not-paid", detail: "no email to check" };

  const read = await readFromServer(clean);
  if (read.kind === "unavailable") {
    return { state: "unavailable", detail: read.detail };
  }

  const { answer } = read;
  if (answer.configured === false || answer.reachable === false) {
    return { state: "unavailable", detail: serverDetail(answer, "portal KV unreachable") };
  }
  const paidAt = typeof answer.paidAt === "string" && answer.paidAt ? answer.paidAt : undefined;
  if (answer.paid === true) {
    return {
      state: "paid",
      ...(paidAt ? { paidAt } : {}),
      detail: serverDetail(answer, `portal payment paid${paidAt ? ` at ${paidAt}` : ""}`),
    };
  }
  return {
    state: "not-paid",
    detail: serverDetail(answer, answer.registered === false ? "no portal account" : "portal payment not paid"),
  };
}

/** The portal ACCOUNT row for this email, plus its payment record.
 * Registration alone is never payment — that split is preserved here. */
export async function readPortalAccount(email: string): Promise<PortalAccountRead> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { state: "no-account", paid: false, detail: "no email to check" };

  const read = await readFromServer(clean);
  if (read.kind === "unavailable") {
    return { state: "unavailable", paid: false, detail: read.detail };
  }

  const { answer } = read;
  if (answer.configured === false || answer.reachable === false) {
    return { state: "unavailable", paid: false, detail: serverDetail(answer, "portal KV unreachable") };
  }
  const paid = answer.paid === true;
  const paidAt = typeof answer.paidAt === "string" && answer.paidAt ? answer.paidAt : undefined;
  return {
    state: answer.registered === false ? "no-account" : "account",
    paid,
    ...(paidAt ? { paidAt } : {}),
    detail: serverDetail(answer, answer.registered === false ? "no account" : "account found"),
  };
}
