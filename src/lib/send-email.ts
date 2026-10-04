/**
 * Transactional email — Supabase Edge Function → Brevo, with a browser-direct
 * fallback.
 *
 * The Brevo key used to be read from VITE_BREVO_API_KEY, which Vite inlines
 * into the public JavaScript bundle: anyone who opened the site could read it
 * and send mail as the platform. A server-side function
 * (supabase/functions/send-email) now holds the key in a Supabase secret and
 * is the preferred route.
 *
 * That function is not deployed yet, so this module still falls back to
 * sending from the browser with the build-time key. Email therefore works
 * again immediately, and the day the function is deployed the fallback is
 * never reached and VITE_BREVO_API_KEY can be deleted from the build
 * environment for good.
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

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Message = { to: string; subject: string; html: string; text: string };

/**
 * Render one of the platform's emails in the browser.
 *
 * This is the FALLBACK path — it exists so the product keeps working while the
 * edge function is still being deployed. It needs the Brevo key in the build
 * environment, which is exactly what puts that key in the public bundle. Once
 * the function is deployed this is never reached, and the key can be removed
 * from the build environment for good.
 */
function renderMessage(
  kind: "new_registration" | "approval_decision" | "license_approved" | "broadcast",
  to: string,
  params: Record<string, unknown>,
): Message | null {
  const name = typeof params["name"] === "string" ? escapeHtml(params["name"].slice(0, 80)) : "";
  if (kind === "new_registration") {
    return {
      to,
      subject: "New user registered - EA Migrate",
      html: brandHtml(
        "New user registered",
        [
          `New user registered: <strong style="color:#FFFFFF;">${escapeHtml(to)}</strong>${name ? ` (${name})` : ""}`,
          "Approve them in the admin console so they can start issuing license keys.",
        ],
        "Open Admin Console",
        "#E7B53A",
      ),
      text: `New user registered: ${to}${name ? ` (${name})` : ""} - Approve in admin.\n\nAdmin console: ${PORTAL_URL}`,
    };
  }
  if (kind === "approval_decision") {
    const approved = params["decision"] === "approved";
    const limit = Number(params["licenseLimit"] ?? 0);
    return {
      to,
      subject: approved ? "Your EA Migrate account is approved" : "EA Migrate account update",
      html: brandHtml(
        approved ? "Your account is approved" : "Your account was not approved",
        approved
          ? [
              `Good news — your EA Migrate account <strong style="color:#FFFFFF;">${escapeHtml(to)}</strong> has been approved.`,
              "You can now sign in to your portal and start setting up your Expert Advisors and license keys.",
              Number.isFinite(limit)
                ? `Your license key allowance is <strong style="color:#FFFFFF;">${limit}</strong> key${limit === 1 ? "" : "s"}.`
                : "You can now create license keys from your portal.",
              "Sign in with the same email you registered with.",
            ]
          : [
              `We are sorry — the account <strong style="color:#FFFFFF;">${escapeHtml(to)}</strong> was not approved at this time.`,
              "If you think this is a mistake, reply to this email and our team will take another look.",
            ],
        approved ? "Sign in to your portal" : "Contact EA Migrate",
        approved ? "#E7B53A" : "#8A8A96",
      ),
      text: approved
        ? `Your EA Migrate account (${to}) has been approved.\n\nSign in: ${PORTAL_URL}`
        : `Your EA Migrate account (${to}) was not approved.`,
    };
  }
  if (kind === "license_approved") {
    const key = typeof params["licenseKey"] === "string" ? escapeHtml(params["licenseKey"].trim().toUpperCase()) : "";
    const ea = typeof params["eaName"] === "string" ? escapeHtml(params["eaName"].slice(0, 120)) : "your Expert Advisor";
    if (!key) return null;
    return {
      to,
      subject: `Your license key for ${ea}`,
      html: brandHtml(
        "Your license key is ready",
        [
          `Your Expert Advisor <strong style="color:#FFFFFF;">${ea}</strong> is licensed to you.`,
          `License key: <strong style="color:#FFFFFF;">${key}</strong>`,
          "Enter this key in the EA Migrate app to activate the robot on your MT4/MT5 account.",
        ],
        "Open the app",
        "#38BDF8",
      ),
      text: `Your license key for ${ea}: ${key}\n\n${PORTAL_URL}`,
    };
  }
  const message = typeof params["message"] === "string" ? params["message"].trim().slice(0, 4000) : "";
  if (!message) return null;
  const safe = escapeHtml(message)
    .split(/\n/)
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${line}</p>` : "<br />"))
    .join("\n");
  return {
    to,
    subject: "A message from EA Migrate",
    html: brandHtml("A message from EA Migrate", [safe], "Open EA Migrate", "#E7B53A"),
    text: message,
  };
}

/**
 * Browser-direct Brevo send — only used while the edge function is absent.
 *
 * Mobile networks and embedded WebViews are slow: the old 12s ceiling aborted
 * the request before Brevo ever answered and the failure surfaced as the
 * useless "could not be reached". The timeout is now generous, the attempt is
 * retried once, and the real HTTP status / provider message is reported so a
 * failure is diagnosable instead of a dead end.
 */
async function sendDirectFromBrowser(message: Message): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (import.meta.env["VITE_BREVO_API_KEY"] ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "No email service is available: deploy the send-email function, or set VITE_BREVO_API_KEY.",
    };
  }
  const payload = JSON.stringify({
    sender: { name: "EA Migrate Team", email: DEFAULT_SENDER },
    to: [{ email: message.to, name: message.to }],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
  });
  let lastError = "The email service could not be reached — try again.";
  // Two attempts: a single dropped mobile connection should not cost the
  // client their licence-key email.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return { ok: true };
      const body = await response.text().catch(() => "");
      // Brevo answers with {"code":"…","message":"…"} — surface the message,
      // it is the difference between "sender not verified" and "bad key".
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { message?: unknown; code?: unknown };
        if (typeof parsed.message === "string") {
          detail = parsed.message.slice(0, 200);
        }
      } catch {
        /* keep the raw body */
      }
      console.error(`[send-email] Brevo refused the send (${response.status}):`, detail);
      lastError = `The email service rejected the message (${response.status})${detail ? `: ${detail}` : "."}`;
      // 4xx is a permanent refusal — retrying changes nothing.
      if (response.status < 500) return { ok: false, error: lastError };
    } catch (error) {
      // A timeout, an offline device or a blocked cross-origin request all
      // land here; the reason is logged because the user only ever sees this.
      lastError =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "The email service timed out — try again."
          : "The email service could not be reached — try again.";
      console.warn(`[send-email] Brevo attempt ${attempt} failed:`, error);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Send one of the platform's emails.
 *
 * PREFERRED: the Supabase edge function, which holds the Brevo key in a secret
 * nobody can read from a browser. FALLBACK: the browser sends it directly with
 * VITE_BREVO_API_KEY, which is what shipped before the function existed and
 * which keeps the product working until the function is deployed.
 */
async function sendViaBrevo(options: {
  kind: "new_registration" | "approval_decision" | "license_approved" | "broadcast";
  to: string;
  params?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const params = options.params ?? {};
  const message = renderMessage(options.kind, options.to, params);
  if (!message) return { ok: false, error: "That email could not be built." };

  /* THE SERVER FIRST — this is the route that works on the real deployment.
   *
   * The two routes below it are both dead ends in production, which is why no
   * email was arriving anywhere: the Supabase edge function has never been
   * deployed (404), and the browser fallback needs `VITE_BREVO_API_KEY`, which
   * is deliberately unset because Vite inlines it into the public bundle.
   *
   * `/api/portal` is a Vercel function (see api/portal.ts) that holds
   * BREVO_API_KEY server-side, so the secret stays out of the shipped
   * JavaScript. Nothing is lost by trying it first: both older routes are
   * still attempted when it is absent, which is what keeps a bare `vite dev`
   * working with no server at all.
   */
  try {
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "sendEmail",
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const reply = (await response.json()) as { ok: boolean; error?: string };
      // A 200 carrying ok:false is a real refusal from Brevo (sender not
      // verified, bad address). Falling through would hide it behind the
      // browser fallback's vaguer message, so it is reported as-is.
      return reply.ok ? { ok: true } : { ok: false, error: reply.error ?? "The email service refused the message." };
    }
    console.warn(`[send-email] /api/portal replied ${response.status} — trying the older routes.`);
  } catch {
    console.warn("[send-email] /api/portal unreachable — trying the older routes.");
  }

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: options.kind, to: options.to, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { ok: true };
      const body = await response.text().catch(() => "");
      console.warn(
        `[send-email] edge function replied ${response.status} for ${options.to} — using the browser fallback.`,
        body.slice(0, 160),
      );
    } catch {
      console.warn("[send-email] edge function unreachable — using the browser fallback.");
    }
  }
  return sendDirectFromBrowser(message);
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
  eaImage?: string | null;
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
        eaImage: input.eaImage ?? null,
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
    // Picture travels with the key (same retry rules as the other extras).
    if (input.eaImage) base["ea_image"] = input.eaImage;
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

export type SendEmailInput =
  | { type: "new_registration"; email: string; firstName?: string; displayName?: string }
  | { type: "approval_decision"; email: string; decision: "approved" | "rejected"; licenseLimit?: number }
  | { type: "license_approved"; email: string; licenseKey: string; eaName?: string; expiry?: string; eaImage?: string }
  | { type: "broadcast"; email: string; message: string };

export type SendEmailResult = { success: boolean; error?: string };

/**
 * Tell the admin a new account exists. Both signup paths call this: the website
 * form and the in-app sign-in (registerWithEmail). The app path used to write
 * the pending row silently, so a registration made on the phone produced no
 * notification at all and never reached the admin's inbox.
 *
 * Never throws — a failed alert must not block the person who just registered.
 */
export async function notifyAdminOfRegistration(input: {
  email: string;
  displayName?: string;
}): Promise<void> {
  try {
    await sendPortalEmail({
      data: {
        type: "new_registration",
        email: input.email,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
    });
  } catch (error) {
    console.error("[send-email] new-registration alert failed for", input.email, error);
  }
}

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
    // BOTH admin inboxes — a single recipient that silently filters or
    // clusters these alerts made "new registrations never arrive". The function
    // sends one message per recipient; any address that receives it is enough.
    const [first, second] = await Promise.allSettled([
      sendViaBrevo({ kind: "new_registration", to: ADMIN_EMAIL, params: name ? { name } : {} }),
      sendViaBrevo({ kind: "new_registration", to: ADMIN_EMAIL_2, params: name ? { name } : {} }),
    ]);
    if (first.status === "fulfilled" && first.value.ok) return { success: true };
    if (second.status === "fulfilled" && second.value.ok) return { success: true };
    const failure = (first.status === "rejected" ? String(first.reason) : first.value.error) ?? (second.status === "rejected" ? String(second.reason) : second.value.error) ?? "The email service could not send the alert.";
    return { success: false, error: failure };
  }

  // approval_decision — the admin console's APPROVE / REJECT decision.
  // The person who pressed the button gets told, so nobody is left guessing
  // why their account still cannot sign in. The approved copy states the
  // exact key allowance that was granted, because that is the number they
  // will hit when they create their first license key.
  if (data.type === "approval_decision") {
    const sent = await sendViaBrevo({
      kind: "approval_decision",
      to: email,
      params: { decision: data.decision, licenseLimit: Number(data.licenseLimit ?? 0) },
    });
    return sent.ok ? { success: true } : { success: false, ...(sent.error ? { error: sent.error } : {}) };
  }

  // broadcast — a plain message from the admin to one recipient.
  if (data.type === "broadcast") {
    const message = data.message.trim();
    if (!message) return { success: false, error: "The message is empty." };
    const sent = await sendViaBrevo({ kind: "broadcast", to: email, params: { message } });
    return sent.ok ? { success: true } : { success: false, ...(sent.error ? { error: sent.error } : {}) };
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
      eaImage: data.eaImage ?? null,
    });
    if (!keySaved) {
      console.warn("[send-email] license_keys save returned false for", email, "— sending the key email anyway");
    }
  } catch (saveError) {
    console.warn("[send-email] license_keys save failed for", email, "— sending the key email anyway:", saveError);
  }

  const send = await sendViaBrevo({
    kind: "license_approved",
    to: email,
    params: { licenseKey, eaName },
  });
  return send.ok ? { success: true } : { success: false, error: send.error ?? "The email service could not send the key." };
};
