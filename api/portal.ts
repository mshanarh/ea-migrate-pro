/**
 * /api/portal — the two things the ADMIN CONSOLE cannot do from a browser on
 * the static deployment.
 *
 * WHY THIS EXISTS
 * ───────────────
 * This app ships as a STATIC build (`package.json` builds `dist/`, and
 * `vercel.json` points at it), so there is no long-running Node process. That
 * breaks two things the console depends on, and both were reported as
 * "nothing happens":
 *
 *   1. EMAIL. `src/lib/send-email.ts` tried, in order:
 *        a) the Supabase edge function `supabase/functions/send-email`
 *           → **404 "Requested function was not found"**. It was never
 *             deployed, and nothing in this repository can deploy it.
 *        b) a browser-direct Brevo send using `VITE_BREVO_API_KEY`
 *           → **not set**, and deliberately so: Vite inlines it into the
 *             public bundle, so anybody could read the key and send mail as
 *             the platform.
 *      Both routes are dead ends, so EVERY email — registration alerts,
 *      approval decisions, licence keys and admin broadcasts to mentors —
 *      failed with "No email service is available". The wiring was correct;
 *      there was simply no server left to hold the secret.
 *
 *   2. CLEARING A MESSAGE. `deleteBroadcast` called `adminDeleteMessage`, a
 *      TanStack server function. `POST /_serverFn/*` answers **405** on this
 *      deployment (verified against production), so "Clear message" always
 *      errored. It cannot be fixed from the browser either: `app_messages`
 *      grants the anon key `insert` + `select` and **no delete** — a direct
 *      delete returns `42501 permission denied` (verified live).
 *
 * Both need `SUPABASE_SERVICE_ROLE_KEY` / `BREVO_API_KEY`, secrets a browser
 * must never see. Vercel runs anything in `/api` as a serverless function and
 * serves it alongside the static `dist/`, so this file is the whole server
 * half of those two features. Same shape and the same reasons as
 * `api/activation.ts`.
 *
 * ACTIONS
 * ───────
 *   sendEmail      one transactional email through Brevo
 *   deleteMessage  remove one row from the console's broadcast history
 *
 * ENV VARS (Vercel project settings):
 *   BREVO_API_KEY              sends the mail
 *   BREVO_SENDER_EMAIL         optional; falls back to eamigratepro@gmail.com
 *   SUPABASE_URL               optional; VITE_SUPABASE_URL is used otherwise
 *   SUPABASE_SERVICE_ROLE_KEY  the secret, used ONLY to delete
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Vercel request/response shape, declared locally.
 *
 * `@vercel/node` is not a dependency of this project and is deliberately not
 * added for two types: Vercel supplies these at runtime, and importing a
 * package that is not installed would fail typecheck for a file whose only
 * dependency is the Supabase client the app already ships.
 */
type ApiRequest = {
  method?: string;
  body?: unknown;
};
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

type Action = "sendEmail" | "deleteMessage";

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const BREVO_API_KEY = (process.env["BREVO_API_KEY"] ?? "").trim();
const SENDER =
  (process.env["BREVO_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim() ||
  "eamigratepro@gmail.com";

/**
 * CAN THIS From: ADDRESS BE AUTHORISED BY A RECEIVING SERVER?
 *
 * The same rule as `api/activation.ts`, and for the same reason. This function
 * sends licence keys and admin broadcasts — mail a customer waits for and mail
 * the platform itself depends on — and it used to answer "ok" for any 201.
 *
 * A 201 from Brevo is receipt, not delivery. With a free-mail `From:` relayed
 * through Brevo the message is unauthenticated: `gmail.com`'s SPF is
 * `v=spf1 redirect=_spf.google.com`, which authorises Google's servers and not
 * Brevo's, so the receiving server is free to defer or drop it. That is the
 * measured behaviour on this account — a two-hour-old message arriving.
 *
 * Refusing here rather than queueing is the point: a broadcast that silently
 * never reaches anybody is the worst outcome available, because the console
 * records it as sent and the owner believes every customer was told.
 */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "web.de",
  "tutanota.com",
  "fastmail.com",
  "hey.com",
]);

/** The domain part of `From:`, and whether it can ever be authenticated.
 *
 * The PARENT domain is checked too: `mail@yahoo.com` is under `yahoo.com`, and
 * matching only the full string let that through. `scripts/verify-sender-guard.ts`
 * sends from exactly that shape because it is the one most likely to slip past a
 * list.
 */
