/**
 * THE BROWSER'S DOOR TO /api/activation.
 *
 * This app ships as a static build, so the only server code that runs in
 * production is a Vercel serverless function in `/api` (see
 * `api/activation.ts`). This module is the only thing in the client that talks
 * to it, and it exists so the rest of the app never has to know how deployment
 * works.
 *
 * THE CONTRACT HAS THREE ANSWERS, NOT TWO
 * ───────────────────────────────────────
 * `ok`      the endpoint answered and here is its verdict: it may have worked,
 *           it may have refused a key or a code. Read `error`.
 * `offline` there is no endpoint here at all: no network, a timeout, or a host
 *           that answered with the static SPA instead of a function.
 *           THIS STANDS.
 *
 * Only `offline` is final. It is what lets the app keep working on a deployment
 * that has no server at all, and it is why the licence lock has a second,
 * offline implementation (`src/lib/license-lock.ts`). Treating `offline` as
 * `ok` would hand out a key that is already in use; treating `ok` as `offline`
 * would refuse every activation and nobody could ever start the bot.
 *
 * WHY A FAILED ENDPOINT IS `ok`, NOT `offline` — and why that used to matter
 * ─────────────────────────────────────────────────────────────────────────
 * Every non-2xx used to be reported as `offline`, and the error body was thrown
 * away unread. On the live deployment that produced the worst possible outcome:
 * both serverless functions were failing to boot at all, answering
 *
 *     GET/POST /api/activation  ->  500  x-vercel-error: FUNCTION_INVOCATION_FAILED
 *
 * and the app reported that to the customer as the two-line dead end "We could
 * not send your code right now… message support and we will help you in." The
 * HTTP status — the single most useful thing in the response — never reached
 * the screen and never reached a log. An outage that had taken the whole
 * activation flow down was indistinguishable, in the UI, from a typo'd address.
 *
 * So the split is now on what actually happened:
 *   - no function on this host (404/405, or the SPA's HTML served instead of
 *     JSON) is genuinely `offline`, and stays fail-closed;
 *   - any other failure means the function IS deployed and it FAILED, so its
 *     status and its own message are carried through instead of being hidden.
 *
 * The code step deliberately has NO offline fallback: a six-digit code that can
 * be verified without a secret is not a code, it is a checkbox. When the
 * endpoint is genuinely missing the caller is told so plainly.
 */
import { supabaseConfigured } from "@/lib/supabase";

export type ActivationOutcome =
  | { status: "ok"; ok: boolean; alreadyInUse?: boolean; notPaid?: boolean; error?: string }
  | { status: "offline"; error: string };

/** Vercel functions are fast; a slow answer is a dead one, not a slow one. */
const DEADLINE_MS = 12_000;

/** What the endpoint is contracted to answer with. */
type ReplyBody = {
  ok?: boolean;
  alreadyInUse?: boolean;
  notPaid?: boolean;
  error?: string;
};

/**
 * "Is this really an answer from our function, or is the static SPA standing
 * in for it?"
 *
 * A deployment with no `/api` at all rewrites every path to `index.html`, so an
 * uncatchable activation bug looks exactly like a working one unless the shape
 * of the body is checked. A function always answers JSON carrying a boolean
 * `ok`; the SPA answers HTML.
 */
function isFunctionReply(value: unknown): value is Required<Pick<ReplyBody, "ok">> & ReplyBody {
  return typeof value === "object" && value !== null && typeof (value as ReplyBody).ok === "boolean";
}

async function post(payload: Record<string, unknown>): Promise<ActivationOutcome> {
  const missing: ActivationOutcome = {
    status: "offline",
    error: "Activation is unavailable right now.",
  };
  if (typeof window === "undefined") return missing;
  if (!supabaseConfigured) return missing;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | null = null;
  try {
    const request = fetch("/api/activation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEADLINE_MS),
    }).catch(() => null);
    // A hard deadline as well as AbortSignal: a proxy that never answers would
    // otherwise leave the customer on a spinner forever.
    const guarded = Promise.race([
      request,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DEADLINE_MS);
      }),
    ]);
    response = await guarded;
  } catch {
    response = null;
  }
  if (timer) clearTimeout(timer);
  // null = threw, timed out, or was aborted.
  if (!response) return missing;

  // 404/405 is what a host serving only `dist/` answers. There is no function
  // to talk to, which is exactly what `offline` means.
  if (response.status === 404 || response.status === 405) return missing;

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* the static SPA, or a crash page: no JSON to read */
  }
  // HTML where JSON was contracted: the rewrite caught this path, so the
  // function is not deployed here either.
  if (!isFunctionReply(parsed)) return missing;

  if (response.ok) return { status: "ok", ...parsed };

  /*
   * THE ENDPOINT IS THERE AND IT FAILED.
   *
   * Its HTTP status and its own words are passed up rather than replaced by a
   * generic sentence, because a 500 from a function that cannot boot and a 400
   * from Mailjet refusing an unverified sender need completely different fixes
   * and used to look identical on screen.
   */
  const reason = parsed.error?.trim();
  console.error(
    `[activation] ${payload["action"] ?? "request"} failed: HTTP ${response.status}`,
    reason ?? "(no reason in the response body)",
  );
  return {
    status: "ok",
    ok: false,
    error: reason || `The server could not complete this request (HTTP ${response.status}).`,
  };
}

/**
 * Send the six-digit code to a PAID email.
 *
 * NO OFFLINE PATH ON PURPOSE. The code's only job is to prove the person at the
 * keyboard controls the inbox they paid with, and that proof needs a secret
 * that does not exist in a browser. If the endpoint is missing, this says so
 * instead of pretending — and the caller shows the waiting room, which is the
 * honest screen for an account whose activation cannot be verified.
 */
export async function requestActivationCode(email: string): Promise<ActivationOutcome> {
  return post({ action: "issueCode", email });
}

/** Check a code the customer typed. See `requestActivationCode` for why there is no offline path. */
export async function checkActivationCode(email: string, code: string): Promise<ActivationOutcome> {
  return post({ action: "verifyCode", email, code });
}

/**
 * Claim a licence key, or be told it is already in use.
 *
 * Unlike the code, this one DOES have an offline fallback: a key that cannot be
 * claimed at all is a key nobody can use, which breaks the product outright.
 * The caller pairs this with `claimKeyWithoutServer` so a deployment with no
 * server still enforces single use, using the weaker insert-once lock.
 */
export async function claimLicenseKeyFor(email: string, key: string): Promise<ActivationOutcome> {
  return post({ action: "claimKey", email, key });
}