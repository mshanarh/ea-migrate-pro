/**
 * A REAL SEND, THROUGH THE REAL HANDLER, WITH THE REAL KEY.
 *
 * Every other probe replaces the mail module. That proves the code decides what
 * to send and to whom, but it cannot prove Mailjet ACCEPTS the message the
 * configured sender produces — which is the thing that was in doubt.
 *
 * So this one inserts a paid probe row, calls the actual `/api/activation`
 * handler with the real `MAILJET_API_KEY` / `MAILJET_SECRET_KEY`, and reports
 * the HTTP status and whether the reply was `ok: true`. Mailjet answers HTTP
 * 200 with `Messages: [{ Status: "success" }]` when it accepts a message onto
 * its queue, and the code step opens on that.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 * `Status: "success"` is acceptance onto Mailjet's queue, not arrival in an
 * inbox. Only the recipient can confirm that, and the app has no delivery
 * webhook. This script therefore reports "accepted by Mailjet" and never
 * "delivered".
 *
 * ⚠ IT SENDS REAL MAIL. The probe address is on the reserved
 * `.invalid` TLD (RFC 2606), which can never receive mail — so the message is
 * accepted by Mailjet and then bounces, without reaching a real person.
 *
 * READ/WRITE: one probe row on the reserved `@eamigratepro.invalid` domain,
 * deleted at the end.
 *
 * Run: bun scripts/check-live-send.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing sent.");
  process.exit(1);
}
if (!(process.env["MAILJET_API_KEY"] ?? "").trim() || !(process.env["MAILJET_SECRET_KEY"] ?? "").trim()) {
  console.log("MAILJET_API_KEY / MAILJET_SECRET_KEY is not set — nothing sent.");
  process.exit(1);
}

const sender = (process.env["MAILJET_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim();
console.log(`sender: ${sender}`);

const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
const { default: handler } = await import("../api/activation");

const PAID = "probe.livesend.paid@eamigratepro.invalid";

await admin.from("paid_emails").delete().eq("email", PAID);
await admin.from("users").delete().eq("email", PAID);
await admin.from("users").insert([{ email: PAID }]);
await admin.from("paid_emails").insert([{ email: PAID, paid_at: new Date().toISOString() }]);

let status = 200;
let payload: Record<string, unknown> | null = null;
const res = {
  status(code: number) {
    status = code;
    return res;
  },
  json(value: unknown) {
    payload = value as Record<string, unknown>;
  },
  setHeader() {},
};

await handler({ method: "POST", body: JSON.stringify({ action: "issueCode", email: PAID }) }, res);

console.log(`handler HTTP ${status}`);
console.log(`reply: ${JSON.stringify(payload)}`);

await admin.from("paid_emails").delete().eq("email", PAID);
await admin.from("users").delete().eq("email", PAID);
const left = await admin.from("users").select("email").eq("email", PAID);
console.log(`probe rows removed: ${(left.data ?? []).length === 0}`);

if (payload?.ok === true) {
  console.log("OK — Mailjet ACCEPTED the code from the configured sender; the code step opens.");
  process.exit(0);
}
console.log(
  "NOT SENT — Mailjet did not accept this message. See the reply above and the handler log.",
);
process.exit(1);