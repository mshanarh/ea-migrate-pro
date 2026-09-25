/**
 * Brevo email sender check — run: bun scripts/check-brevo.mjs [to-email]
 *
 * Sends one real test email through the SAME Brevo v3 endpoint and payload
 * shape the app's server functions use (api.brevo.com/v3/smtp/email), then
 * prints the full response so delivery failures are visible. The API key is
 * read from the environment (BREVO_API_KEY) and is never printed.
 */
const to = (process.argv[2] ?? "biyasentobeko222@gmail.com").trim();
const apiKey = (process.env.BREVO_API_KEY ?? "").trim();

console.log("1) BREVO_API_KEY present:", apiKey.length > 0);
if (!apiKey) {
  console.log("RESULT: FAIL — add BREVO_API_KEY in Settings → Environment.");
  process.exit(1);
}
console.log("   Key shape: length", apiKey.length, "| starts:", apiKey.slice(0, 3) === "xke" ? "xke… (correct Brevo format)" : "(unrecognised prefix)");

const senderEmail = (process.env.BREVO_SENDER_EMAIL ?? "eamigratepro@gmail.com").trim();
console.log("2) Sender:", senderEmail, "| To:", to);

const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: {
    accept: "application/json",
    "api-key": apiKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    sender: { name: "EA Migrate Pro", email: senderEmail },
    to: [{ email: to, name: "Platform Owner" }],
    subject: "✅ Brevo email test — EA Migrate Pro",
    htmlContent: `<!DOCTYPE html><html><body style="margin:0;background:#0A0A0C;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:40px 16px;">
        <tr><td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#121216;border:1px solid #26262E;border-radius:16px;">
            <tr><td style="padding:32px;">
              <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;">EA MIGRATE PRO</p>
              <h1 style="margin:12px 0 0 0;font-size:24px;color:#FFFFFF;">Brevo is working ✅</h1>
              <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:#C9C9D1;">This is a live delivery test of the platform's email pipeline. If you are reading this in your inbox, registration and approval emails will arrive correctly.</p>
              <p style="margin:20px 0 0 0;font-size:12px;color:#6C6C78;">Sent at ${new Date().toISOString()} via api.brevo.com/v3/smtp/email</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`,
    textContent: "Brevo is working. This is a live delivery test of the EA Migrate Pro email pipeline.",
  }),
  signal: AbortSignal.timeout(15_000),
});

console.log("3) POST /v3/smtp/email → HTTP", response.status);
const body = await response.text().catch(() => "");
let detail = body;
try {
  detail = JSON.stringify(JSON.parse(body));
} catch {
  /* keep raw */
}
console.log("   Full Brevo response:", detail.slice(0, 600) || "(empty body)");

if (response.ok) {
  console.log("RESULT: OK — email accepted by Brevo. Check the inbox (and spam) for:", to);
} else if (response.status === 401 || response.status === 403) {
  console.log("RESULT: FAIL — Brevo rejected the API key. Generate a fresh SMTP/API key at app.brevo.com and update BREVO_API_KEY.");
} else {
  console.log("RESULT: FAIL — see the Brevo error above (sender not verified is the most common cause).");
}
process.exit(response.ok ? 0 : 1);
