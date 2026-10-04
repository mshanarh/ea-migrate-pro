/**
 * ACTIVATION — the two server-side records that decide whether a licence key
 * can be used, and the six-digit code that proves a paid person controls the
 * inbox they paid with.
 *
 * WHY THIS FILE IS SERVER-ONLY
 * ────────────────────────────
 * Both features here are security records, and the live database was probed
 * before this was written (scripts/probe-writes.ts, scripts/probe-insert.ts):
 *
 *   • EVERY table is readable by the PUBLIC anon key.
 *   • anon can UPDATE app_settings, license_keys, users.is_paid,
 *     users.device_id, mentor_approvals.status and paid_emails.paid_at.
 *   • anon can INSERT a users row carrying any license_key (or is_admin) it
 *     likes — the insert policy's `with check` is not enforced as written.
 *   • anon CANNOT UPDATE users.license_key (42501).
 *
 * That last line is the whole design. A six-digit code has one million
 * possibilities; a SHA-256 of one is brute-forceable in seconds by anyone
 * holding the anon key, which is a public constant baked into the app bundle.
 * So the code is never stored: it is derived, and the derivation needs a
 * secret that does not exist in the browser. Same reason the single-use lock
 * is written to `users.license_key` — the one activation column anon can
 * insert but never rewrite, so a customer cannot release their own key.
 *
 * The secret is SUPABASE_SERVICE_ROLE_KEY, read from the server environment
 * only. If it is missing, both features FAIL CLOSED (see issueActivationCode
 * and claimLicenseKey), because "we cannot check" must never read as "allowed".
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * HMAC-SHA256 over the server secret.
 *
 * Deliberately not a bare SHA-256 of the code: a plain hash is only as strong
 * as the code's own entropy, and the anon key can read whatever table the hash
 * is in, so an attacker could hash a million guesses offline. Keying the hash
 * with a secret that never leaves the server means a stolen row is useless
 * without it.
 */
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

type EmailInput = { email: string };

/**
 * Is this email entitled to hold an activation code?
 *
 * THIS IS THE `registerWithEmail` RULE, REPEATED SERVER-SIDE — a `paid_emails`
 * ledger row carrying a timestamp (the console's own "Mark paid"), or a
 * `license_keys` row issued to the address. It is re-implemented rather than
 * trusted from the client because the caller is the browser: a forged
 * `{ paid: true }` would mail a code to anybody.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   • `users.is_admin` — a role is not a receipt, and the anon key can insert
 *     a users row with any flag it likes. An admin who has been MARKED PAID
 *     passes on the ledger row above, which is the same thing the console's
 *     Paid tab shows and the only way the app opens for anyone, admins
 *     included.
 *   • `OWNER_EMAILS` / `isPaymentExemptEmail` — same reason. Payment is the
 *     only thing that opens this app.
 * An unentitled email is refused here, and the sign-in screen turns that
 * refusal into the Choose Plan screen, which is the required behaviour.
 */
async function isEntitled(client: SupabaseClient, email: string): Promise<boolean> {
  const { data: ledger, error: ledgerError } = await client
    .from("paid_emails")
    .select("paid_at")
    .eq("email", email)
    .limit(1);
  if (ledgerError) throw new Error(ledgerError.message);
  const ledgerRows = (Array.isArray(ledger) ? ledger : []) as Array<{ paid_at?: string | null }>;
  if (ledgerRows.some((row) => row.paid_at != null)) return true;
  // A licence key exists only because somebody paid for it, so the holder is
  // entitled. This also keeps the paying-but-not-yet-activated customer (key
  // emailed, no ledger row yet) off the checkout screen a second time.
  const { data: keys, error: keysError } = await client.from("license_keys").select("key").eq("email", email).limit(1);
  if (keysError) throw new Error(keysError.message);
  return Array.isArray(keys) && keys.length > 0;
}

/* ── 1. The six-digit activation code ───────────────────────────────────
 *
 * THE CODE IS NEVER STORED. It is a pure function of (secret, email, the
 * current 30-minute window), so there is no table to read, no row to forge and
 * nothing to clean up. Consequences worth stating plainly:
 *
 *   • Two codes issued in the same window are identical. Harmless — the code
 *     authorises activating YOUR OWN account, and it is bound to your email.
 *   • It expires on its own: the previous window is also accepted, so a code
 *     stays usable for at most 60 minutes, and never longer.
 *   • Resending costs nothing; there is nothing to resend.
 */

