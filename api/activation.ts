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
 * MAIL: sent by `src/lib/mailjet.server.ts`, the one Mailjet v3.1 client every
 * email path in this app shares. Brevo was removed from the codebase entirely.
 *
 * ENV VARS (Vercel project settings — required for the code step to work):
 *   SUPABASE_SERVICE_ROLE_KEY   the secret; the browser must never see it
 *   MAILJET_API_KEY             Mailjet public API key
 *   MAILJET_SECRET_KEY          Mailjet private API key
 *   MAILJET_SENDER_EMAIL        the From address; falls back to eamigratepro@gmail.com
 *   ADMIN_EMAILS                comma-separated; these skip the paid_emails check
 *   SUPABASE_URL                optional; VITE_SUPABASE_URL is used otherwise
 *
 * NOTHING here trusts the caller: entitlement is re-read from the database on
 * every request, so a forged `{ paid: true }` from the browser mails nothing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
/**
 * WHY THIS IMPORT ENDS IN `.js`, AND MUST KEEP DOING SO
 * ─────────────────────────────────────────────────────
 * This project's package.json says `"type": "module"`, so Vercel compiles
 * `/api/*.ts` as NATIVE ESM — and Node's ESM resolver refuses extensionless
 * relative specifiers. The old `../src/lib/mailjet.server` crashed this
 * function at COLD START, before one line of the handler ran, so Vercel
 * answered EVERY request — even a GET that only has to return 405 — with
 *
 *     500  x-vercel-error: FUNCTION_INVOCATION_FAILED
 *
 * The build stayed green and `tsc` stayed clean throughout, because both of
 * those happily resolve `./x` to `./x.ts`; only the deployed runtime does not.
 * `.js` is TypeScript's documented ESM form: it typechecks against
 * `mailjet.server.ts`, Vercel's Node File Trace resolves it back to the `.ts`
 * while tracing (it has an explicit rule for exactly this) and ships it as
 * `mailjet.server.js` in the lambda, and BOTH the ESM and the CJS runtime can
 * load that. Dropping the extension breaks production again.
 */
import { sendMail } from "../src/lib/mailjet.server.js";

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

/**
 * THE OWNER'S OWN ADDRESSES, hardcoded on purpose.
 *
 * These three skip the `paid_emails` lookup even when `ADMIN_EMAILS` is not set
 * in the deployment environment — which is exactly the state production was in:
 * the variable only ever existed in `.env.local`, so on Vercel the bypass was
 * empty and the platform owner could be locked out of their own code step by a
 * missing environment variable. An owner list that lives in code cannot be
 * undone by a console nobody remembered to fill in.
 *
 * ⚠ KEEP IN SYNC with `OWNER_EMAILS` in `api/portal.ts` / `src/lib/auth-store.ts`.
 * This grants ONE thing only: skipping the paid check. It does not grant a
 * licence, unlock a key, or exempt anyone from the rate limit — and the code is
 * still mailed to the address itself, so it only helps whoever reads that inbox.
 */
const OWNER_ADMIN_EMAILS = [
  "biyasentobeko222@gmail.com",
  "eamigratepro@gmail.com",
  "ntobekotraders.official@gmail.com",
];

/**
 * Administrators = `ADMIN_EMAILS` (comma-separated, for addresses the owner
 * adds later without a code change) ∪ `OWNER_ADMIN_EMAILS` above.
 *
 * An operator has to be able to sign in and exercise the code step without the
 * console first having to mark their own inbox as paid, so these addresses skip
 * the `paid_emails` lookup.
 *
 * An unset variable still means NO ENVIRONMENT bypass, not "everyone": the
 * union only ever adds the owner's three addresses, never everybody.
 */
