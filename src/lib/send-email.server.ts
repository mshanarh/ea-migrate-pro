import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * /api/send-email equivalent — one backend endpoint for the platform's
 * transactional emails. TanStack Start has no file-based API routes, so this
 * lives in a server function ("use server" boundary) and is called via RPC
 * from the routes, exactly like every other backend call in this app.
 *
 *   type: "new_registration"
 *     → saves the pending row into mentor_approvals (insert-if-missing, so an
 *       admin decision can never be downgraded by a re-registration) and
 *       emails the admin to approve it.
 *
 *   type: "license_approved"
 *     → saves the issued key into the license_keys table and emails the user
 *       their license key.
 *
 * Secrets: BREVO_API_KEY + BREVO_SENDER_EMAIL (falls back to the verified
 * gmail sender) and SUPABASE_SERVICE_ROLE_KEY. The full Brevo HTTP response
 * is logged on every send so failures are diagnosable from the deploy logs.
 */

const ADMIN_EMAIL = "biyasentobeko222@gmail.com";
const DEFAULT_SENDER = "eamigratepro@gmail.com";
const PORTAL_URL = "https://eamigratepro.vercel.app/";

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();

let cachedClient: SupabaseClient | null = null;

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

/** Raw Brevo v3 send — logs the FULL response (status + body) every time. */
async function sendViaBrevo(options: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
  const sender = (process.env["BREVO_SENDER_EMAIL"] ?? DEFAULT_SENDER).trim() || DEFAULT_SENDER;
  if (apiKey.length === 0) {
    console.error("[send-email] BREVO_API_KEY is not set — email skipped for", options.to);
    return { ok: false, error: "BREVO_API_KEY is not set — add it in Settings → Environment." };
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "EA Migrate Pro Team", email: sender },
        to: [{ email: options.to, name: options.toName }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Full Brevo response — logged verbatim for deploy-log diagnosis.
    const body = await response.text().catch(() => "");
    console.log(`[send-email] Brevo response for ${options.to}: HTTP ${response.status}`, body.slice(0, 800));
    if (!response.ok) {
      return { ok: false, error: `Brevo rejected the send (HTTP ${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    console.error("[send-email] Brevo request error for", options.to, error);
    return { ok: false, error: "Brevo could not be reached — try again." };
  }
}

/** Brand HTML shell matching every other EA Migrate Pro email. */
function brandHtml(heading: string, paragraphs: string[], buttonText: string, buttonColor: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px 32px 0 32px;">
            <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
            <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">${heading}</h1>
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;">
            ${paragraphs
              .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${p}</p>`)
              .join("\n            ")}
          </td></tr>
          <tr><td align="center" style="padding:28px 32px 32px 32px;">
            <a href="${PORTAL_URL}" style="display:inline-block;background:${buttonColor};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">${buttonText}</a>
            <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span><br /><br />EA Migrate Pro Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export type SendEmailInput =
  | { type: "new_registration"; email: string; firstName?: string; displayName?: string }
  | { type: "license_approved"; email: string; licenseKey: string; eaName?: string; expiry?: string };

export type SendEmailResult = { success: boolean; error?: string };

export const sendPortalEmail = createServerFn({ method: "POST" })
  .validator((data: SendEmailInput) => data)
  .handler(async ({ data }): Promise<SendEmailResult> => {
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "A valid email address is required." };
    }

    if (data.type === "new_registration") {
      // Save the pending approval row — insert-if-missing so a re-registration
      // (or a replayed call) can never downgrade an existing admin decision.
      const client = db();
      if (client) {
        const existing = await client
          .from("mentor_approvals")
          .select("email")
          .eq("email", email)
          .maybeSingle();
        if (existing.error) console.error("[send-email] mentor_approvals read failed:", existing.error.message);
        if (!existing.error && !existing.data) {
          const inserted = await client
            .from("mentor_approvals")
            .insert({ email, status: "pending" });
          if (inserted.error) {
            console.error("[send-email] mentor_approvals insert failed:", inserted.error.message);
            return { success: false, error: "Could not save the pending approval — try again." };
          }
        }
      }
      const name = (data.displayName ?? data.firstName ?? "").trim();
      const send = await sendViaBrevo({
        to: ADMIN_EMAIL,
        toName: "EA Migrate Pro Admin",
        subject: "New user registered - EA Migrate Pro",
        html: brandHtml(
          "New user registered",
          [
            `New user registered: <strong style="color:#FFFFFF;">${email}</strong>${name ? ` (${name})` : ""}`,
            "Approve them in the admin console so they can start issuing license keys.",
          ],
          "Open Admin Console",
          "#E7B53A",
        ),
        text: `New user registered: ${email}${name ? ` (${name})` : ""} - Approve in admin.\n\nAdmin console: ${PORTAL_URL}`,
      });
      return send.ok ? { success: true } : { success: false, error: send.error ?? "Brevo send failed." };
    }

    // license_approved — save the key, then email it to the user.
    const licenseKey = data.licenseKey.trim().toUpperCase();
    if (!licenseKey) return { success: false, error: "A license key is required." };

    const client = db();
    if (client) {
      const saved = await client.from("license_keys").upsert(
        {
          license_key: licenseKey,
          email,
          ea_name: data.eaName?.trim() || null,
          expiry: data.expiry?.trim() || null,
        },
        { onConflict: "license_key" },
      );
      if (saved.error) {
        console.error("[send-email] license_keys upsert failed:", saved.error.message);
        return { success: false, error: "Could not save the license key — try again." };
      }
    }

    const eaName = data.eaName?.trim() || "Your EA";
    const expiry = data.expiry?.trim() || "Lifetime";
    const send = await sendViaBrevo({
      to: email,
      toName: email,
      subject: "Approved - Your EA License",
      html: brandHtml(
        "Approved - Your EA License",
        [
          "Congratulations — your EA Migrate Pro license has been approved! 🎉",
          `Your license key for <strong style="color:#FFFFFF;">${eaName}</strong> (expiry: ${expiry}):`,
          `<span style="display:block;margin:8px 0;padding:14px 16px;border:1px solid #E7B53A;border-radius:12px;background:#1A1608;color:#E7B53A;font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:0.12em;">${licenseKey}</span>`,
          "Keep this email safe — you will need the key whenever you reinstall the EA.",
        ],
        "Activate Your License",
        "#E7B53A",
      ),
      text: `Approved - Your EA License\n\nEA: ${eaName}\nExpiry: ${expiry}\nLicense key: ${licenseKey}\n\nActivate it in the EA Migrate Pro Portal: ${PORTAL_URL}\n\nKeep this email safe — you will need the key whenever you reinstall the EA.`,
    });
    return send.ok ? { success: true } : { success: false, error: send.error ?? "Brevo send failed." };
  });