const CODE_WINDOW_MS = 30 * 60 * 1000;

/** The code for one specific 30-minute window. */
async function codeForWindow(email: string, secret: string, window: number): Promise<string> {
  return (await hmac(secret, `eamp-activation-v1|${email}|${window}`)).slice(0, 6);
}

/** Current window's code plus the one before it, so a code near a boundary works. */
async function acceptedCodes(email: string, secret: string): Promise<string[]> {
  const current = Math.floor(Date.now() / CODE_WINDOW_MS);
  return Promise.all([codeForWindow(email, secret, current), codeForWindow(email, secret, current - 1)]);
}

/**
 * Send the six-digit code to a PAID email.
 *
 * FAIL CLOSED on every path: no Supabase configuration, an unreachable
 * database, an unentitled email and a Brevo failure all refuse rather than
 * quietly hand out a working code. The client shows the plans screen for an
 * unentitled address, which is the behaviour that was asked for.
 */
export const issueActivationCode = createServerFn({ method: "POST" })
  .validator((data: EmailInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const client = db();
    if (!client) return { ok: false, error: "Activation is unavailable right now." };
    const email = data.email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };

    let entitled = false;
    try {
      entitled = await isEntitled(client, email);
    } catch (error) {
      console.warn("[activation] entitlement check failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "We could not confirm your account. Please try again." };
    }
    if (!entitled) return { ok: false, error: "This account has not been activated yet." };

    const code = (await acceptedCodes(email, SERVICE_ROLE))[0]!;
    const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
    const sender = (process.env["BREVO_SENDER_EMAIL"] ?? "eamigratepro@gmail.com").trim() || "eamigratepro@gmail.com";
    if (!apiKey) {
      console.error("[activation] BREVO_API_KEY is not set — code not sent to", email);
      return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
    }
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          sender: { name: "EA Migrate", email: sender },
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
        console.error("[activation] Brevo rejected the code email for", email, response.status, (await response.text().catch(() => "")).slice(0, 200));
        return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
      }
      return { ok: true };
    } catch (error) {
      console.error("[activation] code email failed for", email, error);
      return { ok: false, error: "We could not send your code. Message support on WhatsApp." };
    }
  });

/**
 * Check a code the customer typed.
 *
 * Both current and previous window are accepted, and the entitlement is
 * re-checked here too: a code proves inbox control, but the account still has
 * to be paid. Verifying entitlement twice costs two indexed reads and means a
 * code mailed before an admin pressed "Mark unpaid" stops working immediately.
 */
export const verifyActivationCode = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const client = db();
    if (!client) return { ok: false, error: "Activation is unavailable right now." };
    const email = data.email?.trim().toLowerCase() ?? "";
    const code = (data.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) return { ok: false, error: "Enter the six-digit code from your email." };

    let entitled = false;
    try {
      entitled = await isEntitled(client, email);
    } catch {
      return { ok: false, error: "We could not confirm your account. Please try again." };
    }
    if (!entitled) return { ok: false, error: "This account has not been activated yet." };

    const accepted = await acceptedCodes(email, SERVICE_ROLE);
    if (!accepted.some((candidate) => safeEqual(candidate, code))) {
      return { ok: false, error: "That code is not right. Check your email and try again." };
    }
    return { ok: true };
  });

/* ── 2. The single-use licence key ──────────────────────────────────────
 *
 * `users.license_key` is the ONLY activation column the anon key cannot
 * rewrite (verified live: UPDATE returns 42501). It is written here with the
 * service role and read back the same way, so the lock cannot be lifted from
 * the browser.
 *
 * The rule the customer asked for: once a key has activated a phone, that same
 * key must never activate anything again — not on a second phone, not on a
 * reinstall, not after the local robot list was cleared. The device that
 * already holds it keeps working (it never re-reads this), which is what makes
 * the refusal safe to add.
 *
 * THE COLUMN HOLDS A COMMA-SEPARATED LIST, not one key. An account can
 * legitimately activate more than one key (the admin sets a per-account
 * allowance), and a single value would silently release the first key the
 * moment the second was activated — the exact failure this feature exists to
 * prevent. The anon key cannot rewrite the column, so the list cannot be
 * trimmed from the browser either. Rows written before this file existed hold
 * a single key, which parses to a one-element list.
 */

