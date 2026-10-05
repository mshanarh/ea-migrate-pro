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
 * `ok`      it worked (possibly refusing a key or a code — read `error`)
 * `refused` the endpoint answered and said no. THIS STANDS.
 * `offline` there is no endpoint here: a network error, a 404/405 from a host
 *           serving only `dist/`, or a timeout.
 *
 * Only `refused` is final. `offline` is what lets the app keep working on a
 * deployment that has no server at all — and it is why the licence lock has a
 * second, offline implementation (`src/lib/license-lock.ts`). Treating
 * `offline` as `refused` would refuse EVERY activation and nobody could ever
 * start the bot; treating it as `ok` would hand out a key that is already in
 * use. Both are worse than saying which one it is.
 *
 * The code step deliberately has NO offline fallback: a six-digit code that can
 * be verified without a secret is not a code, it is a checkbox. When the
 * endpoint is missing the caller is told so plainly.
 */
import { supabaseConfigured } from "@/lib/supabase";

export type ActivationOutcome =
  | { status: "ok"; ok: boolean; alreadyInUse?: boolean; notPaid?: boolean; error?: string }
  | { status: "offline"; error: string };

/** Vercel functions are fast; a slow answer is a dead one, not a slow one. */
const DEADLINE_MS = 12_000;

async function post<T>(payload: Record<string, unknown>): Promise<ActivationOutcome> {
  if (typeof window === "undefined")
    return { status: "offline", error: "Activation is unavailable right now." };
  if (!supabaseConfigured)
    return { status: "offline", error: "Activation is unavailable right now." };
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    const response = await guarded;
    if (timer) clearTimeout(timer);
    // null = threw, timed out, or was aborted.
    if (!response || !response.ok)
      return { status: "offline", error: "Activation is unavailable right now." };
    return {
      status: "ok",
      ...((await response.json()) as {
        ok: boolean;
        alreadyInUse?: boolean;
        notPaid?: boolean;
        error?: string;
      }),
    };
  } catch {
    if (timer) clearTimeout(timer);
    return { status: "offline", error: "Activation is unavailable right now." };
  }
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
