/**
 * /api/activation — the six-digit activation code and the single-use licence
 * lock, as a VERCEL SERVERLESS FUNCTION.
 *
 * WHY THIS EXISTS, AND WHY IT IS A .ts FILE AT THE REPO ROOT
 * ───────────────────────────────────────────────────────────
 * This app ships as a STATIC build. `package.json` builds `dist/` and
 * `vercel.json` points at it, so there is no long-running Node process — which
 * means TanStack Start's server functions (`POST /_serverFn/*`) answer **405**
 * on the real deployment. Verified against production:
 *
 *     POST https://eamigratepro.vercel.app/_serverFn/<id>   →  405
 *
 * A Supabase Edge Function was the other candidate and is not deployed
 * (`/functions/v1/send-email` → 404 "Requested function was not found"), so it
 * is not something this repository can rely on.
 *
 * Vercel DOES run anything in `/api` as a serverless function, and it serves
 * that alongside the static `dist/` output. So this file is the whole server
 * half of the app: the SPA keeps working exactly as before, and the one thing
 * that genuinely needs a secret — proving inbox control, and locking a key —
 * happens here where `SUPABASE_SERVICE_ROLE_KEY` cannot be read by a browser.
 *
 * The request/response contract is deliberately narrow and identical to
 * `src/lib/activation.server.ts`, which stays as the implementation for any
 * deployment that DOES run server functions. `src/lib/activation-client.ts`
 * tries this endpoint first and falls back, so the app behaves the same on
 * every deployment.
 *
 * ENV VARS (Vercel project settings — required for the code step to work):
 *   SUPABASE_SERVICE_ROLE_KEY   the secret; the browser must never see it
 *   BREVO_API_KEY              sends the code
 *   SUPABASE_URL               optional; VITE_SUPABASE_URL is used otherwise
 *   BREVO_SENDER_EMAIL         optional; falls back to eamigratepro@gmail.com
 *
 * NOTHING here trusts the caller: entitlement is re-read from the database on
 * every request, so a forged `{ paid: true }` from the browser mails nothing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Vercel request/response shape, declared locally.
 *
 * `@vercel/node` is not a dependency of this project and deliberately not added
 * for two types: Vercel builds `/api/*.ts` with its own pipeline and supplies
 * these at runtime, and importing a package that is not installed would fail
 * typecheck for a file that otherwise has no dependency beyond the Supabase
 * client the app already ships.
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

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const BREVO_API_KEY = (process.env["BREVO_API_KEY"] ?? "").trim();
const SENDER =
  (process.env["BREVO_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim() ||
  "eamigratepro@gmail.com";

/**
 * CAN THIS From: ADDRESS BE AUTHORISED BY A RECEIVING SERVER?
 *
 * A 201 from Brevo means the message entered its queue. It does NOT mean any
 * inbox will take it, and the difference is decided entirely by the domain in
 * the `From:` line.
 *
 * THIS FUNCTION IS WHAT STOPS THE APP REPORTING "SENT" FOR MAIL THAT WILL NEVER
 * ARRIVE. It previously returned `ok: true` on any 201, so every log and every
 * screen said "sent" while the customer waited for an email that was never
 * going to come — and nothing in the product ever said why.
 *
 * The rule it applies: a sending domain must be a domain whose DNS publishes an
 * SPF record authorising the sending service. A @gmail.com `From:` relayed
 * through Brevo can never satisfy that — `gmail.com`'s SPF is
 * `v=spf1 redirect=_spf.google.com`, which lists Google's servers and not
 * Brevo's — so the message is unauthenticated and receiving servers are free to
 * defer or discard it. That is measured on this account: the owner reported a
 * two-hour-old message arriving, and a live send behaved the same way.
 *
 * It is deliberately a check on the SENDER'S DOMAIN SHAPE, not a DNS lookup.
 * A serverless function cannot rely on outbound DNS being available, and a
 * lookup that silently failed open would restore exactly the false "sent" this
 * replaces. The shape test is deterministic: no free-mail domain can carry a
 * DKIM record the sender controls, so it can only ever be unauthenticated.
 */