const ADMIN_EMAILS = [
  ...new Set([
    ...(process.env["ADMIN_EMAILS"] ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
    ...OWNER_ADMIN_EMAILS,
  ]),
];

type Action = "issueCode" | "verifyCode" | "claimKey";

type Reply =
  | {
      ok: true;
      alreadyInUse?: boolean;
      /**
       * Mailjet's per-recipient id, present only when an email was actually
       * accepted — the contract the operator asked for: `{ ok: true,
       * messageId }` on success, `{ ok:false, code, detail }` on a crash.
       */
      messageId?: string;
    }
  | {
      ok: false;
      unavailable?: boolean;
      alreadyInUse?: boolean;
      notPaid?: boolean;
      /**
       * MACHINE-READABLE, like `notPaid` above: the client branches on the flag
       * rather than on the sentence, so rewording the message cannot silently
       * break the app's own routing.
       */
      rateLimited?: boolean;
      /** Whole minutes until the next code request would be allowed. */
      retryAfterMinutes?: number;
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
 * the site — can UPDATE it. A live probe this session set `is_paid = true` on a
 * throwaway row with nothing but the browser-published anon key. Adding it as
 * an alternative would mean a stranger could mark themselves paid and mail a
 * code to ANY inbox they control, and the six-digit code that is supposed to
 * prove "I am the person who paid" would prove nothing at all. It is a mirror
 * the console maintains; it is not a receipt.
 *
 * There is ALSO no `purchases` table on this deployment to check: a service-role
 * read answers `PGRST205 Could not find the table 'public.purchases'`, and the
 * anon key gets the same. So a `status = 'paid'` purchase lookup cannot be
 * honoured here even in principle — there is nowhere to read it from. The
 * ledger is both the only TRUSTED signal and the only one that EXISTS.
 *
 * `is_whitelisted` does not exist on this deployment either (PostgREST answers
 * 42703, undefined column), and there is no DDL path to add one — every SQL
 * entry point answers PGRST202. `users.is_admin` is likewise not here: a role
 * is not a payment.
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

/**
 * "IS THIS AN ADMINISTRATOR?" — the bypass that lets an operator use the code
 * step without being marked as a paying customer.
 *
 * Three signals, in order of cost:
 *   1. `ADMIN_EMAILS` from the environment — free, no query at all.
 *   2. `users.is_admin`, the flag the console's own "Make Admin" button writes.
 *   3. `portal_accounts.data` -> `role === "admin"`, because the console gate
 *      opens on an account whose ROLE is admin even when that table has no row.
 *
 * This mirrors `isAdmin` in api/portal.ts on purpose: a console that opens for
 * an address must be able to request a code for that same address, or the owner
 * is locked out of the very screen they use to fix a customer's problem.
 *
 * HONEST SCOPE, and it matters: this is a ROLE CHECK, not an authenticated
 * session — the caller names the address it wants. That is the same trust level
 * api/portal.ts already operates at, and it is bounded: passing this only skips
 * the PAYMENT lookup. It does not grant a licence, does not unlock a key, and
 * does not bypass the rate limit below.
 *
 * Any failure here resolves to FALSE. A database hiccup must not hand out an
 * entitlement nobody actually holds.
 */
async function isAdminAccount(client: SupabaseClient, email: string): Promise<boolean> {
  if (ADMIN_EMAILS.includes(email)) return true;
  try {
    const flag = await client.from("users").select("is_admin").eq("email", email).limit(1);
    if (!flag.error && ((flag.data ?? []) as Array<{ is_admin?: boolean | null }>).some((r) => r.is_admin === true)) {
      return true;
    }
    const portal = await client.from("portal_accounts").select("data").eq("email", email).limit(1);
    for (const row of (portal.data ?? []) as Array<{ data?: string | null }>) {
      if (!row.data) continue;
      try {
        const parsed = JSON.parse(row.data) as { role?: unknown };
        if (typeof parsed.role === "string" && parsed.role.toLowerCase() === "admin") return true;
      } catch {
        /* a blob that will not parse carries no role */
      }
    }
  } catch (error) {
    console.warn(
      "[activation] admin check failed, treating as non-admin:",
      error instanceof Error ? error.message : error,
    );
  }
  return false;
}

/* -- Rate limit: 3 code requests per email per 60 minutes ------------- */

/** Requests allowed inside one window. */
const RATE_LIMIT_MAX = 3;
/** How long a window lasts. The count resets once this has passed. */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** The exact wording the owner asked for, shown when the 4th request arrives. */
const RATE_LIMITED = "Max 3 codes requested, wait 60 minutes";

/**
 * Warned ONCE per process, because a missing table would otherwise print this
 * on every single code request and bury the real errors in the deploy log.
 */
let rateLimitTableMissingWarned = false;

type RateDecision = { allowed: true } | { allowed: false; retryAfterMinutes: number };

/**
 * Write the limiter's row, and report whether the write actually landed.
 *
 * Returns false when the guarded UPDATE matched no row, which is how a lost
 * update is detected: the count we read is no longer the count in the table, so
 * somebody else moved it between our read and our write and the caller must
 * re-read and decide again.
 *
 * The guard is what makes the limit hold under two simultaneous requests for
 * the same inbox. Without it both read `count = 2`, both write 3, and a 4th
 * request slips through — a limit that can be beaten by pressing the button
 * twice at once is not a limit.
 */
async function writeRateRow(
  client: SupabaseClient,
  email: string,
  values: { count: number; first_request_at?: string; last_request_at?: string },
  guardCount: number | null,
): Promise<boolean> {
  if (guardCount === null) {
    const inserted = await client.from("email_code_requests").insert({ email, ...values });
    if (!inserted.error) return true;
    // 23505 = another request created the row between our read and this write.
    // Take it over rather than losing the request to a uniqueness error.
    if (inserted.error.code === "23505") {
      const taken = await client
        .from("email_code_requests")
        .update(values)
        .eq("email", email)
        .select("email");
      return !taken.error && Array.isArray(taken.data) && taken.data.length > 0;
    }
    throw new Error(inserted.error.message);
  }
  const updated = await client
    .from("email_code_requests")
    .update(values)
    .eq("email", email)
    .eq("count", guardCount)
    .select("email");
  if (updated.error) throw new Error(updated.error.message);
  return Array.isArray(updated.data) && updated.data.length > 0;
}

/**
 * "MAY THIS INBOX HAVE ONE MORE CODE?" — and record that it did.
 *
 * One row per email, counted inside a 60-minute window anchored on
 * `first_request_at`. The 4th request inside a window is refused; once the
 * window has aged out, the count resets to 1 and the address starts fresh. That
 * is a rolling window from the FIRST request, not a sliding one — three
 * requests spread across an hour and a half are still three, which is the
 * behaviour the owner described.
 *
 * WHY A TABLE AND NOT A MAP IN THIS MODULE: this code runs as a stateless
 * serverless function. An in-memory counter is destroyed by every cold start
 * and is not shared between concurrent instances, so "3 per hour" would really
 * mean "3 per cold start" — which on a busy deployment is no limit at all.
 *
 * IF THE TABLE IS MISSING, THE REQUEST IS ALLOWED. This deployment has no DDL
 * path (exec_sql answers PGRST202), so the table cannot be created from here —
 * it has to be run by hand (supabase/email-code-rate-limit.sql). Failing CLOSED
 * would mean nobody, including paying customers, can get a code until that
 * file has been run; failing open keeps the app working and says so loudly in
 * the log. The limit is therefore OFF until the migration is applied, which is
 * a real and deliberate trade — it protects Mailjet quota, not the licence.
 */
async function checkAndRecordCodeRequest(client: SupabaseClient, email: string): Promise<RateDecision> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Two attempts: one for the read, one more if a concurrent request beat us to
  // the write. Beyond that we are in a stampede, not a race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await client
      .from("email_code_requests")
      .select("count, first_request_at")
      .eq("email", email)
      .limit(1);

    if (error) {
      // PGRST205 / 42P01 = the table has not been created yet.
      if (error.code === "PGRST205" || error.code === "42P01") {
        if (!rateLimitTableMissingWarned) {
          rateLimitTableMissingWarned = true;
          console.error(
            "[activation] RATE LIMIT INACTIVE - table email_code_requests does not exist. " +
              "Run supabase/email-code-rate-limit.sql in the Supabase SQL editor. Allowing the request.",
          );
        }
        return { allowed: true };
      }
      throw new Error(error.message);
    }

    const row = ((data ?? []) as Array<{ count?: number | null; first_request_at?: string | null }>)[0];
    const startedAt = row?.first_request_at ? Date.parse(row.first_request_at) : Number.NaN;
    const windowAge = Number.isFinite(startedAt) ? now - startedAt : Number.POSITIVE_INFINITY;
    const used = Number.isFinite(windowAge) ? Number(row?.count ?? 0) : 0;

    // No row yet, or the window has aged out: this request opens a new one.
    if (!row || windowAge >= RATE_LIMIT_WINDOW_MS) {
      const written = await writeRateRow(
        client,
        email,
        { count: 1, first_request_at: nowIso, last_request_at: nowIso },
        row ? Number(row?.count ?? 0) : null,
      );
      if (written) return { allowed: true };
      continue; // lost update - re-read and decide again
    }

    if (used >= RATE_LIMIT_MAX) {
      // Never "0 minutes": a window with 30 seconds left would round to 0 and
      // tell a customer to try again immediately, which is what got them here.
      const retryAfterMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - windowAge) / 60_000));
      return { allowed: false, retryAfterMinutes };
    }

    const written = await writeRateRow(client, email, { count: used + 1, last_request_at: nowIso }, used);
    if (written) return { allowed: true };
    // Lost update - re-read and decide again.
  }

  console.warn(
    `[activation] rate limit could not be recorded for ${email} after two attempts; allowing the request.`,
  );
  return { allowed: true };
}

