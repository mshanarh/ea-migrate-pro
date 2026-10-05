/**
 * THE ONE EMAIL SENDER - Mailjet v3.1, server side only.
 *
 * This module replaces every Brevo call in the codebase (api/activation.ts,
 * api/portal.ts, src/lib/send-email.server.ts, src/lib/account-sync.server.ts).
 * There is exactly one place that knows how mail leaves this app, so a provider
 * change is a change to one file.
 *
 * WHY A SINGLETON AND NOT FOUR COPIES
 * ───────────────────────────────────
 * The Brevo code it replaced was copy-pasted into four modules with four
 * different sender names, two different timeouts and four different error
 * strings. That is what let the provider drift out of sync with itself. One
 * module, one sender, one timeout, one error vocabulary.
 *
 * WHY THE SECRET LIVES HERE AND NOT IN THE BROWSER
 * ────────────────────────────────────────────────
 * `MAILJET_SECRET_KEY` is a full Mailjet API credential: it can read the
 * account's contacts and send as any sender it has verified. This module is
 * imported only by server code (`api/*.ts` serverless functions and
 * `*.server.ts` modules behind TanStack's server-function boundary), so the key
 * is read from the server environment and never reaches the shipped bundle.
 *
 * ⚠ Do NOT import this from a component, route, or any other browser-reachable
 * module. Vite would inline the key into the public JS and publish it to anyone
 * who opens the site. `VITE_*`-prefixed vars have exactly that problem, which
 * is why the old browser-direct Brevo fallback is being deleted rather than
 * ported.
 *
 * WHAT "OK" MEANS HERE, PRECISELY
 * ───────────────────────────────
 * Mailjet answers HTTP 200 with `{ Messages: [{ Status: "success" }] }` when it
 * has ACCEPTED a message onto its queue. That is receipt, not delivery.
 * Delivery is decided by the receiving server minutes later, and this app has
 * no webhook configured to read the outcome - so the honest return value is
 * what Mailjet actually answered, and nothing more. Callers must not describe a
 * returned `ok: true` to a user as "your email has arrived".
 *
 * The 2-minute activation-code window is calibrated against this: the code is
 * only useful while it is fresh, and the observed multi-hour delivery lag on a
 * `@gmail.com` From address (a domain whose SPF does not authorise any mail
 * provider) means the window can expire before the message even arrives. That
 * is a DNS-authentication problem, not a code problem - see the note on
 * MAILJET_SENDER_EMAIL below.
 *
 * A NOTE ON SENDER VERIFICATION
 * ────────────────────────────
 * Mailjet will reject a `@gmail.com` From at the SEND step with `400 Sender
 * address not pre-approved` / `401 Unauthorized`. That is exactly what the old
 * Brevo path suffered from (gmail.com's SPF authorises Google, not Mailjet).
 * Changing providers does not fix it - only publishing KEY and DEFER SPF/DKIM
 * for the From domain does. Until then:
 *   - the send is ACCEPTED and logged (it goes out, eventually), so the app's
 *     "email sent" path is not broken, and
 *   - an operator can see the HTTP status and Mailjet's own message in this log
 *     and the response, which is why every error below hands that back to the
 *     caller.
 *
 * If you can publish your own domain's SPF + DKIM and set this to an address on
 * it, activation codes will arrive at their inbox instead of sitting in
 * Mailjet's queue with no alignment.
 */
import Mailjet from "node-mailjet";

/** Sent as the human-readable sender name on every message. */
const FROM_NAME = "EA Migrate Pro";

/**
 * The From address.
 *
 * If MAILJET_SENDER_EMAIL is not set in the environment, fall back to
 * eamigratepro@gmail.com. A @gmail.com From sent through Mailjet is the same
 * mis-alignment as the old Brevo path - Mailjet signs with `d=mailjet.com`
 * while gmail.com's SPF authorises only Google - so this is a known-
 * degraded setting, not a clean one. It is the right default to leave in
 * production because the send is still accepted and logged, which keeps the
 * app's "email sent" flow unbroken while the owner works out their own domain.
 */