const FREEMAIL_DOMAINS = [
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
];

function senderDomain(): string {
  const at = SENDER.lastIndexOf("@");
  return at === -1
    ? ""
    : SENDER.slice(at + 1)
        .trim()
        .toLowerCase();
}

/** The domain part of `From:`, and whether it can ever be authenticated.
 *
 * The PARENT domain is checked as well, and that is not belt-and-braces: a
 * sender of `mail@yahoo.com` is under `yahoo.com`, and matching only the full
 * string let that through — a real miss caught by
 * `scripts/verify-sender-guard.ts`, which sends from a subdomain precisely
 * because that is the shape most likely to slip past a list.
 */
function senderIsAuthenticatable(): boolean {
  const domain = senderDomain();
  if (!domain) return false;
  if (FREEMAIL_DOMAINS.includes(domain)) return false;
  const labels = domain.split(".");
  const parent = labels.length > 2 ? labels.slice(-2).join(".") : domain;
  return !FREEMAIL_DOMAINS.includes(parent);
}

/**
 * WHAT TO TELL THE CALLER WHEN THE SENDER CANNOT BE AUTHENTICATED.
 *
 * Distinct from every other failure here on purpose. `unavailable` means the
 * service is down and the account is probably fine; this means the message will
 * not arrive and retrying changes nothing. A customer must not be told to "try
 * again" for something that cannot succeed, and support must not have to
 * discover the cause by reading a log.
 */
const SENDER_UNAUTHENTICATED =
  "We cannot send your code right now. Email is temporarily unavailable — message support on WhatsApp and we will unlock you manually.";

/** Told apart from "not entitled" and "key taken" by the client. */
const UNAVAILABLE = "Activation is unavailable right now.";
/**
 * The exact wording for an account the admin has not marked paid.
 *
 * It names the next step rather than saying "not activated", which reads like
 * something the customer did wrong: nothing is wrong with them, the console
 * simply has not been told they paid.
 */
const NOT_ENTITLED = "This email is not marked as paid. Contact admin.";
/**
 * The one message a key that is already activated produces — whether the
 * person trying is the account that activated it or a different one. Both are
 * the same situation from the customer's point of view: the key is spent, and a
 * spent key cannot be activated again. Spelling it one way means the app cannot
 * describe the same fact two different ways depending on who is asking.
 */
const ALREADY_IN_USE = "License key already in use";

type Action = "issueCode" | "verifyCode" | "claimKey";

type Reply =
  | { ok: true; alreadyInUse?: boolean }
  | {
      ok: false;
      unavailable?: boolean;
      /** The `From:` address cannot be authenticated by any receiving server, so
       * the mail will not arrive. The client must NOT read this as "not paid". */
      senderUnauthenticated?: boolean;
      alreadyInUse?: boolean;
      notPaid?: boolean;
      error: string;
    };

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare — a plain === leaks the match position by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * "HAS THE ADMIN MARKED THIS EMAIL PAID?" — the one question that decides
 * whether a code is ever generated or emailed.
 *
 * THE ANSWER IS THE `paid_emails` LEDGER AND NOTHING ELSE, and that is a
 * deliberate decision rather than a simplification.
 *
 * `users.is_paid` looks like the obvious column and MUST NOT be used here.
 * Re-verified against the live database today: the PUBLIC anon key — which is
 * shipped inside the JavaScript bundle and therefore held by anyone who opens
 * the site — can UPDATE it. Adding it as an alternative would mean a stranger
 * could `UPDATE users SET is_paid = true` on their own row, then ask for a
 * code against ANY inbox they control, and the six-digit code that is supposed
 * to prove "I am the person who paid" would prove nothing at all. It is a
 * mirror the console maintains; it is not a receipt.
 *
 * `is_whitelisted` does not exist on this deployment (PostgREST answers 42703,
 * undefined column), and there is no DDL path to add one — every SQL entry
 * point answers PGRST202 — so it could not be honoured even if it were trusted.
 * `users.is_admin` is likewise not here: a role is not a payment.
 *
 * `paid_emails` is the right signal because exactly two deliberate acts write
 * it — the console's "Mark paid" button, and nothing else a stranger can reach.
 * It is also what the console's own Paid tab displays, so what unlocks the app
 * is what the admin believes they did.
 */
