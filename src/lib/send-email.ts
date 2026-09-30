/**
 * Transactional email — browser → Brevo direct.
 *
 * The production app deploys as a STATIC Vite site on Vercel, so TanStack
 * server functions (the old send-email.server.ts path) 404 there and every
 * email silently failed. Brevo's v3 API allows CORS from the app's origin
 * (verified), so the browser sends the request itself.
 *
 * Secrets: the Brevo key is read at send time from VITE_BREVO_API_KEY
 * (standard Vite build-time name) with BREVO_API_KEY as a fallback. Add it
 * in Vercel settings (or Settings → Environment) and redeploy.
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
/** Second admin inbox — the known-good recipient for registration alerts. */
const ADMIN_EMAIL_2 = "eamigratepro@gmail.com";
const DEFAULT_SENDER = "eamigratepro@gmail.com";
const PORTAL_URL = "https://eamigratepro.vercel.app/";

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();

/** Raw Brevo v3 send from the browser — logs the FULL response every time. */
async function sendViaBrevo(options: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  // SERVER FIRST: when the host runs server functions (Vercel full-stack),
  // the mail goes out with the RUNTIME BREVO_API_KEY — the key never ships
  // in the public JS bundle and stays valid across rebuilds.
  try {
    const { sendPortalEmail: sendViaServer } = await import("@/lib/send-email.server");
    const viaServer = await sendViaServer({
      data: { type: "generic", email: options.to, subject: options.subject, html: options.html, text: options.text },
    });
    if (viaServer.success) return { ok: true };
    console.warn("[send-email] server send failed:", viaServer.error, "— trying browser-direct Brevo");
  } catch {
    /* static host — server functions 404; the browser path decides below */
  }
  const apiKey = (
    import.meta.env["VITE_BREVO_API_KEY"] ||
    import.meta.env["BREVO_API_KEY"] ||
    ""
  ).trim();
  if (apiKey.length === 0) {
    console.error("[send-email] VITE_BREVO_API_KEY is missing — email skipped for", options.to);
    return {
      ok: false,
      error: "VITE_BREVO_API_KEY is missing. Add it in Vercel settings and redeploy.",
    };
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
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
      return { ok: false, error: `Brevo error (${response.status}): ${body.slice(0, 300)}` };
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
    // The LIVE table's primary key is `id` (uuid default) — `key` is NOT a
    // unique constraint, so upsert(onConflict: "key") fails with "there is
    // no unique or exclusion constraint" and the key row never landed (the
    // app then said "license key was not found" for the owner's own key).
    // INSERT plainly first; only retry as an upsert when a previous insert
    // hit a duplicate-key error (42P10 = no unique constraint is NOT it).
    const base: Record<string, unknown> = { key: input.licenseKey, email: input.email };
    if (input.eaName) base["ea_name"] = input.eaName;
    if (input.expiry) base["expiry"] = input.expiry;
    let result = await client.from("license_keys").insert(base);
    if (result.error?.code === "23505") {
      // Genuine duplicate key value — the row exists; refresh it via upsert
      // on the key column ONLY if the table actually has that constraint.
      result = await client.from("license_keys").upsert(base);
    } else if (result.error?.code === "42P10") {
      // Table without a unique constraint on key: plain insert with the
      // core columns only.
      result = await client.from("license_keys").insert({ key: input.licenseKey, email: input.email });
    } else if (result.error?.code === "42703") {
      // Legacy table without the ea_name/expiry columns — core row only.
      result = await client.from("license_keys").insert({ key: input.licenseKey, email: input.email });
    }
    if (result.error) {
      console.error("[send-email] license_keys save failed:", result.error.code, result.error.message);
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
    // RESILIENT: a missing table or a database hiccup must NEVER block the
    // notification email — the admin can still approve from the console,
    // and the pending row can be recreated on the next attempt.
    try {
      const saved = await savePendingApproval(email);
      if (!saved) {
        console.warn("[send-email] pending-approval save returned false for", email, "— sending the notification email anyway");
      }
    } catch (saveError) {
      console.warn("[send-email] pending-approval save failed for", email, "— sending the notification email anyway:", saveError);
    }
    const name = (data.displayName ?? data.firstName ?? "").trim();
    const html = brandHtml(
      "New user registered",
      [
        `New user registered: <strong style="color:#FFFFFF;">${email}</strong>${name ? ` (${name})` : ""}`,
        "Approve them in the admin console so they can start issuing license keys.",
      ],
      "Open Admin Console",
      "#E7B53A",
    );
    const text = `New user registered: ${email}${name ? ` (${name})` : ""} - Approve in admin.\n\nAdmin console: ${PORTAL_URL}`;
    // BOTH admin inboxes — a single recipient that silently filters or
    // clusters these alerts made "new registrations never arrive". Brevo
    // sends one message per recipient; any address that receives it is enough.
    const [first, second] = await Promise.allSettled([
      sendViaBrevo({ to: ADMIN_EMAIL, toName: "EA Migrate Admin", subject: "New user registered - EA Migrate", html, text }),
      sendViaBrevo({ to: ADMIN_EMAIL_2, toName: "EA Migrate Admin", subject: "New user registered - EA Migrate", html, text }),
    ]);
    if (first.status === "fulfilled" && first.value.ok) return { success: true };
    if (second.status === "fulfilled" && second.value.ok) return { success: true };
    const failure = (first.status === "rejected" ? String(first.reason) : first.value.error) ?? (second.status === "rejected" ? String(second.reason) : second.value.error) ?? "Brevo send failed.";
    return { success: false, error: failure };
  }

  // license_approved — save the key, then email it to the user.
  const licenseKey = data.licenseKey.trim().toUpperCase();
  if (!licenseKey) return { success: false, error: "A license key is required." };

  const eaName = data.eaName?.trim() || "Your EA";
  const expiry = data.expiry?.trim() || "Lifetime";
  // RESILIENT: a missing license_keys table or a database error must NEVER
  // block the key from reaching the client by email — the key is also stored
  // in the mentor's local license list, so delivery always wins.
  try {
    const keySaved = await saveLicenseKey({
      licenseKey,
      email,
      eaName: data.eaName?.trim() || null,
      expiry: data.expiry?.trim() || null,
    });
    if (!keySaved) {
      console.warn("[send-email] license_keys save returned false for", email, "— sending the key email anyway");
    }
  } catch (saveError) {
    console.warn("[send-email] license_keys save failed for", email, "— sending the key email anyway:", saveError);
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
