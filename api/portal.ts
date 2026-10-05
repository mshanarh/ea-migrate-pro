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
 *           deployed, and nothing in this repository can deploy it.
 *        b) a browser-direct Brevo send using `VITE_BREVO_API_KEY`
 *           → **not set**, and deliberately so: Vite inlines it into the
 *           public bundle, so anybody could read the key and send mail as
 *           the platform.
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
 * Both need `SUPABASE_SERVICE_ROLE_KEY` / `MAILJET_SECRET_KEY`, secrets a
 * browser must never see. Vercel runs anything in `/api` as a serverless
 * function and serves it alongside the static `dist/`, so this file is the whole
 * server half of those two features. Same shape and the same reasons as
 * `api/activation.ts`.
 *
 * ACTIONS
 * ───────
 *   sendEmail      one transactional email through Mailjet
 *   deleteMessage  remove one row from the console's broadcast history
 *
 * ENV VARS (Vercel project settings):
 *   MAILJET_API_KEY             sends the mail
 *   MAILJET_SECRET_KEY          Mailjet private API key
 *   MAILJET_SENDER_EMAIL        the From address; falls back to eamigratepro@gmail.com
 *   SUPABASE_URL                optional; VITE_SUPABASE_URL is used otherwise
 *   SUPABASE_SERVICE_ROLE_KEY   the secret, used ONLY to delete
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMail } from "../src/lib/mailjet.server";

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

const NOT_CONFIGURED = "Email service is not configured on the server.";
const NOT_AUTHORISED = "Only an administrator can do that.";

/**
 * DID THE MAIL GET SENT?
 *
 * Mailjet answers HTTP 200 with `Status: "success"` as soon as it accepts a
 * message onto its queue. That is receipt, not delivery. Delivery can only be
 * read back from the receiving server minutes later, and this app has no webhook
 * configured to read it — so the only honest answer this function gives is what
 * Mailjet actually answered, and `sendMail` in src/lib/mailjet.server.ts is where
 * that is decided.
 */
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
    // Mailjet refuses an empty subject outright — either way it must not send.
    if (!subject || !html) {
      response.status(200).json({ ok: false, error: "That email could not be built." });
      return;
    }
    response
      .status(200)
      .json(await sendMail({ to, subject, html, text: text || subject }));
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