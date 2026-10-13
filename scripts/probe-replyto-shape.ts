/**
 * WHICH ReplyTo SHAPE DOES MAILJET v3.1 ACCEPT?
 *
 * The deliverability fix added a Reply-To header equal to the From identity.
 * Mailjet answered the obvious shapes with:
 *
 *     HTTP 400  "Type mismatch. Expected type \"emailIn\"."
 *     ErrorRelatedTo: ["Messages.ReplyTo"]
 *
 * — once for an ARRAY of {Email,Name} (copied from the To shape) and once for
 * a bare string. Both are guesses; this probe replaces guessing with the real
 * schema: it sends four variant payloads to real Mailjet (to a .invalid probe
 * address that cannot reach a mailbox) and prints only HTTP status + the first
 * 180 chars of each answer. No key material is printed.
 *
 * Run: bun scripts/probe-replyto-shape.ts
 */

const key = (process.env["MAILJET_API_KEY"] ?? "").trim();
const secret = (process.env["MAILJET_SECRET_KEY"] ?? "").trim();
if (!key || !secret) {
  console.log("MISSING KEYS — MAILJET_API_KEY / MAILJET_SECRET_KEY not set");
  process.exit(1);
}

const PROBE_TO = "probe.reply@eamigratepro.invalid";

const variants: Array<[string, unknown]> = [
  ["object {Email}", { Email: PROBE_TO }],
  ["object {Email,Name}", { Email: PROBE_TO, Name: "EA Migrate Pro" }],
  ["plain string", PROBE_TO],
  ["array of strings", [PROBE_TO]],
];

for (const [label, replyTo] of variants) {
  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: "eamigratepro@gmail.com", Name: "EA Migrate Pro" },
          To: [{ Email: PROBE_TO }],
          ReplyTo: replyTo,
          Subject: "replyto shape probe",
          HTMLPart: "<p>probe</p>",
          TextPart: "probe",
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  console.log(label, "->", response.status, body.slice(0, 180));
}
