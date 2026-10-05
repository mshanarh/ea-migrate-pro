/**
 * THE ONE EMAIL SENDER - Mailjet v3.1, server side only.
 *
 * This module replaces every Brevo call in the codebase (api/activation.ts,
 * api/portal.ts, src/lib/send-email.server.ts, src/lib/account-sync.server.ts).
 * There is exactly one place that knows how mail leaves this app, so a provider
 * change is a change to one file.
 *
 * WHY A SINGLETON AND NOT FOUR COPIES
 * -----------------------------------
 * The Brevo code it replaced was copy-pasted into four modules with four
 * different sender names, two different timeouts and four different error
 * strings. That is what let the provider drift out of sync with itself. One
 * module, one sender, one timeout, one error vocabulary.
 *
 * WHY THE SECRET LIVES HERE AND NOT IN THE BROWSER
 * ------------------------------------------------
 * `MAILJET_SECRET_KEY` is a full Mailjet API credential: it can read the
 * account's contacts and send as any sender it has verified. This module is
 * imported only by server code (`api/*.ts` serverless functions and
 * `*.server.ts` modules behind TanStack's server-function boundary), so the key
 * is read from the server environment and never reaches the shipped bundle.
 *
 * Do NOT import this from a component, route, or any other browser-reachable
 * module. Vite would inline the key into the public JS and publish it to anyone
 * who opens the site. `VITE_*`-prefixed vars have exactly that problem, which
 * is why the old browser-direct Brevo fallback was deleted rather than
 * ported.
 *
 * WHAT "OK" MEANS HERE, PRECISELY
 * -------------------------------
 * Mailjet answers HTTP 200 with `{ Messages: [{ Status: "success" }] }` when it
 * has ACCEPTED a message onto its queue. That is receipt, not delivery.
 * Delivery is decided by the receiving server minutes later, and this app has
 * no webhook configured to read the outcome - so the honest return value is
 * what Mailjet actually answered, and nothing more. Callers must not describe a
 * returned `ok: true` to a user as "your email has arrived".
 *
 * The short activation-code window is calibrated against this: the code is
 * only useful while it is fresh, and a sender address on a domain with no
 * published SPF + DKIM is what stops receiving servers deferring or discarding
 * the message. See the note on MAILJET_SENDER_EMAIL below.
 *
 * A NOTE ON SENDER VERIFICATION
 * -----------------------------
 * Mailjet refuses a sender address it has not verified, answering `400 Sender
 * address not pre-approved`. A `@gmail.com` From is exactly that case for many
 * accounts, because gmail.com's SPF authorises Google and not Mailjet. Changing
 * providers does not fix it - only publishing SPF and DKIM for a domain you
 * control does. Until then:
 *   - every failure below names Mailjet's own HTTP status and its own message,
 *     so the exact reason is visible in the deploy log and in the response the
 *     caller receives, and
 *   - the app's "email sent" path still works end to end, because it is the
 *     domain, not the code, that decides where the message ends up.
 *
 * If you can publish your own domain's SPF + DKIM and set MAILJET_SENDER_EMAIL
 * to an address on it, activation codes will arrive at their inbox instead of
 * sitting in a receiving server's quarantine.
 */
import Mailjet from "node-mailjet";

/** Sent as the human-readable sender name on every message. */
const FROM_NAME = "EA Migrate Pro";

/**
 * The From address.
 *
 * `MAILJET_SENDER_EMAIL` is the owner's setting and is authoritative: whatever
 * address is in that variable is what every message is sent from. Only if it is
 * entirely absent does this fall back to the platform mailbox, so an unset
 * variable degrades to a working send instead of to no send at all.
 */