function senderIsAuthenticatable(): boolean {
  const at = SENDER.lastIndexOf("@");
  if (at === -1) return false;
  const domain = SENDER.slice(at + 1)
    .trim()
    .toLowerCase();
  if (FREEMAIL_DOMAINS.has(domain)) return false;
  const labels = domain.split(".");
  const parent = labels.length > 2 ? labels.slice(-2).join(".") : domain;
  return !FREEMAIL_DOMAINS.has(parent);
}

const NOT_CONFIGURED = "Email service is not configured on the server.";
const NOT_AUTHORISED = "Only an administrator can do that.";

type Reply = { ok: boolean; error?: string };

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The platform owner's addresses — THE SAME LIST as OWNER_EMAILS in
 * src/lib/auth-store.ts, which the console gate uses. Duplicated rather than
 * imported because that module is browser state (localStorage) and importing
 * it into a serverless function would drag the client graph in with it.
 *
 * ⚠ KEEP IN SYNC with `OWNER_EMAILS` in src/lib/auth-store.ts. It is checked
 * by `bun scripts/verify-admin-can-delete.ts`, which fails if the two drift
 * and somebody can open the console but not clear a message.
 */
const OWNER_EMAILS = [
  "biyasentobeko222@gmail.com",
  "biyasentobeko222@gmail",
  "admin@eamigrate.pro",
  "lwethunkandi3@gmail.com",
  "ntobekotraders.official@gmail.com",
];

/**
 * Is this address an administrator?
 *
 * IT MUST ANSWER EXACTLY WHAT THE CONSOLE GATE ANSWERS, no narrower. The
 * console opens for `account.role === "admin"` OR an OWNER_EMAILS entry
 * (isAdminEmail in src/routes/admin.tsx). An earlier version of this function
 * checked only `users.is_admin`, and a live check showed 4 of the 5 addresses
 * that can open the console — including the platform owner — would have been
 * refused here with "Only an administrator can do that". That is the exact
 * error this endpoint exists to remove, so all three conditions the console
 * honours are honoured here.
 *
 * HONEST SCOPE, and it matters: this is a ROLE CHECK, not an authenticated
 * session. The caller names the address, and the anon key can insert a
 * `users` row with any `is_admin` value it likes (verified live). So this
 * stops the console's own button from breaking and stops casual abuse; it is
 * NOT cryptographic authentication. The durable fix is a real signed-in
 * session checked here, which this deployment has no way to mint.
 *
 * It is recorded here rather than left implicit because a delete that looks
 * authenticated but is not should never be a surprise.
 */
async function isAdmin(client: SupabaseClient, email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  if (OWNER_EMAILS.includes(clean)) return true;

  // 1. The console's own database role.
  const flag = await client.from("users").select("is_admin").eq("email", clean).limit(1);
  if (
    !flag.error &&
    ((flag.data ?? []) as Array<{ is_admin?: boolean | null }>).some((r) => r.is_admin === true)
  ) {
    return true;
  }

  // 2. The portal account's own role — the console reads this as
  //    `account.role`, so somebody the portal calls an admin is one here too.
  const portal = await client.from("portal_accounts").select("data").eq("email", clean).limit(1);
  const rows = (portal.data ?? []) as Array<{ data?: string | null }>;
  for (const row of rows) {
    if (!row.data) continue;
    try {
      const parsed = JSON.parse(row.data) as { role?: unknown };
      if (typeof parsed.role === "string" && parsed.role.toLowerCase() === "admin") return true;
    } catch {
      /* a blob that will not parse carries no role */
    }
  }
  return false;
}

