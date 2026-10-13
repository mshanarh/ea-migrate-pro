/**
 * Live send test — exercises the exact same endpoint/headers/payload shape the
 * app uses (POST /v3/smtp/email, sender eamigratepro@gmail.com) by sending one
 * real email to the account owner's address. Never prints the API key.
 */
const key = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!key) {
  console.log("BREVO_API_KEY not set");
  process.exit(1);
}
const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 0 32px;">
              <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
              <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">Brevo integration test ✅</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">This is a live test of the portal's email pipeline (approval + pending emails). If you're reading this in your inbox, the chain works: key → sender → delivery. 🎉</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 32px 32px 32px;">
              <a href="https://eamigratepro.vercel.app/" style="display:inline-block;background:#E03131;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">Open EA Migrate Pro Portal</a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: { accept: "application/json", "api-key": key, "content-type": "application/json" },
  body: JSON.stringify({
    sender: { name: "Ea migrate pro", email: "eamigratepro@gmail.com" },
    to: [{ email: "biyasentobeko222@gmail.com", name: "Platform Owner" }],
    subject: "EA Migrate Pro — Brevo pipeline test ✅",
    htmlContent: html,
    textContent:
      "This is a live test of the portal's email pipeline (approval + pending emails). If you can read this, key + sender + delivery all work.",
  }),
});
const body = await response.text();
let messageId = "(unknown)";
try {
  messageId = JSON.parse(body).messageId ?? "(unknown)";
} catch {
  /* keep */
}
console.log("POST /v3/smtp/email ->", response.status);
console.log("messageId:", String(messageId).slice(0, 60));
if (response.ok) {
  console.log("RESULT: OK — email pipeline works end to end. Check biyasentobeko222@gmail.com (and spam).");
} else {
  console.log("RESULT: FAIL —", body.slice(0, 300));
  process.exit(1);
}