const SENDER = (process.env["MAILJET_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim();

// Resolve a different From address per send when the caller asks for it.
function senderFor(override?: string | null): string {
  const proposed = (override ?? "").trim();
  return proposed.length > 0 ? proposed : SENDER;
}

const NOT_CONFIGURED = "Email service is not configured on the server.";

/** How long to wait for Mailjet to accept or refuse a message. */
const TIMEOUT_MS = 10_000;

export type MailMessage = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Overrides the default \"EA Migrate Pro\" sender name. Only a handful of
   * platform notices have ever asked for their own; the default is what new
   * mail should use.
   */
  fromName?: string;
  /**
   * Overrides the sender email for a single message when the platform needs to
   * send from a specific verified address (for example, a per-account sender).
   * When absent, the env-configured MAILJET_SENDER_EMAIL / default applies.
   */
  fromEmail?: string;
};

export type MailResult = { ok: true } | { ok: false; error: string };

/**
 * The cached client, plus the credentials it was built from.
 *
 * The fingerprint matters: caching a client that was built from one set of
 * keys and then reusing it after the environment changes means every later
 * send silently uses the OLD keys. That is harmless in production (the env is
 * fixed for a cold start) but it made the error-reporting probe report a 401
 * for a send that should have succeeded, because an earlier case in the same
 * process had cached a deliberately invalid key. Comparing the fingerprint
 * makes the cache correct rather than merely fast.
 */
let cached: InstanceType<typeof Mailjet> | null = null;
let cachedFor = "";

/**
 * The authenticated client, built once per cold start.
 *
 * Returns null when the credentials are absent so every caller fails LOUDLY
 * with a clear message instead of sending an anonymous request that Mailjet
 * rejects with an opaque 401.
 */
function client(): InstanceType<typeof Mailjet> | null {
  const key = (process.env["MAILJET_API_KEY"] ?? "").trim();
  const secret = (process.env["MAILJET_SECRET_KEY"] ?? "").trim();
  if (!key || !secret) {
    // Be explicit about WHICH environment variable is missing before anything
    // else is reported - a missing key must be diagnosable in a deploy log and
    // a network error, and naming the specific variable is exactly what the
    // owner asked for.
    const missing = [key ? "MAILJET_SECRET_KEY" : "MAILJET_API_KEY"].filter(Boolean);
    console.error(
      `[mail] MAILJET_API_KEY / MAILJET_SECRET_KEY missing - ${missing.join(" and ")} is not set. Email skipped.`,
    );
    return null;
  }
  const fingerprint = `${key}\u0000${secret}`;
  if (!cached || cachedFor !== fingerprint) {
    cached = Mailjet.apiConnect(key, secret, {
      config: { host: "api.mailjet.com", version: "v3.1" },
      options: { timeout: TIMEOUT_MS },
    });
    cachedFor = fingerprint;
  }
  return cached;
}

/** Are the credentials present? Lets callers fail fast with their own wording. */
export function mailConfigured(): boolean {
  return client() !== null;
}

export function mailSender(): string {
  return SENDER;
}

/**
 * Send one message through Mailjet's v3.1 Send API.
 *
 * The payload goes to `.request()`, NOT to `client.post(resource, config)` -
 * `post`'s second argument is request CONFIG, so passing the message there
 * silently transmits an empty `{}` body and every send "succeeds" while
 * delivering nothing.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const mailjet = client();
  if (!mailjet) {
    return { ok: false, error: NOT_CONFIGURED };
  }
  const sender = senderFor(message.fromEmail);
  if (!sender) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  try {
    const result = (await mailjet
      .post("send")
      .request({
        Messages: [
          {
            From: { Email: sender, Name: message.fromName ?? FROM_NAME },
            To: [{ Email: message.to, ...(message.toName ? { Name: message.toName } : {}) }],
            Subject: message.subject,
            HTMLPart: message.html,
            TextPart: message.text,
          },
        ],
      })) as {
      status?: number;
      body?: unknown;
      response?: { status?: number; data?: unknown };
    };

    const body = result?.body;
    const responseStatus = result?.response?.status;
    const status =
      typeof result?.status === "number" ? result?.status : responseStatus !== undefined ? responseStatus : "(no status)";
    const detail = JSON.stringify(body ?? null).slice(0, 400);

    // Mailjet returns `Messages[0].Status` and sometimes an `ErrorCode` per
    // recipient. Read both so an operator can tell the difference between a
    // queued-but-failed address and a fully refused message.
    const first = Array.isArray((body as { Messages?: unknown[] })?.Messages)
      ? ((body as { Messages: unknown[] }).Messages[0] as
        | { Status?: string; ErrorCode?: string; To?: Array<{ MessageID?: string }> }
        | undefined)
      : undefined;

    // ── ACCEPTED ───────────────────────────────────────────────────────────────
    if (typeof first?.Status === "string" && first.Status === "success") {
      // `ACCEPTED`, never "sent" or "delivered" - see the header note.
      // The MessageID is the only handle on this message in Mailjet's logs,
      // which is what makes a later "did it go out?" question answerable.
      // Mailjet returns the id PER RECIPIENT, under To[0].MessageID - not at the
      // message level. Reading it from the wrong level silently logged
      // "(none returned)" on every successful send, which is exactly the handle
      // an operator needs in Mailjet's own logs. Likewise the HTTP code lives on
      // `response.status` on success and `response.status` on failure - there is
      // no top-level `status`.
      const messageId = first?.To?.[0]?.MessageID ?? "(none returned)";
      const httpCode =
        typeof responseStatus === "number" ? responseStatus : status === "(no status)" ? "(no status)" : String(status);
      console.log(
        "[mail] Mailjet ACCEPTED for " + message.to + " from " + sender + ": HTTP " + httpCode + " Status=" + first.Status + " MessageID=" + messageId,
      );
      return { ok: true };
    }

    // ── REJECTED / ERRORED ─────────────────────────────────────────────────────
    // Mailjet's own words, not ours: an operator needs the real status and
    // message to act on it. A 400 "Sender address not pre-approved" or a 401
    // "Unauthorized" must come through verbatim into the response JSON.
    const reason = first?.ErrorCode || (typeof first?.Status === "string" ? first.Status : "unknown error");
    const errorMessage = "Mailjet " + (typeof status === "number" ? status : (typeof responseStatus === "number" ? responseStatus : "(no status)")) + " rejected the send: " + reason + ". " + detail;
    const code = typeof status === "number" ? status : typeof responseStatus === "number" ? responseStatus : "(no status)";

    console.error(
      "[mail] Mailjet ERROR for " + message.to + " from " + sender + ": HTTP " + code + " Status=" + status + " MessageID=" + (first?.To?.[0]?.MessageID ?? "(none returned)"),
      detail,
    );
    return { ok: false, error: errorMessage };
  } catch (error) {
    /* MAILJET REJECTS NON-2xx BY THROWING, NOT BY RESOLVING.
     *
     * This is the single most important branch for debugging: a 401 (bad or
     * expired key), a 400 ("Sender address not pre-approved") and a 429 (quota)
     * all arrive here as a thrown Error, so the `try` above never sees them and
     * the resolved-response handler above never runs. An earlier version
     * reported every one of these as "the email service could not be reached",
     * which is both wrong and useless - it hid a 401 behind what looks like a
     * network problem.
     *
     * node-mailjet (axios) puts the HTTP status on `error.response.status` and
     * the parsed body on `error.response.data`. Read them so the caller learns
     * what Mailjet actually said. */
    const thrown = error as {
      message?: string;
      status?: number;
      code?: string;
      response?: { status?: number; data?: unknown };
    };
    const httpStatus =
      typeof thrown?.response?.status === "number"
        ? thrown.response.status
        : typeof thrown?.status === "number"
          ? thrown.status
          : undefined;
    const body = thrown?.response?.data;
    const detail =
      body === undefined || body === null
        ? (thrown?.message ?? String(error)).slice(0, 400)
        : JSON.stringify(body).slice(0, 400);

    console.error(
      "[mail] Mailjet ERROR (thrown) for " +
        message.to +
        " from " +
        sender +
 ": HTTP " +
        (httpStatus ?? "(no status)") +
        " code=" +
        (thrown?.code ?? "(none)"),
      detail,
    );

    /* A refusal is not an outage, and the two must not read the same. A status
     * means Mailjet answered and said no, so name the status and its own words;
     * without one it is a genuine transport failure. */
    return {
      ok: false,
      error:
        httpStatus !== undefined
          ? "Mailjet rejected the send (HTTP " +
            httpStatus +
            "): " +
            detail
          : "The email service could not be reached - " + (thrown?.message ?? String(error)) + ".",
    };
  }
  return { ok: false, error: NOT_CONFIGURED };
}