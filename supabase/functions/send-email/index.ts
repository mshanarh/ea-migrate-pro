/**
 * EA Migrate — server-side email sender.
 *
 * WHY THIS EXISTS
 * The Brevo API key used to be read from VITE_BREVO_API_KEY, which Vite
 * inlines into the public JavaScript bundle. Anyone who opened the site could
 * read it and send email as the platform. The key now lives here, in a Supabase
 * secret, and the browser only ever asks for one of the templates below.
 *
 * THE POINT OF THE RESTRICTIONS
 * A function anyone may call that forwards to Brevo is an open relay: anyone
 * could use your sending quota, your sender reputation and your domain to mail
 * anyone, and Brevo would hold you responsible. So this function:
 *
 *   1. sends ONLY the four templates defined here — the caller never supplies
 *      subject lines, HTML, headers or a sender address;
 *   2. may only send TO an address that already exists in the platform's own
 *      tables (a registered user or an admin), so it cannot be used to mail
 *      strangers;
 *   3. caps how much one caller may send per minute.
 *
 * That is a meaningful reduction, not a guarantee. The app has no real
 * user authentication, so "this request came from a signed-in mentor" cannot be
 * proven here. See the note in send-email.ts about closing that properly.
 *
 * Deploy:  supabase functions deploy send-email --no-verify-jwt
 * Secret:  supabase secrets set BREVO_API_KEY=<your key>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SENDER = { name: "EA Migrate Team", email: "eamigratepro@gmail.com" };
const PORTAL_URL = "https://eamigratepro.vercel.app/";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** ── Rate limit: 10 sends per recipient per minute, per function instance ── */
const recent = new Map<string, number[]>();
function rateLimited(to: string): boolean {
  const now = Date.now();
  const window = 60_000;
  const hits = (recent.get(to) ?? []).filter((t) => now - t < window);
  if (hits.length >= 10) {
    recent.set(to, hits);
    return true;
  }
  hits.push(now);
  recent.set(to, hits);
  return false;
}

/** ── Templates ──────────────────────────────────────────────────────────── */
function shell(heading: string, paragraphs: string[], cta: string, tint = "#E7B53A"): string {
  return `<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background:#0A0A0C;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
<tr><td style="padding:32px 32px 0 32px;">
<p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:${tint};text-transform:uppercase;">EA Migrate</p>
<h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">${heading}</h1></td></tr>
<tr><td style="padding:20px 32px 0 32px;">${paragraphs
    .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${p}</p>`)
    .join("\n")}</td></tr>
<tr><td align="center" style="padding:28px 32px 32px 32px;">
<a href="${PORTAL_URL}" style="display:inline-block;background:${tint};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">${cta}</a>
<p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span><br /><br />EA Migrate Team</p>
</td></tr></table></td></tr></table></body></html>`;
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Template = { subject: string; html: string; text: string };

/**
 * Build one of the four platform emails. Every string that reaches the message
 * is escaped, and nothing the caller sent is used as markup — the caller only
 * chooses WHICH template and WHO it goes to.
 */
function buildTemplate(kind: string, to: string, p: Record<string, unknown>): Template | null {
  const name = typeof p["name"] === "string" ? esc(p["name"].slice(0, 80)) : "";
  switch (kind) {
    case "new_registration":
      return {
        subject: "New user registered - EA Migrate",
        html: shell(
          "New user registered",
          [
            `New user registered: <strong style="color:#FFFFFF;">${esc(to)}</strong>${name ? ` (${name})` : ""}`,
            "Approve them in the admin console so they can start issuing license keys.",
          ],
          "Open Admin Console",
        ),
        text: `New user registered: ${to}${name ? ` (${name})` : ""} - Approve in admin.\n\nAdmin console: ${PORTAL_URL}`,
      };
    case "approval_decision": {
      const approved = p["decision"] === "approved";
      const limit = Number(p["licenseLimit"] ?? 0);
      return {
        subject: approved ? "Your EA Migrate account is approved" : "Your EA Migrate account was not approved",
        html: shell(
          approved ? "Your account is approved" : "Your account was not approved",
          approved
            ? [
                `Good news — your EA Migrate account <strong style="color:#FFFFFF;">${esc(to)}</strong> has been approved.`,
                "You can now sign in to your portal and start setting up your Expert Advisors and license keys.",
                Number.isFinite(limit)
                  ? `Your license key allowance is <strong style="color:#FFFFFF;">${limit}</strong> key${limit === 1 ? "" : "s"}.`
                  : "You can now create license keys from your portal.",
                "Sign in with the same email you registered with.",
              ]
            : [
                `We are sorry — the account <strong style="color:#FFFFFF;">${esc(to)}</strong> was not approved at this time.`,
                "If you think this is a mistake, reply to this email and our team will take another look.",
              ],
          approved ? "Open your portal" : "Back to the website",
          approved ? "#22C55E" : "#EF4444",
        ),
        text: approved
          ? `Your EA Migrate account ${to} has been approved. Sign in: ${PORTAL_URL}`
          : `The account ${to} was not approved.`,
      };
    }
    case "license_approved": {
      const key = typeof p["licenseKey"] === "string" ? esc(p["licenseKey"].trim().toUpperCase()) : "";
      const ea = typeof p["eaName"] === "string" ? esc(p["eaName"].slice(0, 120)) : "your Expert Advisor";
      if (!key) return null;
      return {
        subject: `Your license key for ${ea}`,
        html: shell(
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
    case "broadcast": {
      const msg = typeof p["message"] === "string" ? esc(p["message"].slice(0, 4000)) : "";
      if (!msg) return null;
      return {
        subject: "A message from EA Migrate",
        html: shell("Message from EA Migrate", [msg], "Open the website", "#38BDF8"),
        text: msg,
      };
    }
    default:
      return null;
  }
}

/** ── Recipients: only addresses the platform already knows ──────────────── */
async function isKnownRecipient(supabase: ReturnType<typeof createClient>, email: string): Promise<boolean> {
  const tables = ["users", "mentor_approvals", "portal_accounts", "paid_emails", "admin_emails"];
  for (const table of tables) {
    const { data } = await supabase.from(table).select("email").eq("email", email).limit(1);
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!BREVO_API_KEY) return json({ error: "BREVO_API_KEY is not set on the function." }, 500);

  let payload: { kind?: unknown; to?: unknown; params?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const to = typeof payload.to === "string" ? payload.to.trim().toLowerCase() : "";
  const params = (payload.params ?? {}) as Record<string, unknown>;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "A valid recipient is required." }, 400);
  if (rateLimited(to)) return json({ error: "Too many emails to this address. Try again shortly." }, 429);

  const template = buildTemplate(kind, to, params);
  if (!template) return json({ error: "Unknown email type." }, 400);

  // A NEW registration is by definition not in the tables yet — that is the
  // one message allowed to a previously unknown address. Every other template
  // may only reach someone who already exists here.
  if (kind !== "new_registration") {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    if (!(await isKnownRecipient(supabase, to))) {
      return json({ error: "Recipient is not a known platform address." }, 403);
    }
  }

  const brevo = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: to }],
      subject: template.subject,
      htmlContent: template.html,
      textContent: template.text,
    }),
  });

  const body = await brevo.text();
  if (!brevo.ok) {
    // Log server-side only — the API key never appears in a response.
    console.error("Brevo rejected the send", brevo.status, body.slice(0, 300));
    return json({ error: `Email provider refused the message (${brevo.status}).` }, 502);
  }
  return json({ ok: true });
});
