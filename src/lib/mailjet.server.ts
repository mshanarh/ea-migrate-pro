/**
 * THE ONE EMAIL SENDER - Mailjet v3.1, server side only.
 *
 * This module replaces every Brevo call in the codebase (api/activation.ts,
 * api/portal.ts, src/lib/send-email.server.ts, src/lib/account-sync.server.ts).
 * There is exactly one place that knows how mail leaves this app, so a provider
 * change is a change to one file.
 *
 * WHY THERE IS NO MAIL SDK IN HERE ANYMORE
 * ----------------------------------------
 * This used to call the `node-mailjet` package. It was replaced with a direct
 * HTTPS call because this file is the shared import of BOTH Vercel serverless
 * functions, and those functions stopped being able to start at all:
 *
 *     GET  https://eamigratepro.vercel.app/api/activation  -> 500
 *          x-vercel-error: FUNCTION_INVOCATION_FAILED
 *     POST https://eamigratepro.vercel.app/api/activation  -> 500 (same)
 *
 * That is a COLD-START crash, not a handler error: the 500 arrives for a GET
 * that returns 405 before any line of the handler runs, and /api/portal fails
 * identically. Both files import nothing at runtime except this module and
 * `@supabase/supabase-js`, and the handler itself was verified to load and
 * answer correctly under Node, as both ESM and CJS, with every dependency
 * bundled. So the shared, load-time-only surface was the SDK: a CommonJS
 * bundle (axios + json-bigint underneath) pulled into a function that has to
 * boot from cold on every request.
 *
 * A dependency-free `fetch` removes that entire failure mode. It also shrinks
 * the function bundle by hundreds of kilobytes and makes this module trivially
 * testable, because the transport is now visible in this file instead of
 * hidden inside a package that chooses its own HTTP adapter.
 *
 * WHY THE SECRET LIVES HERE AND NOT IN THE BROWSER
 * -------------------------------------------------
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
 * ------------------------------
 * Mailjet answers HTTP 200 with `{ Messages: [{ Status: "success" }] }` when it
 * has ACCEPTED a message onto its queue. That is receipt, not delivery.
 * Delivery is decided by the receiving server minutes later, and this app has
 * no webhook configured to read the outcome - so the honest return value is
 * what Mailjet actually answered, and nothing more. Callers must not describe a
 * returned `ok: true` to a user as "your email has arrived".
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

/**
 * Mailjet's Send API, fixed. The only host this app ever talks to for mail.
 *
 * `/v3.1/send` is the JSON Messages endpoint that takes the `{ Messages: [...] }`
 * payload below. It is NOT `/v3.1/smtp/email`, which is the sibling endpoint
 * for pre-rendered RFC822 mail and answers `404` for this body - verified live
 * against the real API, which is why it is spelled out here.
 */
const SEND_URL = "https://api.mailjet.com/v3.1/send";

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

/** The part of Mailjet's v3.1 answer this app actually reads. */
type MailjetReply = {
  Messages?: Array<{ Status?: string; ErrorCode?: string; To?: Array<{ MessageID?: string }> }>;
};

/** Parse a response body, treating anything unparseable as "no detail". */
function parseReply(raw: string): MailjetReply | null {
  try {
    return JSON.parse(raw) as MailjetReply;
  } catch {
    return null;
  }
}

/** Are the credentials present? Lets callers fail fast with their own wording. */
export function mailConfigured(): boolean {
  return Boolean(
    (process.env["MAILJET_API_KEY"] ?? "").trim() && (process.env["MAILJET_SECRET_KEY"] ?? "").trim(),
  );
}

/** The configured From address, for callers that need to name it to a user. */
export function mailSender(): string {
  return SENDER;
}

