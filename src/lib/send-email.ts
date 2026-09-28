/**
 * Transactional email — browser → Brevo direct.
 *
 * The production app deploys as a STATIC Vite site on Vercel, so TanStack
 * server functions (the old send-email.server.ts path) 404 there and every
 * email silently failed. Brevo's v3 API allows CORS from the app's origin
 * (verified), so the browser sends the request itself.
 *
 * Secrets: BREVO_API_KEY is provided as BREVO_VITE_BREVO_API_KEY (VITE_
 * prefixed so Vite inlines it at build time; the BREVO_* name is NOT
 * auto-exposed). Add it in Settings → Environment and redeploy.
 *
 *   type: "new_registration"
 *     → emails the admin to approve the new user (pending row is saved by
 *       the Supabase anon client below — insert-if-missing).
 *
 *   type: "license_approved"
 *     → saves the issued key into the license_keys table and emails the
 *       user their license key.
 */

const ADMIN_EMAIL = "biyasentobeko222@gmail.com";
const DEFAULT_SENDER = "eamigratepro@gmail.com";
const PORTAL_URL = "https://eamigratepro.vercel.app/";

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
const BREVO_API_KEY = (import.meta.env["BREVO_VITE_BREVO_API_KEY"] ?? "").trim();

/** Raw Brevo v3 send from the browser — logs the FULL response every time. */
async function sendViaBrevo(options: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (BREVO_API_KEY.length === 0) {
    console.error("[send-email] BREVO_VITE_BREVO_API_KEY is not set — email skipped for", options.to);
    return {
      ok: false,
      error: "Email service is not configured — add BREVO_VITE_BREVO_API_KEY in Settings → Environment and redeploy.",
    };
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "EA Migrate Team", email: DEFAULT_SENDER },
        to: [{ email: options.to, name: options.toName }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text().catch(() => "");
    console.log(`[send-email] Brevo response for ${options.to}: HTTP ${response.status}`, body.slice(0, 300));
    if (!response.ok) {
      return { ok: false, error: `Brevo rejected the send (HTTP ${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Brevo could not be reached — try again." };
  }
}

/** Insert-if-missing pending row via the anon client (schema default status). */
async function savePendingApproval(email: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const existing = await client.from("mentor_approvals").select("email").eq("email", email).maybeSingle();
    if (existing.error) {
      console.error("[send-email] mentor_approvals read failed:", existing.error.message);
      return false;
    }
    if (existing.data) return true;
    const inserted = await client.from("mentor_approvals").insert({ email, status: "pending" });
    if (inserted.error) {
      console.error("[send-email] mentor_approvals insert failed:", inserted.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[send-email] pending-approval save failed:", error);
    return false;
  }
}

/**
 * Upsert the issued key into license_keys via the anon client. The live
 * table's key column is `key`; the optional ea_name/expiry columns may not
 * exist on legacy tables, so the write retries WITHOUT them (PostgREST
 * error 42703 = column does not exist) and the key row always lands.
 */
async function saveLicenseKey(input: {
  licenseKey: string;
  email: string;
  eaName: string | null;
  expiry: string | null;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  // SECURE PATH FIRST: issue through the server function with the
  // service-role key. Once supabase/secure-payment-gate.sql is applied, the
  // anon insert on license_keys is blocked (anyone could otherwise forge a
  // key row for their own email), so issuance MUST go through the server.
  try {
    const { issueLicenseKeySecure } = await import("@/lib/supabase.server");
    const secure = await issueLicenseKeySecure({
      data: {
        licenseKey: input.licenseKey,
        email: input.email,
        eaName: input.eaName,
        expiry: input.expiry,
      },
    });
    if (secure.ok) return true;
    console.warn("[send-email] secure key issuance failed:", secure.error, "— trying anon fallback");
  } catch (secureError) {
    console.warn("[send-email] secure key issuance unavailable:", secureError);
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // The live table's key column is `key` (legacy schema); optional columns
    // (ea_name/expiry) are only sent when present so legacy tables work too.
    const base: Record<string, unknown> = { key: input.licenseKey, email: input.email };
    const extras: Record<string, unknown> = {};
    if (input.eaName) extras["ea_name"] = input.eaName;
    if (input.expiry) extras["expiry"] = input.expiry;

    let result = await client.from("license_keys").upsert(
      Object.keys(extras).length > 0 ? { ...base, ...extras } : base,
      Object.keys(extras).length > 0 ? { onConflict: "key" } : undefined,
    );
    if (result.error?.code === "42703") {
      // Legacy table without the optional columns — write the core row only.
      result = await client.from("license_keys").upsert(base);
    }
    if (result.error) {
      console.error("[send-email] license_keys upsert failed:", result.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[send-email] license_keys save failed:", error);
    return false;
  }
}

/** Brand HTML shell matching every other EA Migrate email. */
function brandHtml(heading: string, paragraphs: string[], buttonText: string, buttonColor: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px 32px 0 32px;">
            <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate</p>
            <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">${heading}</h1>
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;">
            ${paragraphs
              .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${p}</p>`)
              .join("\n            ")}
          </td></tr>
          <tr><td align="center" style="padding:28px 32px 32px 32px;">
            <a href="${PORTAL_URL}" style="display:inline-block;background:${buttonColor};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">${buttonText}</a>
            <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span><br /><br />EA Migrate Team</p>
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

/**
 * Same call contract as the old server function (including the `{ data }`
 * wrapper) so every call site keeps working unchanged — the send just runs
 * in the browser against Brevo's public API.
 */
export const sendPortalEmail = async ({ data }: { data: SendEmailInput }): Promise<SendEmailResult> => {
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "A valid email address is required." };
  }

  if (data.type === "new_registration") {
    // Save the pending approval row (insert-if-missing) before notifying.
    const saved = await savePendingApproval(email);
    if (!saved) {
      return { success: false, error: "Could not save the pending approval — check the Supabase configuration." };
    }
    const name = (data.displayName ?? data.firstName ?? "").trim();
    const send = await sendViaBrevo({
      to: ADMIN_EMAIL,
      toName: "EA Migrate Admin",
      subject: "New user registered - EA Migrate",
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

  const eaName = data.eaName?.trim() || "Your EA";
  const expiry = data.expiry?.trim() || "Lifetime";
  const keySaved = await saveLicenseKey({
    licenseKey,
    email,
    eaName: data.eaName?.trim() || null,
    expiry: data.expiry?.trim() || null,
  });
  if (!keySaved) {
    return { success: false, error: "Could not save the license key — check the Supabase configuration." };
  }

  const send = await sendViaBrevo({
    to: email,
    toName: email,
    subject: "Approved - Your EA License",
    html: brandHtml(
      "Approved - Your EA License",
      [
        "Congratulations — your EA Migrate license has been approved! 🎉",
        `Your license key for <strong style="color:#FFFFFF;">${eaName}</strong> (expiry: ${expiry}):`,
        `<span style="display:block;margin:8px 0;padding:14px 16px;border:1px solid #E7B53A;border-radius:12px;background:#1A1608;color:#E7B53A;font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:0.12em;">${licenseKey}</span>`,
        "Keep this email safe — you will need the key whenever you reinstall the EA.",
      ],
      "Activate Your License",
      "#E7B53A",
    ),
    text: `Approved - Your EA License\n\nEA: ${eaName}\nExpiry: ${expiry}\nLicense key: ${licenseKey}\n\nActivate it in the EA Migrate Portal: ${PORTAL_URL}\n\nKeep this email safe — you will need the key whenever you reinstall the EA.`,
  });
  return send.ok ? { success: true } : { success: false, error: send.error ?? "Brevo send failed." };
};