/** The one message the customer is shown when the key is already claimed. */
const ALREADY_IN_USE = "This licence key is already in use.";

function parseKeyList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Every account that has ever activated `key`, read from the lock column. */
async function holdersOf(client: SupabaseClient, key: string): Promise<string[]> {
  // Keys are EMP-XXXX-XXXX-XXXX / EMP-<12>: letters, digits and dashes only,
  // so there is no LIKE metacharacter to escape in this pattern.
  const { data, error } = await client.from("users").select("email, license_key").like("license_key", `%${key}%`);
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []) as Array<{ email?: string | null; license_key?: string | null }>;
  const owners: string[] = [];
  for (const row of rows) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email) continue;
    // A substring hit is not a match — the LIKE is only there so the list in
    // one row can be read at all. The exact key must be an element.
    if (parseKeyList(row.license_key).some((entry) => entry.toUpperCase() === key)) owners.push(email);
  }
  return owners;
}

type ClaimInput = { key: string; email: string };

export const claimLicenseKey = createServerFn({ method: "POST" })
  .validator((data: ClaimInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; alreadyInUse?: boolean; error?: string }> => {
    const client = db();
    if (!client) return { ok: false, error: "Activation is unavailable right now." };
    const key = (data.key ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const email = (data.email ?? "").trim().toLowerCase();
    if (!key || !email) return { ok: false, error: "Missing email or key." };

    let mine: string[] = [];
    let owners: string[];
    try {
      const { data: rows, error: readError } = await client
        .from("users")
        .select("email, license_key")
        .eq("email", email)
        .limit(1);
      if (readError) {
        console.warn("[activation] lock read failed:", readError.message);
        return { ok: false, error: "We could not check that licence key. Please try again." };
      }
      mine = parseKeyList(((rows ?? []) as Array<{ license_key?: string | null }>)[0]?.license_key);
      owners = await holdersOf(client, key);
    } catch (error) {
      console.warn("[activation] lock lookup failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "We could not check that licence key. Please try again." };
    }

    const others = owners.filter((owner) => owner !== email);
    if (others.length > 0) {
      // Somebody else's account already activated this exact key. This is the
      // refusal the customer asked for, and it is the answer the app shows.
      return { ok: false, alreadyInUse: true, error: ALREADY_IN_USE };
    }
    if (mine.some((entry) => entry.toUpperCase() === key)) {
      // This account already holds the key — the phone that owns it is
      // activated. Re-entering it there is a no-op, not a new activation, so
      // it must NOT be refused.
      return { ok: true, alreadyInUse: true };
    }

    // Append rather than replace: a second key must never release the first.
    const next = [...mine, key];
    const { data: written, error: claimError } = await client
      .from("users")
      .update({ license_key: next.join(",") })
      .eq("email", email)
      .select("email");
    if (claimError) {
      console.warn("[activation] key claim failed:", claimError.message);
      return { ok: false, error: "We could not activate that licence key. Please try again." };
    }
    // An UPDATE that matches no rows is a SILENT no-op — it reports success
    // while storing nothing. The account has no `users` row (a reinstall whose
    // registration write failed), so there is nowhere to put the lock; saying
    // "already in use" here would be a lie and "activated" would be worse.
    if (!Array.isArray(written) || written.length === 0) {
      console.warn("[activation] no users row to lock", email);
      return { ok: false, error: "We could not activate that licence key. Please sign in again and retry." };
    }

    // Re-read to settle a race: if somebody else wrote the same key between our
    // read and our write, the key is not ours and we must say so rather than
    // report a success that did not happen.
    let settled: string[] = [];
    try {
      settled = await holdersOf(client, key);
    } catch {
      // The write already succeeded and the lock column is not writable by
      // anon, so the claim stands even if this confirmation read fails.
      return { ok: true };
    }
    const foreign = settled.filter((owner) => owner !== email);
    if (foreign.length > 0 || !settled.includes(email)) {
      return { ok: false, alreadyInUse: true, error: ALREADY_IN_USE };
    }
    return { ok: true };
  });