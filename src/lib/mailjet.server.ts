/**
 * THE ONE EMAIL SENDER — Mailjet v3.1, server side only.
 *
 * This module replaces every Brevo call in the codebase (api/activation.ts,
 * api/portal.ts, src/lib/send-email.server.ts, src/lib/account-sync.server.ts).
 * There is exactly one place that knows how mail leaves this app, so a provider
 * change is a change to one file.
 *
 * WHY A SINGLETON AND NOT FOUR COPIES
 * ───────────────────────────────────
 * The Brevo code it replaces was copy-pasted into four modules with four
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
 * no webhook configured to read the outcome — so the honest return value is
 * what Mailjet actually answered, and nothing more. Callers must not describe a
 * returned `ok: true` to a user as "your email has arrived".
 *
 * The 2-minute activation-code window is calibrated against this: the code is
 * only useful while it is fresh, and the observed multi-hour delivery lag on a
 * `@gmail.com` From address (a domain whose SPF does not authorise any mail
 * provider) means the window can expire before the message even arrives. That
 * is a DNS-authentication problem, not a code problem — see the note on
 * MAILJET_SENDER_EMAIL below.
 */
import Mailjet from "node-mailjet";

/** Sent as the human-readable sender name on every message. */
const FROM_NAME = "EA Migrate Pro";

/**
 * The From address.
 *
 * ⚠ THIS MUST EVENTUALLY BE AN ADDRESS ON A DOMAIN YOU CONTROL AND HAVE
 * PUBLISHED SPF + DKIM FOR. A `@gmail.com` From sent through Mailjet fails
 * alignment exactly as it did through Brevo: gmail.com's SPF authorises Google
 * only, and Mailjet's DKIM signs with `d=mailjet.com`. Mail providers will
 * quarantine or silently drop those messages, which presents as "the app says
 * sent but nothing arrives" — the symptom this migration is partly chasing.
 * Swapping providers does not fix SPF/DMARC alignment; only authenticating
 * your own domain does.
 */
const SENDER = (process.env["MAILJET_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim();

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
   * Overrides the default "EA Migrate Pro" sender name. Only a handful of
   * platform notices have ever asked for their own; the default is what new
   * mail should use.
   */
  fromName?: string;
};

export type MailResult = { ok: true } | { ok: false; error: string };

let cached: InstanceType<typeof Mailjet> | null = null;

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
  if (!key || !secret) return null;
  if (!cached) {
    cached = Mailjet.apiConnect(key, secret, {
      config: { host: "api.mailjet.com", version: "v3.1" },
      options: { timeout: TIMEOUT_MS },
    });
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
 * The payload goes to `.request()`, NOT to `client.post(resource, config)` —
 * `post`'s second argument is request CONFIG, so passing the message there
 * silently transmits an empty `{}` body and every send "succeeds" while
 * delivering nothing.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const mailjet = client();
  if (!mailjet) {
    console.error("[mail] MAILJET_API_KEY / MAILJET_SECRET_KEY is not set — skipped:", message.to);
    return { ok: false, error: NOT_CONFIGURED };
  }
  if (!SENDER) {
    console.error("[mail] MAILJET_SENDER_EMAIL is empty — skipped:", message.to);
    return { ok: false, error: NOT_CONFIGURED };
  }

  try {
    const result = (await mailjet
      .post("send")
      .request({
        Messages: [
          {
            From: { Email: SENDER, Name: message.fromName ?? FROM_NAME },
            To: [{ Email: message.to, ...(message.toName ? { Name: message.toName } : {}) }],
            Subject: message.subject,
            HTMLPart: message.html,
            TextPart: message.text,
          },
        ],
      })) as { status?: number; body?: unknown; response?: { status?: number } };

    const body = result?.body;
    const first = (
      Array.isArray((body as { Messages?: unknown[] })?.Messages)
        ? ((body as { Messages: unknown[] }).Messages[0] as
            | { Status?: string; To?: Array<{ MessageID?: string }> }
            | undefined)
        : undefined
    );
    const status = typeof first?.Status === "string" ? first.Status : "(none returned)";
    /* Mailjet returns the id PER RECIPIENT, under To[0].MessageID — not at the
     * message level. Reading it from the wrong level silently yielded
     * "(none returned)" on every send, which is exactly the handle an operator
     * needs in Mailjet's own logs. */
    const messageId =
      typeof first?.To?.[0]?.MessageID === "string" ? first.To[0].MessageID : "(none returned)";
    const detail = JSON.stringify(body ?? null).slice(0, 400);
    /* On SUCCESS node-mailjet resolves to { response, body } — there is no
     * top-level `status`, and on FAILURE it rejects with an Error whose
     * `response.status` carries the HTTP code. Reading the wrong one is why an
     * earlier version logged "HTTP (no status)" for a send that had in fact
     * been accepted. Both shapes are handled below so the log always names a
     * real HTTP code. */
    const code = result?.response?.status ?? "(no status)";

    if (status === "success") {
      // `ACCEPTED`, never "sent" or "delivered" — see the header note.
      // The MessageID is the only handle on this message in Mailjet's logs,
      // which is what makes a later "did it go out?" question answerable. The
      // activation code itself is NOT logged — only the address and the id.
      console.log(
        `[mail] Mailjet ACCEPTED (not yet delivered) for ${message.to} from ${SENDER}: HTTP ${code} Status=${status} MessageID=${messageId}`,
      );
      return { ok: true };
    }

    console.error(`[mail] Mailjet refused the message for ${message.to}: HTTP ${code}`, detail);
    return { ok: false, error: `The email service refused the message (${status})${detail ? `: ${detail}` : "."}` };
  } catch (error) {
    console.error("[mail] Mailjet request error for", message.to, error);
    return { ok: false, error: "The email service could not be reached — try again." };
  }
}