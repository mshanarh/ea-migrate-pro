/**
 * Live test: "Password Changed Successfully - EA Migrate Pro" via Brevo REST.
 * Mirrors syncSendPasswordChangedEmail exactly. Run: bun scripts/test-password-email.mjs
 */
const apiKey = (process.env.BREVO_API_KEY ?? "").trim();
if (!apiKey) {
  console.log("RESULT: FAIL — BREVO_API_KEY missing");
  process.exit(1);
}
const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px 32px 0 32px;">
            <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
            <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">Password Changed Successfully</h1>
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;">
            <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">Your password has been successfully changed.</p>
            <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">You can now login with your new password.</p>
          </td></tr>
          <tr><td align="center" style="padding:28px 32px 32px 32px;">
            <p style="margin:0;font-size:12px;color:#6C6C78;">EA Migrate Pro Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: {
    accept: "application/json",
    "api-key": apiKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    sender: { name: "EA Migrate Pro Team", email: "eamigratepro@gmail.com" },
    to: [{ email: "eamigratepro@gmail.com", name: "eamigratepro@gmail.com" }],
    subject: "Password Changed Successfully - EA Migrate Pro",
    htmlContent: html,
    textContent: "Your password has been successfully changed\nYou can now login with your new password\n\nEA Migrate Pro Team",
  }),
  signal: AbortSignal.timeout(15_000),
});
console.log("HTTP", response.status);
const body = await response.text().catch(() => "");
try {
  console.log("messageId:", JSON.parse(body)?.messageId ?? body.slice(0, 200));
} catch {
  console.log(body.slice(0, 300));
}
if (response.ok) {
  console.log("RESULT: OK — email accepted by Brevo");
} else {
  console.log("RESULT: FAIL");
  process.exit(1);
}
