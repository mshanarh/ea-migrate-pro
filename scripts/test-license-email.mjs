/**
 * Live license-email test — mirrors the exact payload shape the app sends
 * (POST /v3/smtp/email, sender eamigratepro@gmail.com, Algohost-style card).
 * Sends one real email to the account owner's address. Never prints the key.
 */
const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY not set");
  process.exit(1);
}
const OWNER = "biyasentobeko222@gmail.com";
const KEY = "TEST-K3Y2-CHK9-LIVE";
const EA = "Sniper killer Ea v2.0";
const pill = (label) =>
  `<span style="display:inline-block;margin:4px;padding:9px 18px;border:1px solid #2E5FA3;border-radius:999px;background:#0E1522;color:#D7E4F5;font-size:13px;">${label}</span>`;
const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:24px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:36px 32px 0 32px;">
              <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
              <h1 style="margin:14px 0 0 0;font-size:30px;line-height:1.2;color:#FFFFFF;">Generate License</h1>
              <p style="margin:8px 0 0 0;font-size:12px;font-weight:bold;letter-spacing:0.3em;color:#8A8A96;text-transform:uppercase;">Key Created</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 32px 0 32px;">
              <div style="border:2px solid #2E7CD6;border-radius:999px;padding:16px 26px;background:#0E1522;">
                <span style="font-family:'Courier New',Courier,monospace;font-size:21px;font-weight:bold;color:#FFFFFF;letter-spacing:0.14em;">${KEY}</span>
                <br />
                <span style="font-size:11px;color:#8A8A96;">Tap and hold the key, then choose Copy</span>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 24px 0 24px;">
              ${pill(OWNER)}
              ${pill("Lifetime")}
              ${pill(EA)}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 0 32px;">
              <p style="margin:0;font-size:14px;font-weight:bold;color:#4DA3FF;">&#9986; Emailed to client</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 32px 32px 32px;">
              <a href="https://eamigratepro.vercel.app/" style="display:inline-block;background:#E7B53A;color:#0A0A0C;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">Open EA Migrate Pro Portal</a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
  body: JSON.stringify({
    sender: { name: "EA Migrate Pro", email: "eamigratepro@gmail.com" },
    to: [{ email: OWNER, name: "Trader" }],
    subject: `Your EA Migrate Pro License Key - ${EA}`,
    htmlContent: html,
    textContent: `Your EA Migrate Pro license key: ${KEY}\n\nEA: ${EA}\nExpiry: Lifetime\nLinked to: ${OWNER}\n\nActivate it in the EA Migrate Pro Portal: https://eamigratepro.vercel.app/`,
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
  console.log("RESULT: OK — license email pipeline works. Check", OWNER);
} else {
  console.log("RESULT: FAIL —", body.slice(0, 300));
  process.exit(1);
}