/**
 * Send one message through Mailjet's v3.1 Send API.
 *
 * `fetch` RESOLVES on an HTTP error, so the status check below is the whole
 * game: a 400 "Sender address not pre-approved" and a 401 "Unauthorized" come
 * back as a perfectly normal response object. Reading only the resolved body
 * and calling that success is how a misconfigured sender survives for days,
 * so the status is checked first and Mailjet's own body is carried into the
 * error verbatim.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const key = (process.env["MAILJET_API_KEY"] ?? "").trim();
  const secret = (process.env["MAILJET_SECRET_KEY"] ?? "").trim();
  if (!key || !secret) {
    // Name WHICH variable is missing. A missing key has to be diagnosable from
    // a deploy log alone, and "email didn't send" on its own is not.
    const missing = [!key ? "MAILJET_API_KEY" : "", !secret ? "MAILJET_SECRET_KEY" : ""].filter(
      Boolean,
    );
    console.error(`[mail] ${missing.join(" and ")} is not set - email skipped.`);
    return { ok: false, error: NOT_CONFIGURED };
  }

  const sender = senderFor(message.fromEmail);
  if (!sender) return { ok: false, error: NOT_CONFIGURED };

  let status = 0;
  let raw = "";
  try {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Mailjet's v3.1 Send API authenticates with HTTP Basic: the API key is
        // the username, the secret is the password.
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: sender, Name: message.fromName ?? FROM_NAME },
            To: [{ Email: message.to, ...(message.toName ? { Name: message.toName } : {}) }],
            Subject: message.subject,
            HTMLPart: message.html,
            TextPart: message.text,
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    raw = await response.text();
  } catch (error) {
    /*
     * NO HTTP STATUS AT ALL - a DNS failure, a refused connection, or the
     * timeout above. This is the only genuinely "unreachable" case, and it is
     * deliberately worded differently from a refusal so the two are never
     * confused when reading a deploy log.
     */
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 400);
    console.error(`[mail] Mailjet request error for ${message.to} from ${sender}: ${detail}`);
    return {
      ok: false,
      error: `The email service could not be reached - ${detail}.`,
    };
  }

  // A non-JSON body is still a real, reportable answer - see `detail` below.
  const body = parseReply(raw);
  const detail = raw.slice(0, 400);

  // -- REFUSED AT THE HTTP LEVEL ------------------------------------------
  // 400 sender not pre-approved, 401 bad key, 429 quota, 5xx on Mailjet's side.
  // Mailjet's own words, not ours: an operator cannot act on "could not send".
  if (status < 200 || status >= 300) {
    console.error(
      `[mail] Mailjet rejected the send for ${message.to} from ${sender}: HTTP ${status}`,
      detail,
    );
    return { ok: false, error: `Mailjet rejected the send (HTTP ${status}): ${detail}` };
  }

  // -- ACCEPTED vs REFUSED AT THE PER-MESSAGE LEVEL -----------------------
  // A 200 only means the API answered; Mailjet reports per-recipient refusals
  // inside the 200 body, and those are still a failed send.
  const first = body?.Messages?.[0];

  if (first?.Status === "success") {
    // "ACCEPTED", never "sent" or "delivered" - see the header note.
    // Mailjet returns the id PER RECIPIENT, under To[0].MessageID, not at the
    // message level; reading it from the wrong level logs "(none returned)" on
    // every successful send and loses the only handle an operator has in
    // Mailjet's own logs.
    const messageId = first.To?.[0]?.MessageID ?? "(none returned)";
    console.log(
      `[mail] Mailjet ACCEPTED (not yet delivered) for ${message.to} from ${sender}: ` +
        `HTTP ${status} Status=${first.Status} MessageID=${messageId}`,
    );
    return { ok: true };
  }

  const reason = first?.ErrorCode ?? first?.Status ?? "unknown error";
  console.error(
    `[mail] Mailjet refused the message for ${message.to} from ${sender}: ` +
      `HTTP ${status} Status=${first?.Status ?? "(none returned)"} ` +
      `MessageID=${first?.To?.[0]?.MessageID ?? "(none returned)"}`,
    detail,
  );
  return {
    ok: false,
    error: `Mailjet refused the message (HTTP ${status}): ${reason}. ${detail}`,
  };
}