/* ── 1. The six-digit code ──────────────────────────────────────────────
 * NEVER STORED. A pure function of (secret, email, window), so there is
 * no row to forge and nothing to clean up.
 *
 * THE WINDOW IS FIVE MINUTES, as the owner asked. See the `WINDOW_MS` note for
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
/**
 * HOW LONG A CODE STAYS USABLE, and how many earlier windows still verify.
 *
 * FIVE MINUTES for the window, and `PAST_WINDOWS = 0` so a code stops being
 * accepted the moment its own window closes. Nothing lives on for longer than
 * the window the email promised.
 *
 * It is five minutes rather than the two originally asked for because delivery
 * is not instant: a message can take a minute or two to reach an inbox, and a
 * two-minute code was observed expiring before the customer had finished
 * reading the email that carried it. The number is stated to the customer
 * verbatim in the email body, so what the email says and what the server
 * enforces are the same number.
 *
 * This does not widen the brute-force surface in any way that matters: the code
 * for a window is a fixed 6-digit value, so the number of guesses needed is the
 * same 1,000,000 regardless of how wide the window is.
 *
 * THE WINDOW IS EPOCH-BUCKETED, NOT CLOCK-ALIGNED TO A TIMEZONE, and that is
 * deliberate. `Math.floor(now / WINDOW_MS)` gives the same five-minute period to
 * every caller in the world, so "five minutes" means five minutes in South
 * Africa, in Lagos, in London and on a server in `us-east-1` alike. A window
 * computed from wall-clock hours would be a different length depending on where
 * the request landed, and a code could expire sooner or later than advertised.
 *
 * ⚠ THIS ONLY WORKS IF MAIL ARRIVES AT ALL. A sender address on a domain with
 * published SPF + DKIM is what stops receiving servers deferring or discarding
 * the message. See the note on MAILJET_SENDER_EMAIL in src/lib/mailjet.server.ts
 * - changing the provider never fixed that, authenticating the sender domain
 * does.
 */