/** Raw Brevo v3 send. The full response is logged so failures are diagnosable. */
async function mailViaBrevo(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<Reply> {
  if (!BREVO_API_KEY) {
    console.error("[portal] BREVO_API_KEY is not set — email skipped for", options.to);
    return { ok: false, error: NOT_CONFIGURED };
  }
  if (!senderIsAuthenticatable()) {
    console.error(
      `[portal] REFUSING to send to ${options.to}: the From: address ${SENDER} is a free-mail domain that no receiving server authorises for Brevo.`,
    );
    console.error(
      "[portal] SPF for gmail.com is `v=spf1 redirect=_spf.google.com` — it does not list Brevo, so the message is unauthenticated and is deferred or dropped.",
    );
    console.error(
      "[portal] FIX (Brevo + registrar access, not a code change): authenticate a domain you own in Brevo, publish its SPF and DKIM records, then set BREVO_SENDER_EMAIL to an address on that domain.",
    );
    return {
      ok: false,
      error:
        "Email cannot be delivered from the current sending address (BREVO_SENDER_EMAIL). Authenticate a sending domain in Brevo and set BREVO_SENDER_EMAIL, then retry.",
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
        sender: { name: "EA Migrate Team", email: SENDER },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text().catch(() => "");
    // Brevo answers 201 on success. Logged verbatim so a deploy log shows
    // whether a refusal was "sender not verified" or a bad key.
    console.log(
      `[portal] Brevo response for ${options.to}: HTTP ${response.status}`,
      body.slice(0, 400),
    );
    /* WORDING MATTERS HERE. `accepted` is what Brevo answered; `delivered` is
     * something only the receiving server can say, minutes later, and this
     * function never learns it without a webhook. Logging "sent" for a queued
     * message is what made a two-hour-old arrival look like an instant one. */
    if (response.ok)
      console.log(`[portal] Brevo QUEUED (not yet delivered) the message for ${options.to}`);
    if (!response.ok) {
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === "string") detail = parsed.message.slice(0, 200);
      } catch {
        /* keep the raw body */
      }
      return {
        ok: false,
        error: `The email service refused the message (${response.status})${detail ? `: ${detail}` : "."}`,
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("[portal] Brevo request error for", options.to, error);
    return { ok: false, error: "The email service could not be reached — try again." };
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  // Only POST. A GET here would be a link a browser could be lured into
  // following with a prefetch; neither action should ever be reachable that way.
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const body = (typeof request.body === "string" ? safeParse(request.body) : request.body) as {
    action?: Action;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
    id?: string;
    adminEmail?: string;
  } | null;

  const action = body?.action;
  if (action !== "sendEmail" && action !== "deleteMessage") {
    response.status(400).json({ ok: false, error: "Unknown action" });
    return;
  }

  /* ── sendEmail ─────────────────────────────────────────────────────── */
  if (action === "sendEmail") {
    const to = (body?.to ?? "").trim().toLowerCase();
    const subject = (body?.subject ?? "").trim();
    const html = (body?.html ?? "").trim();
    const text = (body?.text ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      response.status(200).json({ ok: false, error: "Enter a valid email address." });
      return;
    }
    // A subject with no heading is how a notice arrives looking like spam, and
    // Brevo rejects an empty subject outright — either way it must not send.
    if (!subject || !html) {
      response.status(200).json({ ok: false, error: "That email could not be built." });
      return;
    }
    response.status(200).json(await mailViaBrevo({ to, subject, html, text: text || subject }));
    return;
  }

  /* ── deleteMessage ─────────────────────────────────────────────────── */
  const id = (body?.id ?? "").trim();
  const adminEmail = (body?.adminEmail ?? "").trim().toLowerCase();
  if (!id) {
    response.status(200).json({ ok: false, error: "Missing message id" });
    return;
  }
  if (!adminEmail) {
    response.status(401).json({ ok: false, error: NOT_AUTHORISED });
    return;
  }
  const client = db();
  if (!client) {
    // Fail LOUDLY and do nothing: `app_messages` grants the anon key no
    // delete, so there is no silent weaker path to fall back to.
    response.status(503).json({ ok: false, error: NOT_CONFIGURED });
    return;
  }
  if (!(await isAdmin(client, adminEmail))) {
    response.status(403).json({ ok: false, error: NOT_AUTHORISED });
    return;
  }
  const { error, count } = await client
    .from("app_messages")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) {
    console.error("[portal] delete failed:", error.message);
    response.status(200).json({ ok: false, error: error.message });
    return;
  }
  // Zero rows deleted is NOT success. The row is already gone, and reporting
  // otherwise leaves the admin staring at a button that "worked" while the
  // list it came from never refreshed.
  if (!count) {
    response.status(200).json({ ok: false, error: "That message no longer exists" });
    return;
  }
  response.status(200).json({ ok: true });
}

/** A malformed body must not take the function down with a 500. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