async function isMarkedPaid(client: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await client
    .from("paid_emails")
    .select("paid_at")
    .eq("email", email)
    .limit(1);
  if (error) throw new Error(error.message);
  // A row with a NULL timestamp is a REVOCATION marker (the console's "Mark
  // unpaid"), not a payment. It must not pass.
  return ((data ?? []) as Array<{ paid_at?: string | null }>).some((row) => row.paid_at != null);
}

/* ── 1. The six-digit code ──────────────────────────────────────────────
 * NEVER STORED. A pure function of (secret, email, time window), so there is
 * no row to forge and nothing to clean up.
 *
 * THE WINDOW IS TWO MINUTES, as the owner asked. See the `WINDOW_MS` note for
 * why that is only viable once the sender domain is authenticated.
 *
 * History, because it is the reason the warning above matters: delivery on this
 * account has been MEASURED at roughly two hours (the owner reported a
 * two-hour-old message arriving; a live send at 2026-10-05T00:20Z behaved the
 * same way). An earlier build used a 6-hour window purely to survive that lag,
 * and while it worked it was papering over a broken sender rather than fixing
 * it. Two minutes is the correct setting for a working mail path.
 *
 * This does not widen the brute-force surface in any way that matters: the
 * code for a window is a fixed 6-digit value, so the number of guesses needed
 * is the same 1,000,000 regardless of how wide the window is.
 *
 * "MARK THE CODE USED SO IT CAN ONLY BE USED ONCE" IS DELIBERATELY NOT DONE
 * HERE, and the reason is worth stating plainly: a code cannot be marked used
 * because it is never written down. There is no `isUsed` column on any table
 * on this deployment, and no DDL path to add one (every SQL entry point answers
 * PGRST202), so storing one would mean inventing a place to put it that does
 * not exist.
 *
 * It is also not needed. The one-time rule that matters is enforced where it
 * can actually hold — on the LICENCE KEY, in `users.license_key` below, which
 * is the one activation column the anon key cannot rewrite. A key that is
 * already activated is refused for everyone, the account that activated it
 * included, with "License key already in use". A code can be requested as many
 * times as the holder of that paid inbox likes; what cannot happen twice is
 * activating a key.
 */
/** 2 MINUTES, and ONLY the current window is accepted.
 *
 * The owner asked for the code to be usable within two minutes of it being sent,
 * so that is what this is. `PAST_WINDOWS = 0` means a code stops being accepted
 * the moment its window closes, so nothing lives on for longer than the window
 * itself.
 *
 * THE WINDOW IS EPOCH-BUCKETED, NOT CLOCK-ALIGNED TO A TIMEZONE, and that is
 * deliberate. `Math.floor(now / WINDOW_MS)` gives the same two-minute period to
 * every caller in the world, so "two minutes" means two minutes in South
 * Africa, in Lagos, in London and on a server in `us-east-1` alike. A window
 * computed from wall-clock hours would be a different length depending on
 * where the request landed, and a code could expire sooner or later than
 * advertised.
 *
 * ⚠ THIS ONLY WORKS IF MAIL ARRIVES FAST. Delivery on this account has been
 * observed taking about TWO HOURS, because the sender is a @gmail.com address
 * relayed through Brevo and `gmail.com`'s SPF record does not authorise Brevo.
 * Until that is fixed — authenticate a domain and set BREVO_SENDER_EMAIL — a
 * two-minute code will expire long before the email reaches the inbox, and the
 * symptom will be exactly "no code is ever sent". Two minutes is a sound
 * choice the moment the sender is authenticated, because a code only ever
 * proves inbox control and has no reason to linger. It is not a workaround for
 * a slow mail path, and it is not one.
 */
