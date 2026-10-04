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
const SENDER = (process.env["BREVO_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim() || "eamigratepro@gmail.com";

/** Told apart from "not entitled" and "key taken" by the client. */
const UNAVAILABLE = "Activation is unavailable right now.";
const NOT_ENTITLED = "This account has not been activated yet.";
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
  | { ok: false; unavailable?: boolean; alreadyInUse?: boolean; error: string };

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
 * THE SAME RULE `registerWithEmail` APPLIES: a `paid_emails` ledger row
 * carrying a timestamp (the console's own "Mark paid"), or a `license_keys` row
 * issued to the address.
 *
 * `users.is_admin` is deliberately NOT here — a role is not a receipt, and the
 * anon key can insert a users row with any flag it likes. An admin who has been
 * MARKED PAID passes on the ledger row, which is the same thing the console's
 * Paid tab shows and the only way the app opens for anybody.
 */
async function isEntitled(client: SupabaseClient, email: string): Promise<boolean> {
  const { data: ledger, error: ledgerError } = await client.from("paid_emails").select("paid_at").eq("email", email).limit(1);
  if (ledgerError) throw new Error(ledgerError.message);
  if (((ledger ?? []) as Array<{ paid_at?: string | null }>).some((row) => row.paid_at != null)) return true;
  const { data: keys, error: keysError } = await client.from("license_keys").select("key").eq("email", email).limit(1);
  if (keysError) throw new Error(keysError.message);
  return Array.isArray(keys) && keys.length > 0;
}

/* ── 1. The six-digit code ──────────────────────────────────────────────
 * NEVER STORED. A pure function of (secret, email, 30-minute window), so
 * there is no row to forge and nothing to clean up. The previous window is
 * also accepted, so a code works for at most 60 minutes.
 */
const WINDOW_MS = 30 * 60 * 1000;

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
  return Promise.all([codeForWindow(email, current), codeForWindow(email, current - 1)]);
}

async function mailCode(email: string, code: string): Promise<Reply> {
  if (!BREVO_API_KEY) {
    console.error("[activation] BREVO_API_KEY is not set — code not sent to", email);
    return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "api-key": BREVO_API_KEY, "content-type": "application/json" },
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
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6C6C78;">It stops working after 60 minutes. If you did not ask to sign in, ignore this email.</p>
            </div></div>`,
        textContent: `Your EA Migrate activation code is ${code}. It expires in 60 minutes.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("[activation] Brevo rejected the code email for", email, response.status);
      return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
    }
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
  const { data, error } = await client.from("users").select("email, license_key").like("license_key", `%${key}%`);
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []) as Array<{ email?: string | null; license_key?: string | null }>;
  const owners: string[] = [];
  for (const row of rows) {
    const email = (row.email ?? "").trim().toLowerCase();
    // A substring hit is not a match — the LIKE only makes a list in one row
    // readable at all. The exact key must be an element.
    if (email && parseKeyList(row.license_key).some((entry) => entry.toUpperCase() === key)) owners.push(email);
  }
  return owners;
}

async function claimKey(client: SupabaseClient, key: string, email: string): Promise<Reply> {
  let mine: string[];
  let owners: string[];
  try {
    const { data, error } = await client.from("users").select("email, license_key").eq("email", email).limit(1);
    if (error) {
      console.warn("[activation] lock read failed:", error.message);
      return { ok: false, error: "We could not check that licence key. Please try again." };
    }
    mine = parseKeyList(((data ?? []) as Array<{ license_key?: string | null }>)[0]?.license_key);
    owners = await holdersOf(client, key);
  } catch (error) {
    console.warn("[activation] lock lookup failed:", error instanceof Error ? error.message : error);
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
    return { ok: false, error: "We could not activate that licence key. Please sign in again and retry." };
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

  const body = (typeof request.body === "string" ? safeParse(request.body) : request.body) as
    | { action?: Action; email?: string; code?: string; key?: string }
    | null;
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

  let entitled: boolean;
  try {
    entitled = await isEntitled(client, email);
  } catch (error) {
    console.error("[activation] entitlement check failed:", error instanceof Error ? error.message : error);
    response.status(200).json({ ok: false, error: "We could not confirm your account. Please try again." });
    return;
  }
  if (!entitled) {
    response.status(200).json({ ok: false, error: NOT_ENTITLED });
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
      response.status(200).json({ ok: false, error: "That code is not right. Check your email and try again." });
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