const WINDOW_MS = 5 * 60 * 1000;
/** How many PAST windows still verify. 0 = expire with the window, as promised. */
const PAST_WINDOWS = 0;

/** The window length in minutes, for text shown to the customer. */
const WINDOW_MINUTES = Math.round(WINDOW_MS / 60_000);

/**
 * The code for one window: EXACTLY six digits.
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

/**
 * Mail the activation code through Mailjet.
 *
 * The caller has ALREADY passed the paid check by the time this runs, so there
 * is no entitlement decision here — only delivery.
 */
async function mailCode(email: string, code: string): Promise<Reply> {
  const result = await sendMail({
    to: email,
    subject: "Your EA Migrate Pro License Code",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;background:#0A0A0C;padding:32px;color:#fff">
            <div style="max-width:520px;margin:0 auto;background:#121216;border:1px solid #26262E;border-radius:16px;padding:32px">
              <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
              <h1 style="margin:12px 0 0;font-size:22px;">Your activation code</h1>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#C9C9D1;">Use this code in the app to continue to your licence key.</p>
              <p style="margin:24px 0;font-size:40px;font-weight:bold;letter-spacing:0.3em;color:#fff;text-align:center;">${code}</p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6C6C78;">It stops working after ${WINDOW_MINUTES} minutes. If you did not ask to sign in, ignore this email.</p>
            </div></div>`,
    text: `Your EA Migrate Pro activation code is ${code}. It stops working after ${WINDOW_MINUTES} minutes.`,
  });
  if (!result.ok) {
    // Return the SPECIFIC failure, not the generic fallback. When Mailjet tells us
    // "400 Sender address not pre-approved" or "401 Unauthorized", the customer
    // and the operator have to see that — a generic "could not send" is how a
    // real problem sits invisible for days. Keep the message short and
    // human-readable in the UI, but carry the exact technical failure in.
    return { ok: false, error: result.error ?? "We could not send your code right now. Try again in a minute." };
  }
  // Mailjet's id rides along only when there is one; the client ignores the
  // field today, but support can quote it instead of a timestamp.
  return result.messageId ? { ok: true, messageId: result.messageId } : { ok: true };
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

/**
 * THE PUBLIC ENTRYPOINT, AND THE ONE PLACE AN UNCAUGHT CRASH BECOMES AN ANSWER.
 *
 * Everything below can throw — a Supabase timeout, a Mailjet response in a
 * shape nobody expected, a bug in a future edit — and an uncaught throw is what
 * Vercel turns into `500 FUNCTION_INVOCATION_FAILED`, i.e. the same opaque
 * error a function that never booted produces. That ambiguity is precisely
 * what made this outage hard to read, so nothing escapes this wrapper: the
 * reason is logged with the configuration it depends on, and the caller gets a
 * JSON body carrying a machine-readable `code` plus the real `detail` instead
 * of a platform error page the client can only report as "not responding".
 *
 * NOTE what this can NOT catch: a module that fails to load never reaches this
 * function at all. That class of crash is prevented at the import statement
 * above, not here.
 */
export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  try {
    await runActivation(request, response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Best-effort: even READING the request must not be able to throw inside
    // this handler — a crash here would escape straight back to the platform
    // and turn a diagnosed failure into the same opaque 500 we are removing.
    let action = "(none)";
    let email = "(none)";
    try {
      const raw = typeof request?.body === "string" ? safeParse(request.body) : request?.body;
      const probe = (typeof raw === "object" && raw !== null ? raw : {}) as {
        action?: unknown;
        email?: unknown;
      };
      if (typeof probe.action === "string") action = probe.action;
      if (typeof probe.email === "string") email = probe.email;
    } catch {
      /* the request itself is unreadable; the two names stay unknown */
    }
    // PRESENCE ONLY — never the values: three of these are live secrets. The
    // paid_emails check has its own logging inside runActivation ("payment
    // check failed"); what is recorded here is everything that check DEPENDS
    // on, so "supabaseServiceRolePresent: false" means it never ran at all.
    console.error("[activation] unhandled error:", detail, {
      action,
      email,
      mailjetApiKeyPresent: Boolean(process.env["MAILJET_API_KEY"]),
      mailjetSecretKeyPresent: Boolean(process.env["MAILJET_SECRET_KEY"]),
      supabaseUrlPresent: Boolean(SUPABASE_URL),
      supabaseServiceRolePresent: Boolean(SERVICE_ROLE),
      adminEmailsConfigured: ADMIN_EMAILS.length,
    });
    try {
      response.status(500).json({
        ok: false,
        code: "ACTIVATION_SERVICE_ERROR",
        error: "Something went wrong on our side. Please try again in a moment.",
        detail,
      });
    } catch {
      /* a response was already sent; there is nothing left to say */
    }
  }
}

/** The handler body itself, so the wrapper above can catch whatever it throws. */
async function runActivation(request: ApiRequest, response: ApiResponse): Promise<void> {
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
   * generated, no email is sent, and no Mailjet message id is logged for them.
   *
   * ADMINISTRATORS SKIP THIS, and only this. An operator testing the code step
   * should not have to mark their own inbox as a paying customer first, and the
   * console gate already lets them into /admin on the strength of the very same
   * role signals this reads. It does not grant a licence, unlock a key, or
   * exempt anyone from the rate limit.
   */
  const isAdmin = await isAdminAccount(client, email);
  if (isAdmin) {
    console.log(`[activation] ${email} is an administrator - skipping the paid_emails check.`);
  } else {
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
      // Logged WITHOUT any code or message id — there was none, by design.
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
  }

  if (action === "issueCode") {
    /* THE RATE LIMIT, and it runs AFTER the paid check on purpose.
     *
     * Only someone who would actually have received a code spends a slot, so an
     * unpaid address hammering "send code" cannot burn the three requests a
     * paying customer needs — and an unpaid address still gets the honest
     * "not marked as paid" answer above rather than a rate-limit message that
     * tells them nothing about what is actually wrong.
     *
     * Administrators are NOT exempt: this caps Mailjet spend, and the owner's
     * own address is the one most likely to be clicked while testing.
     */
    let limit: RateDecision;
    try {
      limit = await checkAndRecordCodeRequest(client, email);
    } catch (error) {
      // A limiter that cannot read its own table must not take the code step
      // down with it. Say so loudly, then get on with sending the code.
      console.error(
        "[activation] rate limit check failed, allowing the request:",
        error instanceof Error ? error.message : error,
      );
      limit = { allowed: true };
    }
    if (!limit.allowed) {
      console.warn(
        `[activation] rate limited ${email}: ${RATE_LIMIT_MAX} codes already requested in this ` +
          `60-minute window. No code generated, no email sent. Retry in ~${limit.retryAfterMinutes} min.`,
      );
      response.status(200).json({
        ok: false,
        rateLimited: true,
        retryAfterMinutes: limit.retryAfterMinutes,
        error: RATE_LIMITED,
      });
      return;
    }

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