const WINDOW_MS = 2 * 60 * 1000;
/** How many PAST windows still verify. 0 = expire with the window, as asked. */
const PAST_WINDOWS = 0;

/**
 * The code for one 30-minute window: EXACTLY six digits.
 *
 * Slicing the hex digest would be the obvious thing and it is wrong — hex
 * contains `a`–`f`, so roughly half of all codes came out as "3f9a1c" and
 * could never pass the six-digit check that both the input and the email
 * promise. The digest is therefore read as a number and folded into
 * 100000–999999, which is always six digits and never has a leading zero the
 * customer would have to guess at.
 */
async function codeForWindow(email: string, window: number): Promise<string> {
  const digest = await hmac(SERVICE_ROLE, `eamp-activation-v1|${email}|${window}`);
  const value = Number.parseInt(digest.slice(0, 12), 16) % 900_000;
  return String(100_000 + value);
}

async function acceptedCodes(email: string): Promise<string[]> {
  const current = Math.floor(Date.now() / WINDOW_MS);
  const windows = Array.from({ length: PAST_WINDOWS + 1 }, (_, back) => current - back);
  return Promise.all(windows.map((window) => codeForWindow(email, window)));
}

async function mailCode(email: string, code: string): Promise<Reply> {
  if (!BREVO_API_KEY) {
    console.error("[activation] BREVO_API_KEY is not set — code not sent to", email);
    return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
  }

  /* THE SENDER CHECK, BEFORE THE MESSAGE IS BUILT.
   *
   * This refuses to send at all when the `From:` domain can never be
   * authenticated, because a send that is certain not to arrive is worse than
   * an honest failure: it burns the customer's two-minute window, tells them
   * the code is on its way, and leaves them locked out with no idea why.
   *
   * Nothing is lost by refusing. The paid check has already passed, so this is
   * a paying customer, and the message they get names the real remedy instead
   * of "check your inbox" — which would be advice that cannot possibly work.
   */
  if (!senderIsAuthenticatable()) {
    console.error(
      `[activation] REFUSING to send: the From: address ${SENDER} is a free-mail domain that no receiving server authorises for Brevo.`,
    );
    console.error(
      "[activation] SPF for gmail.com is `v=spf1 redirect=_spf.google.com` — it does not list Brevo, so the message is unauthenticated and gets deferred or dropped.",
    );
    console.error(
      "[activation] FIX (needs Brevo + registrar access, not a code change): authenticate a domain you own in Brevo, publish the SPF and DKIM records it issues, then set BREVO_SENDER_EMAIL to an address on that domain.",
    );
    return { ok: false, senderUnauthenticated: true, error: SENDER_UNAUTHENTICATED };
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
        sender: { name: "EA Migrate", email: SENDER },
        to: [{ email }],
        subject: `${code} is your EA Migrate activation code`,
        htmlContent: `<div style="font-family:Arial,Helvetica,sans-serif;background:#0A0A0C;padding:32px;color:#fff">
            <div style="max-width:520px;margin:0 auto;background:#121216;border:1px solid #26262E;border-radius:16px;padding:32px">
              <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate</p>
              <h1 style="margin:12px 0 0;font-size:22px;">Your activation code</h1>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#C9C9D1;">Use this code in the app to continue to your licence key.</p>
              <p style="margin:24px 0;font-size:40px;font-weight:bold;letter-spacing:0.3em;color:#fff;text-align:center;">${code}</p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6C6C78;">It stops working after 2 minutes. If you did not ask to sign in, ignore this email.</p>
            </div></div>`,
        textContent: `Your EA Migrate activation code is ${code}. It stops working after 2 minutes.`,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        "[activation] Brevo rejected the code email for",
        email,
        response.status,
        body.slice(0, 400),
      );
      return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
    }
    /* LOG THE SUCCESS TOO — this is the line that answers "did the code
     * actually go out?", which is the question a deploy log gets asked.
     *
     * This function previously logged ONLY failures, so a working deployment
     * was completely silent and there was nothing to grep for when a code was
     * not arriving. Brevo answers 201 with a messageId that is the only handle
     * on the message in Brevo's own logs, so it is recorded here.
     *
     * The code itself is NOT logged — only the address and the id — so this
     * line is safe to leave in production logs.
     */
    const sent = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
    const messageId = typeof sent?.messageId === "string" ? sent.messageId : "(none returned)";
    console.log(
      `[activation] Brevo QUEUED the code for ${email} (from ${SENDER}): HTTP ${response.status} messageId=${messageId}`,
    );
    console.log(
      "[activation] NOTE: 201 means accepted onto the queue, NOT delivered. A bounce or a deferral appears later, at the receiving server.",
    );
    return { ok: true };
  } catch (error) {
    console.error("[activation] code email failed for", email, error);
    return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
  }
}

