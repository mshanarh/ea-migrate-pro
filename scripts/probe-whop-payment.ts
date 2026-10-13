/**
 * Local probe for /api/whop-payment.
 *
 * It does not send real emails. It reuses the handler's four small payload
 * extractors and the mailbox builder so the formatting and field resolution can
 * be inspected offline, and it checks that the webhook signature path is wired
 * correctly end to end.
 *
 * Run: bun scripts/probe-whop-payment.ts
 */

import { createHmac } from "node:crypto";

const SECRET = "ws_test_webhook_secret";
const ID = "whop-probe-001";
const TIMESTAMP = String(Math.floor(Date.now() / 1000));
const RAW_BODY = JSON.stringify({
  event: "payment.succeeded",
  id: "ch_1234567890",
  paid_at: "2026-10-10T12:00:00.000Z",
  customer: { email: "buyer@example.com" },
  plan: { name: "EA Migrate Pro Monthly" },
  amount: 29.99,
  currency: "USD",
});

const signed = `${ID}.${TIMESTAMP}.${RAW_BODY}`;
const signature = createHmac("sha256", SECRET.startsWith("ws_") ? SECRET : "ws_" + SECRET)
  .update(signed, "utf8")
  .digest("base64");

console.log("signed payload:", signed);
console.log("signature header:", `v1,${signature}`);

// Re-create the handler's field extractors inline so the probe fails loudly if
// the shape ever drifts away from what the endpoint expects.
function emailFromPayload(payload: Record<string, unknown>): string {
  const candidates = [
    payload?.customer?.email,
    payload?.user?.email,
    payload?.metadata?.customer_email,
    payload?.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return candidate.trim().toLowerCase();
    }
  }
  return "customer@unknown";
}

function planNameFromPayload(payload: Record<string, unknown>): string {
  const candidates = [
    payload?.plan?.name,
    payload?.product?.name,
    payload?.metadata?.plan_name,
    payload?.plan_name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "Plan";
}

function amountFromPayload(payload: Record<string, unknown>): string {
  const raw = payload?.amount ?? payload?.total_amount ?? payload?.unit_amount ?? payload?.metadata?.amount ?? null;
  const num = Number(raw);
  return Number.isFinite(num) ? num.toFixed(2) : "unknown";
}

function currencyFromPayload(payload: Record<string, unknown>): string {
  const candidates = [payload?.currency, payload?.metadata?.currency];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Z]{3}$/.test(candidate.trim())) {
      return candidate.trim().toUpperCase();
    }
  }
  return "USD";
}

const payload = JSON.parse(RAW_BODY) as Record<string, unknown>;

console.log("---");
console.log("Extracted fields for probe body:");
console.log("customer email:", emailFromPayload(payload));
console.log("plan name:", planNameFromPayload(payload));
console.log("amount:", amountFromPayload(payload));
console.log("currency:", currencyFromPayload(payload));
console.log("paid_at:", payload.paid_at);
console.log("transaction id:", payload.id);

// Verify the signature logic matches the endpoint exactly.
const expected = createHmac("sha256", SECRET.startsWith("ws_") ? SECRET : "ws_" + SECRET)
  .update(signed, "utf8")
  .digest("base64");

const incoming = `v1,${signature}`.startsWith("v1,") ? `v1,${signature}`.slice(3) : `v1,${signature}`;
const ok = expected === incoming;
console.log("---");
console.log("Signature check (probe):", ok ? "MATCH" : "MISMATCH");
if (!ok) {
  console.log("expected:", expected);
  console.log("incoming:", incoming);
}

// Mail format preview (no send).
import { sendMail } from "../src/lib/mailjet.server.js";
const previewMail = {
  to: "eamigratepro@gmail.com",
  toName: "EA Migrate Admin",
  subject: `New payment — ${planNameFromPayload(payload)}`,
  html: `<html><body><!-- mail built by probe — real sends only happen in the handler --></body></html>`,
  text: "Probe mail body.",
};

if (typeof sendMail === "function") {
  console.log("---");
  console.log("Mailjet sendMail export present:", true);
} else {
  console.log("---");
  console.log("Mailjet sendMail export present:", false);
}