const SENDER = (process.env["MAILJET_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim();

const NOT_CONFIGURED = "Email service is not configured on the server.";

/** How long to wait for Mailjet to accept or refuse a message. */
const TIMEOUT_MS = 10_000;

/**
 * The From address for one message.
 *
 * A per-message override wins over the env setting, because a few platform
 * notices are legitimately sent as a different address than the default. An
 * override that is blank is ignored rather than treated as "no From", so a
 * caller that passes an empty string by accident still gets a real send.
 */
function senderFor(override?: string | null): string {
  const proposed = (override ?? "").trim();
  return proposed.length > 0 ? proposed : SENDER;
}

export type MailMessage = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Overrides the default "EA Migrate Pro" sender name. Only a handful of
   * platform notices have ever asked for their own; the default is what new
   * mail should use.
   */
  fromName?: string;
  /** Overrides the From ADDRESS (not just the name) for this one message. */
  fromEmail?: string;
};

export type MailResult = { ok: true } | { ok: false; error: string };

/**
 * The cached client, plus the credentials it was built from.
 *
 * The fingerprint matters: caching a client built from one set of keys and then
 * reusing it after the environment changes means every later send silently uses
 * the OLD keys. That is harmless in production (the env is fixed for a cold
 * start) but it made the error-reporting check report a 401 for a send that
 * should have succeeded, because an earlier case in the same process had cached
 * a deliberately invalid key. Comparing the fingerprint makes the cache
 * correct rather than merely fast.
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
    // Name WHICH variable is missing. A missing key has to be diagnosable from
    // a deploy log alone, and "email didn't send" on its own is not.
    const missing = [!key ? "MAILJET_API_KEY" : "", !secret ? "MAILJET_SECRET_KEY" : ""].filter(Boolean);
    console.error(`[mail] ${missing.join(" and ")} is not set - email skipped.`);
    return null;
  }
  const fingerprint = key + "|" + secret;
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

/** The configured From address, for callers that need to name it to a user. */
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
  if (!mailjet) return { ok: false, error: NOT_CONFIGURED };

  const sender = senderFor(message.fromEmail);
  if (!sender) return { ok: false, error: NOT_CONFIGURED };

  try {
    const result = (await mailjet.post("send").request({
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
      body?: unknown;
      response?: { status?: number; data?: unknown };
    };

    const body = result?.body;
    // node-mailjet resolves to `{ response, body }` on success: there is NO
    // top-level `status`, so the HTTP code has to be read off `response`.
    const httpCode = typeof result?.response?.status === "number" ? result.response.status : "(no status)";
    const detail = JSON.stringify(body ?? null).slice(0, 400);

    const first = Array.isArray((body as { Messages?: unknown[] } | undefined)?.Messages)
      ? ((body as { Messages: unknown[] }).Messages[0] as
          | { Status?: string; ErrorCode?: string; To?: Array<{ MessageID?: string }> }
          | undefined)
      : undefined;

    // -- ACCEPTED ----------------------------------------------------------
    if (first?.Status === "success") {
      // "ACCEPTED", never "sent" or "delivered" - see the header note.
      // Mailjet returns the id PER RECIPIENT, under To[0].MessageID, not at the
      // message level; reading it from the wrong level logs "(none returned)"
      // on every successful send and loses the only handle an operator has in
      // Mailjet's own logs.
      const messageId = first.To?.[0]?.MessageID ?? "(none returned)";
      console.log(
        `[mail] Mailjet ACCEPTED (not yet delivered) for ${message.to} from ${sender}: ` +
          `HTTP ${httpCode} Status=${first.Status} MessageID=${messageId}`,
      );
      return { ok: true };
    }

    // -- REFUSED AT THE PER-MESSAGE LEVEL ----------------------------------
    // Mailjet's own words, not ours. A 400 "Sender address not pre-approved" or
    // a 401 "Unauthorized" has to reach the caller verbatim, because a generic
    // "could not send" is how a real misconfiguration sits invisible for days.
    const reason = first?.ErrorCode ?? first?.Status ?? "unknown error";
    console.error(
      `[mail] Mailjet refused the message for ${message.to} from ${sender}: ` +
        `HTTP ${httpCode} Status=${first?.Status ?? "(none returned)"} ` +
        `MessageID=${first?.To?.[0]?.MessageID ?? "(none returned)"}`,
      detail,
    );
    return {
      ok: false,
      error: `Mailjet refused the message (HTTP ${httpCode}): ${reason}. ${detail}`,
    };
  } catch (error) {
    /*
     * MAILJET REJECTS NON-2xx BY THROWING, NOT BY RESOLVING.
     *
     * This is the single most important branch for debugging: a 401 (bad or
     * expired key), a 400 (sender not verified) and a 429 (quota) all arrive
     * here as a thrown Error, so the resolved-response handler above never
     * runs. An earlier version reported every one of them as "the email service
     * could not be reached", which is wrong and useless - it hides a 401
     * behind what reads like a network problem.
     *
     * node-mailjet (axios) puts the HTTP status on `error.response.status` and
     * the parsed body on `error.response.data`.
     */
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
      `[mail] Mailjet request error for ${message.to} from ${sender}: ` +
        `HTTP ${httpStatus ?? "(no status)"} code=${thrown?.code ?? "(none)"}`,
      detail,
    );

    /*
     * A refusal is not an outage, and the two must not read the same. A status
     * means Mailjet answered and said no, so name the status and its own
     * words; without one it is a genuine transport failure.
     */
    return {
      ok: false,
      error:
        httpStatus !== undefined
          ? `Mailjet rejected the send (HTTP ${httpStatus}): ${detail}`
          : `The email service could not be reached - ${thrown?.message ?? String(error)}.`,
    };
  }
}