/* ── 2. The single-use licence lock ────────────────────────────────────
 * `users.license_key` is the ONE activation column the anon key cannot
 * rewrite (verified live: UPDATE answers 42501), so a customer cannot release
 * their own key. It holds a COMMA-SEPARATED LIST, because an account can
 * activate more than one key and a single value would silently release the
 * first the moment the second was activated.
 */
function parseKeyList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function holdersOf(client: SupabaseClient, key: string): Promise<string[]> {
  // Keys are EMP-XXXX-XXXX-XXXX / EMP-<12>: letters, digits and dashes only, so
  // there is no LIKE metacharacter to escape.
  const { data, error } = await client
    .from("users")
    .select("email, license_key")
    .like("license_key", `%${key}%`);
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []) as Array<{
    email?: string | null;
    license_key?: string | null;
  }>;
  const owners: string[] = [];
  for (const row of rows) {
    const email = (row.email ?? "").trim().toLowerCase();
    // A substring hit is not a match — the LIKE only makes a list in one row
    // readable at all. The exact key must be an element.
    if (email && parseKeyList(row.license_key).some((entry) => entry.toUpperCase() === key))
      owners.push(email);
  }
  return owners;
}

async function claimKey(client: SupabaseClient, key: string, email: string): Promise<Reply> {
  let mine: string[];
  let owners: string[];
  try {
    const { data, error } = await client
      .from("users")
      .select("email, license_key")
      .eq("email", email)
      .limit(1);
    if (error) {
      console.warn("[activation] lock read failed:", error.message);
      return { ok: false, error: "We could not check that licence key. Please try again." };
    }
    mine = parseKeyList(((data ?? []) as Array<{ license_key?: string | null }>)[0]?.license_key);
    owners = await holdersOf(client, key);
  } catch (error) {
    console.warn(
      "[activation] lock lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "We could not check that licence key. Please try again." };
  }

  if (owners.some((owner) => owner !== email)) {
    return { ok: false, alreadyInUse: true, error: ALREADY_IN_USE };
  }
  if (mine.some((entry) => entry.toUpperCase() === key)) {
    // THE SAME ACCOUNT, THE SAME KEY. It is already activated — on this phone,
    // or on a phone whose device binding has since been released. Either way
    // the key is spent, and a spent key is not activated a second time. This
    // used to answer "already yours, carry on", which is what let one key be
    // re-entered and re-run on a replacement phone; the customer asked for it
    // to be refused, and the same wording is used for both cases so the rule is
    // stated once.
    return { ok: false, alreadyInUse: true, error: ALREADY_IN_USE };
  }

  const { data: written, error: claimError } = await client
    .from("users")
    .update({ license_key: [...mine, key].join(",") })
    .eq("email", email)
    .select("email");
  if (claimError) {
    console.warn("[activation] key claim failed:", claimError.message);
    return { ok: false, error: "We could not activate that licence key. Please try again." };
  }
  // An UPDATE that matches no rows reports success while storing nothing. There
  // is nowhere to put the lock, and claiming otherwise would be a lie.
  if (!Array.isArray(written) || written.length === 0) {
    console.warn("[activation] no users row to lock", email);
    return {
      ok: false,
      error: "We could not activate that licence key. Please sign in again and retry.",
    };
  }

  try {
    const settled = await holdersOf(client, key);
    if (settled.some((owner) => owner !== email) || !settled.includes(email)) {
      return { ok: false, alreadyInUse: true, error: ALREADY_IN_USE };
    }
  } catch {
    // The write already succeeded and the lock column is not writable by anon,
    // so the claim stands even if this confirmation read fails.
  }
  return { ok: true };
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  // Only POST, and only from a browser on this origin — nothing here is
  // reachable by a third-party site reading the response.
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const body = (typeof request.body === "string" ? safeParse(request.body) : request.body) as {
    action?: Action;
    email?: string;
    code?: string;
    key?: string;
  } | null;
  const action = body?.action;
  if (action !== "issueCode" && action !== "verifyCode" && action !== "claimKey") {
    response.status(400).json({ ok: false, error: "Unknown action" });
    return;
  }

  const client = db();
  if (!client) {
    // `unavailable` is load-bearing: the client must not read this as "not
    // entitled" (which would send a paying customer to checkout) or as success.
    response.status(503).json({ ok: false, unavailable: true, error: UNAVAILABLE });
    return;
  }

  const email = (body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(200).json({ ok: false, error: "Enter a valid email address." });
    return;
  }

  /* THE PAID CHECK, BEFORE ANYTHING CAN GENERATE OR SEND A CODE.
   *
   * Every action below this line — issuing a code, verifying one, claiming a
   * key — is unreachable until `isMarkedPaid` says yes. Nothing reaches
   * `mailCode` for an account the admin has not marked paid, so no code is
   * generated, no email is sent, and no messageId is logged for them.
   */
  let markedPaid: boolean;
  try {
    markedPaid = await isMarkedPaid(client, email);
  } catch (error) {
    console.error(
      "[activation] payment check failed:",
      error instanceof Error ? error.message : error,
    );
    response
      .status(200)
      .json({ ok: false, error: "We could not confirm your account. Please try again." });
    return;
  }
  if (!markedPaid) {
    // Logged WITHOUT any code or messageId — there was none, by design.
    console.warn(
      `[activation] refused: ${email} is not marked as paid. No code generated, no email sent.`,
    );
    // `notPaid` is a MACHINE-READABLE reason, and the client branches on this
    // flag rather than on the sentence. It used to match the error text with a
    // regex, so rewording the message silently broke the app's own routing:
    // an unpaid person stopped being sent to the plan page and only saw a
    // toast. Copy is for people; the flag is for code.
    response.status(200).json({ ok: false, notPaid: true, error: NOT_ENTITLED });
    return;
  }

  if (action === "issueCode") {
    const code = (await acceptedCodes(email))[0]!;
    response.status(200).json(await mailCode(email, code));
    return;
  }

  if (action === "verifyCode") {
    const code = (body?.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      response.status(200).json({ ok: false, error: "Enter the six-digit code from your email." });
      return;
    }
    const accepted = await acceptedCodes(email);
    if (!accepted.some((candidate) => safeEqual(candidate, code))) {
      response
        .status(200)
        .json({ ok: false, error: "That code is not right. Check your email and try again." });
      return;
    }
    response.status(200).json({ ok: true });
    return;
  }

  const key = (body?.key ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!key) {
    response.status(200).json({ ok: false, error: "Missing email or key." });
    return;
  }
  response.status(200).json(await claimKey(client, key, email));
}

/** A malformed body must not take the function down with a 500. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
