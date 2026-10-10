/**
 * POST /api/whop-payment — Whop Standard Webhook for successful payments.
 *
 * This endpoint owns ONE job: when Whop confirms a successful payment, send
 * the EA Migrate platform email to eamigratepro@gmail.com.
 *
 * Security rules encoded here:
 *  - Signature verified BEFORE anything else, using Whop's Standard Webhooks
 *    format (webhook-id + "." + webhook-timestamp + "." + raw body).
 *  - Only `payment.succeeded` is treated as a successful payment.
 *  - Replay protection: webhook-timestamp must be within 5 minutes.
 *  - Idempotent: each webhook-id is recorded and duplicates are ignored.
 *  - Server-side only: secret and email credentials live in env, never shipped.
 *
 * Why this is a separate endpoint and not folded into something else:
 *   - It is a new inbound contract (Whop webhook). It has its own failure mode
 *     (bad signature, replay, unsupported event) and its own audit trail
 *     (recorded webhook-id + Mailjet send result). Mixing it into a generic
 *     email or admin route would bury those semantics.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

const WEBHOOK_SECRET_ENV = "WHOP_WEBHOOK_SECRET";
const WEBHOOK_SECRET_HEADER_PREFIX = "ws_";
const timestampToleranceMs = 5 * 60 * 1000;

// Whop's Standard Webhook headers, contractually frozen names.
type RawHeaders = Record<string, string | string[] | undefined>;
function headerValue(h: RawHeaders, name: string): string | undefined {
  const raw = h[name];
  if (Array.isArray(raw)) return raw[0];
  if (typeof raw === "string") return raw;
  return undefined;
}

function parseBody(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "{}";
  try {
    return JSON.stringify(raw);
  } catch {
    return "{}";
  }
}

function parseRawBodyText(request: ApiRequest): string {
  return parseBody(request.body);
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const secret = (process.env[WEBHOOK_SECRET_ENV] ?? "").trim();
  if (!secret) {
    console.error(`[whop-payment] ${WEBHOOK_SECRET_ENV} is not set on the server`);
    response.status(503).json({ ok: false, error: "Payment notifications are not configured" });
    return;
  }

  const rawBody = parseRawBodyText(request);
  const headers: RawHeaders = (request.headers ?? {}) as RawHeaders;

  const webhookId = headerValue(headers, "webhook-id");
  const webhookTimestamp = headerValue(headers, "webhook-timestamp");
  const webhookSignature = headerValue(headers, "webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.warn("[whop-payment] missing webhook headers");
    response.status(400).json({ ok: false, error: "Bad request" });
    return;
  }

  // Replay protection.
  const timestamp = Number(webhookTimestamp);
  if (!Number.isFinite(timestamp)) {
    response.status(400).json({ ok: false, error: "Bad request" });
    return;
  }
  const now = Date.now();
  const age = now - timestamp;
  if (age < -timestampToleranceMs || age > timestampToleranceMs) {
    console.warn("[whop-payment] rejected stale webhook", webhookId, age);
    response.status(400).json({ ok: false, error: "Bad request" });
    return;
  }

  // Signature verification (constant-time comparison).
  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret.startsWith(WEBHOOK_SECRET_HEADER_PREFIX) ? secret : `${WEBHOOK_SECRET_HEADER_PREFIX}${secret}`)
    .update(signedPayload, "utf8")
    .digest("base64");

  const incoming = webhookSignature.startsWith("v1,") ? webhookSignature.slice(3) : webhookSignature;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(incoming))) {
    console.warn("[whop-payment] signature mismatch", webhookId);
    response.status(401).json({ ok: false, error: "Signature invalid" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.warn("[whop-payment] unparseable body");
    response.status(400).json({ ok: false, error: "Bad request" });
    return;
  }

  const eventType = typeof payload?.["event"] === "string" ? payload["event"] : "";
  if (eventType !== "payment.succeeded") {
    console.log(`[whop-payment] ignoring event ${eventType}`, webhookId);
    response.status(200).json({ ok: true, handled: false, reason: `ignored event ${eventType}` });
    return;
  }

  if (seenBefore(webhookId)) {
    console.log("[whop-payment] duplicate webhook-id ignored", webhookId);
    response.status(200).json({ ok: true, handled: false, reason: "duplicate webhook" });
    return;
  }

  const customerEmail = emailFromPayload(payload);
  const planName = planNameFromPayload(payload);
  const amount = amountFromPayload(payload);
  const currency = currencyFromPayload(payload);

  markSeen(webhookId);
  const paidAt = typeof payload?.["paid_at"] === "string" ? payload["paid_at"] : "";
  const transactionId = typeof payload?.["id"] === "string" ? payload["id"] : webhookId;

  const mailResult = await sendPaymentNotification({
    to: RECIPIENT,
    customerEmail,
    amount,
    currency,
    planName,
    paymentReference: transactionId,
    paidAt,
  });

  if (!mailResult.ok) {
    console.error("[whop-payment] email send failed", mailResult.error);
    // The webhook was valid and the event was successful; the payment record
    // still happened on Whop's side. We return 200 so Whop does not retry the
    // same signed webhook forever, but we log the email failure explicitly.
    response.status(200).json({ ok: true, handled: true, emailSent: false, error: mailResult.error });
    return;
  }

  console.log("[whop-payment] notification sent", webhookId, customerEmail, transactionId);
  response.status(200).json({ ok: true, handled: true, emailSent: true });
}

const RECIPIENT = "eamigratepro@gmail.com";

// ---- Whop payload field extraction -----------------------------------------
// Whop's payment event payload shape is documented by Whop and can include
// customer email, amount, currency, and plan metadata. Field locations can
// change across Whop versions, so every accessor is defensive and falls back
// to unknown-only values rather than failing the webhook.
function emailFromPayload(payload: Record<string, unknown>): string {
  const customer = payload["customer"] as Record<string, unknown> | undefined;
  const user = payload["user"] as Record<string, unknown> | undefined;
  const metadata = payload["metadata"] as Record<string, unknown> | undefined;
  const candidates: Array<string | undefined> = [
    customer?.["email"] as string | undefined,
    user?.["email"] as string | undefined,
    metadata?.["customer_email"] as string | undefined,
    payload["email"] as string | undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return candidate.trim().toLowerCase();
    }
  }
  return "customer@unknown";
}

function planNameFromPayload(payload: Record<string, unknown>): string {
  const plan = payload["plan"] as Record<string, unknown> | undefined;
  const product = payload["product"] as Record<string, unknown> | undefined;
  const metadata = payload["metadata"] as Record<string, unknown> | undefined;
  const candidates: Array<string | undefined> = [
    plan?.["name"] as string | undefined,
    product?.["name"] as string | undefined,
    metadata?.["plan_name"] as string | undefined,
    payload["plan_name"] as string | undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "Plan";
}

function amountFromPayload(payload: Record<string, unknown>): string {
  const metadata = payload["metadata"] as Record<string, unknown> | undefined;
  const raw: unknown =
    payload["amount"] ??
    payload["total_amount"] ??
    payload["unit_amount"] ??
    metadata?.["amount"] ??
    null;
  const num = Number(raw);
  if (Number.isFinite(num)) {
    return num.toFixed(2);
  }
  return "unknown";
}

function currencyFromPayload(payload: Record<string, unknown>): string {
  const metadata = payload["metadata"] as Record<string, unknown> | undefined;
  const candidates: Array<string | undefined> = [
    payload["currency"] as string | undefined,
    metadata?.["currency"] as string | undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Z]{3}$/.test(candidate.trim())) {
      return candidate.trim().toUpperCase();
    }
  }
  return "USD";
}


// ---- Deduplication -----------------------------------------------------------
// In-memory dedup only survives one serverless instance. For real durability
// this should be backed by the same KV/Upstash store this app already uses for
// registrations and notifications; until that env is wired, webhook-id replay
// detection still protects repeated deliveries in the same process.
const SEEN: Set<string> = new Set();

function seenBefore(id: string): boolean {
  if (!id) return false;
  return SEEN.has(id);
}

function markSeen(id: string): void {
  if (!id) return;
  SEEN.add(id);
}

// ---- Email dispatch ---------------------------------------------------------
// Uses the existing server-side Mailjet path exactly like the rest of the
// platform mail. It keeps the recipient, subject, and body in the same brand
// shell as the other transactional emails, but it is a NEW notification so it
// does not reuse or touch the existing registration/approval/license flows.
import { sendMail, type MailMessage } from "../src/lib/mailjet.server.js";

type PaymentNotificationInput = {
  to: string;
  customerEmail: string;
  amount: string;
  currency: string;
  planName: string;
  paymentReference: string;
  paidAt: string;
};

function formatPaidAt(value: string): string {
  if (!value) return "Unknown";
  try {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return value;
    return parsed.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return value;
  }
}

function paymentNotificationMail(input: PaymentNotificationInput): MailMessage {
  const paidAt = formatPaidAt(input.paidAt);

  const lines = [
    `A customer just paid successfully on the EA Migrate Pro platform.`,
    ``,
    `User Email: <strong>${escapeHtml(input.customerEmail)}</strong>`,
    `Amount Paid: <strong>${escapeHtml(input.amount)} ${escapeHtml(input.currency)}</strong>`,
    `Plan Purchased: <strong>${escapeHtml(input.planName)}</strong>`,
    `Payment Status: <strong>Successful</strong>`,
    `Whop Payment Reference: <strong>${escapeHtml(input.paymentReference)}</strong>`,
    `Payment Date: <strong>${escapeHtml(paidAt)}</strong>`,
  ];

  return {
    to: input.to,
    toName: "EA Migrate Admin",
    subject: `New payment — ${input.planName}`,
    html: mailHtml(lines),
    text: textFromLines(lines),
  };
}

function mailHtml(lines: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  </head>
  <body style="margin:0;padding:0;background:#0A0A0C;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
                <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">New payment received</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                ${lines
                  .map((line) => {
                    if (line === "")
                      return `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">&nbsp;</p>`;
                    return `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${line}</p>`;
                  })
                  .join("\n                ")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 32px 32px 32px;">
                <a href="https://eamigratepro.vercel.app/" style="display:inline-block;background:#E7B53A;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">Open EA Migrate Pro</a>
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">
                  If the button does not work, copy this link into your browser:<br />
                  <span style="color:#9A9AA6;">https://eamigratepro.vercel.app/</span><br /><br />
                  EA Migrate Team
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textFromLines(lines: string[]): string {
  return lines.map((line) => (line.startsWith("<strong>") ? line.slice(8, -9) : line)).join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendPaymentNotification(input: PaymentNotificationInput): Promise<{ ok: boolean; error?: string }> {
  const mail = paymentNotificationMail(input);

  if (!sendMail) {
    return { ok: false, error: "Email service is not available on the server." };
  }

  const result = await sendMail(mail);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
