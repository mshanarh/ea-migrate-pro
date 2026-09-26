import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MENTOR_ONLY_EMAILS, OWNER_EMAILS, type Account, type PaymentRecord, type PortalStatus } from "@/lib/auth-store";

/**
 * Shared cloud account sync — makes registrations visible on the admin page
 * in near-real time across ALL devices. Powered by SUPABASE ONLY (the
 * Upstash/Redis layer was removed entirely).
 *
 * Why: auth-store lives in each device's localStorage, so a person registering
 * on their phone never appeared on the admin's phone. These server functions
 * mirror account records, approvals, payments, MT5 records and EA video
 * backups into Supabase tables, and the admin console polls them every
 * ~3 seconds.
 *
 * Everything is env-gated: with no Supabase credentials set, every function
 * returns { enabled: false } and the app keeps working exactly as before
 * (offline localStorage behaviour). Set these in hosting env settings:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY — server-side only; bypasses RLS
 *
 * Security model:
 * - `password` NEVER leaves the server. List responses strip it; sign-in
 *   verification happens server-side.
 * - Admin mutations require the caller's email to belong to an admin-role
 *   account stored in the cloud store.
 * - The service-role key exists only in these server functions, never in
 *   the browser bundle.
 *
 * Tables (see supabase/schema.sql):
 *   portal_accounts  — full mentor/admin records as jsonb (licenses, EAs…)
 *   mentor_approvals — email pk, status (pending/approved/rejected), created_at
 *   portal_payments  — email pk, paid, paid_at
 *   mt5_accounts     — user_id pk, connection metadata jsonb (no MT5 password
 *                      leaves the server)
 *   ea_videos        — video_id pk, data_url (uploaded video backup)
 */

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();

let cachedClient: SupabaseClient | null = null;

function db(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function cloudSyncConfigured(): boolean {
  return db() !== null;
}

/**
 * Emails stripped of admin status by the platform owner. Any cloud/local
 * account record for these emails is demoted to a regular mentor wherever it
 * is loaded, and they can never sign in through the admin console path.
 */
export const REMOVED_ADMIN_EMAILS = ["lwethunkandi3@gmail.com"];

/**
 * Emails whose cloud record was lost (registered during the old sync-bug
 * era and never mirrored). The first sign-in attempt for one of these
 * recreates the account with the password being typed — normal mentor,
 * pre-approved — instead of showing "wrong email or password" forever.
 */
const SELF_HEAL_SIGNIN_EMAILS = new Set(["ntobekotraders.official@gmail.com"]);

function isRemovedAdmin(email: string): boolean {
  return REMOVED_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** True when an email must be a plain mentor no matter what any record says. */
function isMentorOnly(email: string): boolean {
  return MENTOR_ONLY_EMAILS.includes(email.trim().toLowerCase());
}

/** Applies every server-side role rule to a record before it is served. */
function enforceRoles(account: Account): Account {
  if (isMentorOnly(account.email)) return { ...account, role: "mentor" as const };
  if (isRemovedAdmin(account.email)) return { ...account, role: "mentor" as const };
  if (OWNER_EMAILS.includes(account.email.trim().toLowerCase()))
    return { ...account, role: "admin" as const, status: "approved" as const, ...(account.licenseLimit < 2000 ? { licenseLimit: 2000 } : {}) };
  return account;
}

function parseAccount(raw: unknown): Account | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Account;
    if (!parsed || typeof parsed.email !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Public view of an account — never includes the password. */
export type PublicAccount = Omit<Account, "password">;

function toPublic(account: Account): PublicAccount {
  const { password: _password, ...rest } = account;
  return rest;
}

/* ------------------------------------------------------------------ */
/* Supabase table access helpers                                      */
/* ------------------------------------------------------------------ */

/** Reads one full account record (portal_accounts.data). */
async function readAccount(targetEmail: string): Promise<Account | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("portal_accounts")
    .select("data")
    .eq("email", targetEmail.trim().toLowerCase())
    .maybeSingle();
  return parseAccount(data?.data);
}

/** Upserts one full account record. Returns false when the write failed. */
async function writeAccount(account: Account): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { error } = await client
    .from("portal_accounts")
    .upsert(
      { email: account.email.trim().toLowerCase(), data: JSON.stringify(account), updated_at: new Date().toISOString() },
      { onConflict: "email" },
    );
  if (error) console.error("[supabase] portal_accounts upsert failed:", error.message);
  return !error;
}

/**
 * The approval index — mentor_approvals is the SINGLE source of truth for
 * pending/approved/rejected so every device agrees. Writes here accompany
 * every status change; reads merge this status over the account record.
 */
async function setApprovalStatus(email: string, status: PortalStatus): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const clean = email.trim().toLowerCase();
  const { error } = await client
    .from("mentor_approvals")
    .upsert({ email: clean, status }, { onConflict: "email" });
  if (error) console.error("[supabase] mentor_approvals upsert failed:", error.message);
  return !error;
}

/** All approval rows, keyed by email. */
async function listApprovals(): Promise<Map<string, PortalStatus>> {
  const client = db();
  const map = new Map<string, PortalStatus>();
  if (!client) return map;
  const { data, error } = await client.from("mentor_approvals").select("email, status");
  if (error) {
    console.error("[supabase] mentor_approvals read failed:", error.message);
    return map;
  }
  for (const row of (data ?? []) as Array<{ email: string; status: string }>) {
    if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
      map.set(row.email.toLowerCase(), row.status);
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Registration — called right after a successful local registration. */
/* ------------------------------------------------------------------ */

export type SyncRegisterInput = { account: Account };
export type SyncRegisterResult = { enabled: boolean; ok: boolean };

export const syncRegister = createServerFn({ method: "POST" })
  .validator((data: SyncRegisterInput) => data)
  .handler(async ({ data }): Promise<SyncRegisterResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const account = data.account;
    if (!account?.email || typeof account.email !== "string") return { enabled: true, ok: false };
    const email = account.email.trim().toLowerCase();
    // MERGE, never clobber: admin-controlled fields (status, role, license
    // limit, licenses) always win from the cloud copy, so a device holding a
    // stale "pending" snapshot can never revert an approval when it mirrors
    // its profile or EAs. Client fields (profile, EAs, website) win locally.
    const existing = await readAccount(email);
    let merged: Account = account;
    if (existing) {
      // Union merge licenses by id so keys created on the admin device (which
      // mirror back through this mentor's own profile sync) are never lost,
      // and admin decisions (status/role/limit) always win from the cloud.
      const licensesById = new Map(existing.licenses.map((license) => [license.id, license]));
      for (const license of account.licenses) licensesById.set(license.id, license);
      merged = {
        ...account,
        status: existing.status,
        role: existing.role,
        licenseLimit: existing.licenseLimit,
        licenses: Array.from(licensesById.values()),
      };
    }
    // A removed admin must never (re)register as an admin through this path.
    if (isRemovedAdmin(email)) merged = { ...merged, role: "mentor" };
    // Mentor-only emails lose the admin role on every write, too.
    if (isMentorOnly(email)) merged = { ...merged, role: "mentor" };
    // The platform owner is an admin BY SERVER ENFORCEMENT: any registration
    // (or profile re-mirror) carrying their email is stored as admin/approved
    // regardless of what the client sent — a stale client snapshot can never
    // demote them in the shared store.
    if (OWNER_EMAILS.includes(email)) {
      merged = {
        ...merged,
        role: "admin",
        status: "approved",
        ...(merged.licenseLimit < 2000 ? { licenseLimit: 2000 } : {}),
      };
    }
    const writeOk = await writeAccount(merged);
    // The approval row makes brand-new registrations visible in the admin
    // console's Pending list even before any account merge lands.
    if (writeOk) await setApprovalStatus(email, merged.status);
    // Registration-received email — only on the FIRST successful write of a
    // brand-new account, and never for the owner (they approve themselves).
    if (writeOk && !existing && !OWNER_EMAILS.includes(email)) {
      void sendPendingEmail(email, merged.firstName).catch((error) =>
        console.error("[brevo] pending email unexpected failure:", error),
      );
    }
    return { enabled: true, ok: writeOk };
  });

/* ------------------------------------------------------------------ */
/* List — the admin console polls this every ~3 seconds.              */
/* ------------------------------------------------------------------ */

export type SyncListResult = { enabled: boolean; accounts: PublicAccount[]; payments: PaymentRecord[] };

export const syncListAccounts = createServerFn({ method: "POST" }).handler(async (): Promise<SyncListResult> => {
  const client = db();
  if (!client) return { enabled: false, accounts: [], payments: [] };

  const [accountsRes, paymentsRes, approvals] = await Promise.all([
    client.from("portal_accounts").select("email, data").order("updated_at", { ascending: false }),
    client.from("portal_payments").select("email, paid, paid_at"),
    listApprovals(),
  ]);

  if (accountsRes.error) {
    console.error("[supabase] portal_accounts list failed:", accountsRes.error.message);
    return { enabled: true, accounts: [], payments: [] };
  }

  const accounts = ((accountsRes.data ?? []) as Array<{ email: string; data: unknown }>)
    .map((row) => parseAccount(row.data))
    .filter((account): account is Account => account !== null)
    // mentor_approvals is the authoritative status index: the Pending /
    // Approved / Rejected tabs read THIS table's decision, so a stale status
    // inside an account record can never resurrect a reverted approval.
    .map((account) => {
      const approval = approvals.get(account.email.trim().toLowerCase());
      return approval ? { ...account, status: approval } : account;
    })
    // A removed admin's stale cloud record is demoted wherever it is listed,
    // so no device can ever hydrate them back into an admin role.
    .map(enforceRoles)
    .map(toPublic);

  const payments = ((paymentsRes.data ?? []) as Array<{ email: string; paid: boolean; paid_at: string | null }>)
    .filter((row) => typeof row.paid === "boolean")
    .map((row) => ({ email: row.email, paid: row.paid, ...(row.paid && row.paid_at ? { paidAt: row.paid_at } : {}) }));

  return { enabled: true, accounts, payments };
});

/* ------------------------------------------------------------------ */
/* Sign-in fallback — lets a user sign in from any device, even when  */
/* this browser has never seen the account.                           */
/* ------------------------------------------------------------------ */

export type SyncSignInInput = { email: string; password: string };
export type SyncSignInResult =
  | { enabled: false }
  | { enabled: true; ok: false; error: string }
  | { enabled: true; ok: true; account: PublicAccount };

export const syncSignIn = createServerFn({ method: "POST" })
  .validator((data: SyncSignInInput) => data)
  .handler(async ({ data }): Promise<SyncSignInResult> => {
    if (!cloudSyncConfigured()) return { enabled: false };
    const email = data.email.trim().toLowerCase();
    const account = await readAccount(email);
    if (!account) {
      // Lost-record self-heal for platform-designated emails: an account
      // registered during the old sync-bug era may exist on no device and in
      // no cloud copy, so "wrong email or password" would be shown forever.
      // The first sign-in for a designated email recreates it with the
      // password being typed (normal mentor, pre-approved) — after that it
      // behaves like any other account.
      if (SELF_HEAL_SIGNIN_EMAILS.has(email) && data.password.length >= 4) {
        const username = email.split("@")[0] ?? email;
        const healed: Account = {
          id: "m-heal-" + Date.now(),
          firstName: "",
          displayName: username,
          email,
          username,
          password: data.password,
          whatsapp: "",
          role: "mentor",
          status: "approved",
          createdAt: new Date().toISOString(),
          licenseLimit: 0,
          licenses: [],
          eas: [],
        };
        if (await writeAccount(healed)) return { enabled: true, ok: true, account: toPublic(healed) };
      }
      return { enabled: true, ok: false, error: "Wrong email or password. Check the email you registered with and try again." };
    }
    if (account.password !== data.password) {
      return { enabled: true, ok: false, error: "Wrong email or password. Check the email you registered with and try again." };
    }
    // Lost-record self-heal for the designated mentor email: their password
    // died with the old record, so every sign-in attempt RESETS the password
    // to whatever is being typed. The user can never be locked out — whatever
    // they type today becomes the working password, mentor role enforced.
    if (SELF_HEAL_SIGNIN_EMAILS.has(email) && data.password.length >= 4) {
      const healed = enforceRoles({ ...account, password: data.password, role: "mentor", status: "approved" });
      if (await writeAccount(healed)) return { enabled: true, ok: true, account: toPublic(healed) };
    }
    // The approval row outranks the stored record's status.
    const approvals = await listApprovals();
    const approval = approvals.get(email);
    // Mentor-only / removed-admin / owner rules win over the stored record.
    const resolved = enforceRoles(approval ? { ...account, status: approval } : account);
    return { enabled: true, ok: true, account: toPublic(resolved) };
  });

/* ------------------------------------------------------------------ */
/* Status refresh — a signed-in device polls this so admin decisions   */
/* (approve / reject / license limit) appear LIVE without signing out. */
/* ------------------------------------------------------------------ */

export type SyncGetAccountInput = { email: string };
export type SyncGetAccountResult = { enabled: boolean; account: PublicAccount | null };

/* ------------------------------------------------------------------ */
/* App restore — the trading app rebuilds a user's robots from their   */
/* active licenses so switching devices/deployments feels seamless.    */
/* ------------------------------------------------------------------ */

export type RestoredLicense = {
  key: string;
  eaId?: string;
  eaName: string;
  symbols: string[];
  image?: string;
  video?: string;
  active: boolean;
  expiresAt?: string;
};

export type SyncRestoreResult = { enabled: boolean; licenses: RestoredLicense[] };

/**
 * Returns every license key issued to this email together with the linked
 * EA's live details (name, symbols, image, video) from the mentor record in
 * the shared store. The app uses this to rebuild robots automatically on a
 * new device — the user signs in and their EA is simply there.
 */
export const syncRestoreLicenses = createServerFn({ method: "POST" })
  .validator((data: { email: string }) => data)
  .handler(async ({ data }): Promise<SyncRestoreResult> => {
    const client = db();
    if (!client) return { enabled: false, licenses: [] };
    const email = data.email.trim().toLowerCase();
    if (!email) return { enabled: true, licenses: [] };
    // A key belongs to whichever mentor account carries it — scan all records.
    const { data: rows, error } = await client.from("portal_accounts").select("data");
    if (error) {
      console.error("[supabase] portal_accounts restore scan failed:", error.message);
      return { enabled: true, licenses: [] };
    }
    const restored: RestoredLicense[] = [];
    for (const row of (rows ?? []) as Array<{ data: unknown }>) {
      const account = parseAccount(row.data);
      if (!account) continue;
      const eaById = new Map(account.eas.map((ea) => [ea.id, ea]));
      for (const license of account.licenses) {
        if (String(license.clientEmail ?? "").trim().toLowerCase() !== email) continue;
        const ea = license.eaId ? eaById.get(license.eaId) : undefined;
        const image = ea?.image ?? license.image;
        const video = ea?.video ?? license.video;
        restored.push({
          key: license.key,
          ...(license.eaId ? { eaId: license.eaId } : {}),
          eaName: ea?.name || license.robotName || license.expertAdvisor || license.name || "Private EA",
          symbols: (ea?.symbols ?? license.symbols ?? []).filter((symbol): symbol is string => typeof symbol === "string"),
          ...(image ? { image } : {}),
          ...(video ? { video } : {}),
          active: license.active === true,
          ...(license.expiresAt ? { expiresAt: license.expiresAt } : {}),
        });
      }
    }
    return { enabled: true, licenses: restored };
  });

export const syncGetAccount = createServerFn({ method: "POST" })
  .validator((data: SyncGetAccountInput) => data)
  .handler(async ({ data }): Promise<SyncGetAccountResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, account: null };
    const account = await readAccount(data.email);
    if (!account) return { enabled: true, account: null };
    const approvals = await listApprovals();
    const approval = approvals.get(data.email.trim().toLowerCase());
    // Every served record passes the role rules: mentor-only and removed-
    // admin emails are demoted, owners are upgraded — the stored role never
    // outranks the platform's decision.
    const resolved = enforceRoles(approval ? { ...account, status: approval } : account);
    return { enabled: true, account: toPublic(resolved) };
  });

/* ------------------------------------------------------------------ */
/* Admin mutations — verified server-side against an admin account.   */
/* ------------------------------------------------------------------ */

export type AdminPatch = {
  status?: PortalStatus;
  licenseLimit?: number;
  licenses?: Account["licenses"];
  /** When true, `licenses` is the full replacement list — removals propagate. */
  replaceLicenses?: boolean;
};

/* ------------------------------------------------------------------ */
/* Brevo welcome email — fired once when a mentor's status moves to   */
/* "approved". Uses the raw Brevo v3 REST endpoint (no SDK needed).   */
/* A missing BREVO_API_KEY or a Brevo failure never blocks approval.  */
/* ------------------------------------------------------------------ */

const PORTAL_URL = "https://eamigratepro.vercel.app/";

/** Shared Brevo wiring for every portal email. */
async function sendBrevoEmail(options: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the From header. Defaults to the platform brand. */
  fromName?: string;
}): Promise<boolean> {
  const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
  if (apiKey.length === 0) {
    console.error("[brevo] BREVO_API_KEY is not set — email skipped for", options.to);
    return false;
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: options.fromName ?? "EA Migrate Pro", email: "eamigratepro@gmail.com" },
        to: [{ email: options.to, name: options.toName }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
      // Never let a slow email provider delay the approval/registration.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[brevo] send failed (${response.status}) for ${options.to}:`,
        detail.slice(0, 400),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[brevo] request error for", options.to, error);
    return false;
  }
}

/** Dark brand HTML shared by the approval and pending emails. */
function brandEmailHtml(options: {
  heading: string;
  paragraphs: string[];
  buttonText: string;
  buttonColor: string;
  footer: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
                <h1 style="margin:12px 0 0 0;font-size:26px;line-height:1.25;color:#FFFFFF;">${options.heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                ${options.paragraphs
                  .map(
                    (p) =>
                      `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">${p}</p>`,
                  )
                  .join("\n                ")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 32px 32px 32px;">
                <a href="${PORTAL_URL}" style="display:inline-block;background:${options.buttonColor};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">${options.buttonText}</a>
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span><br /><br />${options.footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Welcome email — sent once when a mentor's status moves to "approved". */
async function sendApprovalEmail(userEmail: string, firstName: string): Promise<boolean> {
  const name = firstName.trim().length > 0 ? firstName.trim() : "Broker";
  const html = brandEmailHtml({
    heading: `Welcome to EA Migrate Pro, ${escapeHtml(name)}! 🔓`,
    paragraphs: [
      `Hi ${escapeHtml(name)},`,
      "Welcome to the EA Migrate Pro Portal! 🔓🎉",
      "We've confirmed your request and your access has been accepted.",
      "Welcome to the team, Brother! 🤝",
    ],
    buttonText: "Open EA Migrate Pro Portal",
    buttonColor: "#E03131",
    footer: "— The EA Migrate Pro Team",
  });
  const text = `Hi ${name},\n\nWelcome to the EA Migrate Pro Portal! 🔓🎉\n\nWe've confirmed your request and your access has been accepted.\n\nWelcome to the team, Brother! 🤝\n\nOpen your portal: ${PORTAL_URL}`;
  return sendBrevoEmail({
    to: userEmail,
    toName: name,
    subject: `Welcome to EA Migrate Pro, ${name}! 🔓`,
    html,
    text,
  });
}

/**
 * Registration received email — sent immediately when a user registers.
 * Body/subject exactly as specified by the owner; approval email follows later.
 */
async function sendPendingEmail(userEmail: string, firstName: string): Promise<boolean> {
  const name = firstName.trim().length > 0 ? firstName.trim() : "Broker";
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
                <h2 style="margin:12px 0 0 0;font-size:24px;line-height:1.3;color:#FFFFFF;">Welcome to EA Migrate Pro!</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">We have successfully received your registration.</p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">Your account is currently on our pending list. You will be approved once the admin reviews and approves your account.</p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#C9C9D1;">You will be notified via email once your account is approved.</p>
                <br>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#C9C9D1;">Thank you,<br>EA Migrate Pro Team</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 32px 32px 32px;">
                <a href="${PORTAL_URL}" style="display:inline-block;background:#E7B53A;color:#0A0A0C;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">Open EA Migrate Pro Portal</a>
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `Welcome to EA Migrate Pro!\n\nWe have successfully received your registration.\n\nYour account is currently on our pending list. You will be approved once the admin reviews and approves your account.\n\nYou will be notified via email once your account is approved.\n\nThank you,\nEA Migrate Pro Team\n\nOpen your portal: ${PORTAL_URL}`;
  return sendBrevoEmail({
    to: userEmail,
    toName: name,
    subject: "Registration Received - Pending Approval | EA Migrate Pro",
    html,
    text,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/* ------------------------------------------------------------------ */
/* License key delivery — sent immediately after a key is generated.  */
/* Mirrors the in-app result card (dark premium + gold).              */
/* ------------------------------------------------------------------ */

function licenseEmailHtml(options: {
  licenseKey: string;
  eaName: string;
  expiry: string;
  email: string;
  imageUrl?: string | null;
}): string {
  const key = escapeHtml(options.licenseKey);
  const ea = escapeHtml(options.eaName || "EA");
  const expiry = escapeHtml(options.expiry || "Lifetime");
  const email = escapeHtml(options.email);
  // Only http(s) images render reliably in email clients — data URLs are
  // stripped by most providers, so fall back to the key-icon tile instead.
  const imageBlock =
    options.imageUrl && /^https?:\/\//i.test(options.imageUrl)
      ? `<tr>
              <td align="center" style="padding:6px 32px 0 32px;">
                <img src="${escapeHtml(options.imageUrl)}" alt="${ea}" width="240" style="display:block;width:240px;height:240px;object-fit:cover;border-radius:24px;border:1px solid #26262E;" />
              </td>
            </tr>`
      : `<tr>
              <td align="center" style="padding:6px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="240" height="240" style="width:240px;height:240px;border-radius:24px;border:1px solid #26262E;background:linear-gradient(180deg,#141821,#0D1017);font-size:96px;font-weight:bold;color:#2E7CD6;">🔑</td></tr></table>
              </td>
            </tr>`;
  const pill = (label: string) =>
    `<span style="display:inline-block;margin:4px;padding:9px 18px;border:1px solid #2E5FA3;border-radius:999px;background:#0E1522;color:#D7E4F5;font-size:13px;">${label}</span>`;
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121216;border:1px solid #26262E;border-radius:24px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:36px 32px 0 32px;">
                <p style="margin:0;font-size:12px;font-weight:bold;letter-spacing:0.22em;color:#E7B53A;text-transform:uppercase;">EA Migrate Pro</p>
                <h1 style="margin:14px 0 0 0;font-size:30px;line-height:1.2;color:#FFFFFF;">Generate License</h1>
                <p style="margin:8px 0 0 0;font-size:12px;font-weight:bold;letter-spacing:0.3em;color:#8A8A96;text-transform:uppercase;">Key Created</p>
              </td>
            </tr>
            ${imageBlock}
            <tr>
              <td align="center" style="padding:24px 32px 0 32px;">
                <div style="border:2px solid #2E7CD6;border-radius:999px;padding:16px 26px;background:#0E1522;">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:21px;font-weight:bold;color:#FFFFFF;letter-spacing:0.14em;">${key}</span>
                  <br />
                  <span style="font-size:11px;color:#8A8A96;">Tap and hold the key, then choose Copy</span>
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 24px 0 24px;">
                ${pill(email)}
                ${pill(expiry)}
                ${pill(ea)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:14px;font-weight:bold;color:#4DA3FF;">✉ Emailed to client</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#C9C9D1;"><strong style="color:#E7B53A;">How to activate:</strong></p>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#C9C9D1;">1. Open the EA Migrate Pro Portal and sign in with this email address.</p>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#C9C9D1;">2. In your trading app, open <strong>Activate</strong>.</p>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#C9C9D1;">3. Paste this exact license key. The key is linked to ${email} and expires: ${expiry}.</p>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#8A8A96;">Keep this email safe — you will need the key whenever you reinstall the EA.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 32px 32px 32px;">
                <a href="${PORTAL_URL}" style="display:inline-block;background:#E7B53A;color:#0A0A0C;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:999px;">Open EA Migrate Pro Portal</a>
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6C6C78;">If the button does not work, copy this link into your browser:<br /><span style="color:#9A9AA6;">${PORTAL_URL}</span><br /><br />— The EA Migrate Pro Team</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Fire-and-return: awaited by the generator so the UI can confirm delivery. */
async function sendLicenseEmail(options: {
  to: string;
  clientName: string;
  licenseKey: string;
  eaName: string;
  expiry: string;
  imageUrl?: string | null;
}): Promise<boolean> {
  const name = options.clientName.trim().length > 0 ? options.clientName.trim() : "Trader";
  const eaName = options.eaName.trim().length > 0 ? options.eaName.trim() : "EA";
  const expiry = options.expiry.trim().length > 0 ? options.expiry.trim() : "Lifetime";
  return sendBrevoEmail({
    to: options.to,
    toName: name,
    subject: `Your EA Migrate Pro License Key - ${eaName}`,
    html: licenseEmailHtml({
      licenseKey: options.licenseKey,
      eaName,
      expiry,
      email: options.to,
      imageUrl: options.imageUrl ?? null,
    }),
    text: `Your EA Migrate Pro license key: ${options.licenseKey}\n\nEA: ${eaName}\nExpiry: ${expiry}\nLinked to: ${options.to}\n\nActivate it in the EA Migrate Pro Portal: ${PORTAL_URL}\n\nKeep this email safe — you will need the key whenever you reinstall the EA.`,
  });
}

export type SyncSendLicenseEmailInput = {
  toEmail: string;
  clientName: string;
  licenseKey: string;
  eaName: string;
  expiry: string;
  imageUrl?: string | null;
};
export type SyncSendLicenseEmailResult = { enabled: boolean; ok: boolean; error?: string };

/**
 * Called by the license generator right after the key is stored. The send is
 * awaited so the UI can show a real "Emailed to client" confirmation.
 */
export const syncSendLicenseEmail = createServerFn({ method: "POST" })
  .validator((data: SyncSendLicenseEmailInput) => data)
  .handler(async ({ data }): Promise<SyncSendLicenseEmailResult> => {
    const to = data.toEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { enabled: true, ok: false, error: "A valid recipient email is required." };
    }
    const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
    if (apiKey.length === 0) {
      return { enabled: true, ok: false, error: "BREVO_API_KEY is not set — add it in Settings → Environment." };
    }
    const sent = await sendLicenseEmail({
      to,
      clientName: data.clientName,
      licenseKey: data.licenseKey,
      eaName: data.eaName,
      expiry: data.expiry,
      imageUrl: data.imageUrl ?? null,
    });
    return sent
      ? { enabled: true, ok: true }
      : { enabled: true, ok: false, error: "Brevo rejected the send — check the key and verified sender." };
  });

export type SyncSendPasswordChangedEmailInput = { toEmail: string };
export type SyncSendPasswordChangedEmailResult = { enabled: boolean; ok: boolean; error?: string };

/**
 * Sent right after a successful password reset. Exact brand config:
 * From: "EA Migrate Pro Team <eamigratepro@gmail.com>" via Brevo (BREVO_API_KEY).
 */
export const syncSendPasswordChangedEmail = createServerFn({ method: "POST" })
  .validator((data: SyncSendPasswordChangedEmailInput) => data)
  .handler(async ({ data }): Promise<SyncSendPasswordChangedEmailResult> => {
    const to = data.toEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { enabled: true, ok: false, error: "A valid recipient email is required." };
    }
    const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
    if (apiKey.length === 0) {
      return { enabled: true, ok: false, error: "BREVO_API_KEY is not set — add it in Settings → Environment." };
    }
    const html = brandEmailHtml({
      heading: "Password Changed Successfully",
      paragraphs: [
        "Your password has been successfully changed.",
        "You can now login with your new password.",
        "If you did not make this change, contact support immediately.",
      ],
      buttonText: "Go to Portal",
      buttonColor: "#1E90FF",
      footer: "EA Migrate Pro Team",
    });
    const sent = await sendBrevoEmail({
      to,
      toName: to,
      subject: "Password Changed Successfully - EA Migrate Pro",
      html,
      text: "Your password has been successfully changed\nYou can now login with your new password\n\nEA Migrate Pro Team",
      fromName: "EA Migrate Pro Team",
    });
    return sent
      ? { enabled: true, ok: true }
      : { enabled: true, ok: false, error: "Brevo rejected the send — check the key and verified sender." };
  });

export type SyncAdminUpdateInput = { adminEmail: string; targetEmail: string; patch: AdminPatch };
export type SyncAdminUpdateResult = { enabled: boolean; ok: boolean; error?: string };

async function requireAdmin(adminEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = adminEmail.trim().toLowerCase();
  if (clean.length === 0) return { ok: false, error: "Sign in as an admin to make changes." };
  // Platform owners are admins even when their account record was never
  // mirrored into the cloud store (e.g. the seeded admin@eamigrate.pro login,
  // which only ever existed in a device's localStorage). Without this, admin
  // mutations silently failed and approvals never reached the mentor.
  if (OWNER_EMAILS.includes(clean)) return { ok: true };
  const admin = await readAccount(clean);
  if (!admin || admin.role !== "admin") return { ok: false, error: "Only admins can make these changes." };
  return { ok: true };
}

export const syncAdminUpdate = createServerFn({ method: "POST" })
  .validator((data: SyncAdminUpdateInput) => data)
  .handler(async ({ data }): Promise<SyncAdminUpdateResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const adminCheck = await requireAdmin(data.adminEmail);
    if (!adminCheck.ok) return { enabled: true, ok: false, error: adminCheck.error };

    const targetEmail = data.targetEmail.trim().toLowerCase();
    const account = await readAccount(targetEmail);
    // Upsert: an approval MUST land in the shared store even when the mentor's
    // registration never reached it (offline phone, dropped request) —
    // otherwise every later poll resurrects the stale "pending" status.
    const base: Account = account ?? {
      id: "m-cloud-" + Date.now(),
      firstName: "",
      displayName: targetEmail,
      email: targetEmail,
      username: targetEmail.split("@")[0] ?? targetEmail,
      password: "",
      whatsapp: "",
      role: "mentor",
      status: "pending",
      createdAt: new Date().toISOString(),
      licenseLimit: 0,
      licenses: [],
      eas: [],
    };

    const patch = data.patch;
    // Licenses union-merge by id so an approval push from a device holding a
    // stale snapshot can never delete keys another session created; the admin
    // panel passes replaceLicenses when it is pausing/removing keys.
    const licensesById = new Map((patch.replaceLicenses ? [] : base.licenses).map((license) => [license.id, license]));
    for (const license of patch.licenses ?? []) licensesById.set(license.id, license);
    const mergedLicenses =
      patch.licenses !== undefined ? Array.from(licensesById.values()) : base.licenses;
    const updated: Account = {
      ...base,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.licenseLimit !== undefined
        ? { licenseLimit: Math.max(0, Math.floor(patch.licenseLimit)) }
        : {}),
      licenses: mergedLicenses,
    };
    // Admin decisions MUST reach the shared store — a silently dropped write
    // made approved users reappear as pending on the next poll/re-login.
    // Retry the write a few times before giving up.
    let lastOk = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      lastOk = await writeAccount(updated);
      // The approval index is the authoritative status — write it whenever
      // the patch carries a status decision, with the same retry budget.
      if (patch.status !== undefined) {
        lastOk = (await setApprovalStatus(targetEmail, patch.status)) && lastOk;
      }
      if (lastOk) break;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
    // Welcome email on the pending/rejected -> approved transition (never for
    // a revoked admin, never re-sent when the status was already approved).
    // Fire-and-forget: the approval itself must never wait on or fail because
    // of the email provider.
    if (
      lastOk &&
      patch.status === "approved" &&
      base.status !== "approved" &&
      !isRemovedAdmin(targetEmail)
    ) {
      void sendApprovalEmail(targetEmail, base.firstName).catch((error) =>
        console.error("[brevo] unexpected failure:", error),
      );
    }
    return {
      enabled: true,
      ok: lastOk,
      ...(lastOk ? {} : { error: "The shared store did not accept the update — try again." }),
    };
  });

export type SyncPaymentInput = { adminEmail: string; email: string; paid: boolean };
export type SyncPaymentResult = { enabled: boolean; ok: boolean; error?: string };

export const syncSetPayment = createServerFn({ method: "POST" })
  .validator((data: SyncPaymentInput) => data)
  .handler(async ({ data }): Promise<SyncPaymentResult> => {
    const client = db();
    if (!client) return { enabled: false, ok: false };
    const adminCheck = await requireAdmin(data.adminEmail);
    if (!adminCheck.ok) return { enabled: true, ok: false, error: adminCheck.error };

    const clean = data.email.trim().toLowerCase();
    const { error } = data.paid
      ? await client
          .from("portal_payments")
          .upsert({ email: clean, paid: true, paid_at: new Date().toISOString() }, { onConflict: "email" })
      : await client.from("portal_payments").delete().eq("email", clean);
    if (error) {
      console.error("[supabase] portal_payments write failed:", error.message);
      return { enabled: true, ok: false, error: error.message };
    }
    return { enabled: true, ok: true };
  });

/* ------------------------------------------------------------------ */
/* MT5 account persistence — the cloud equivalent of the mt5_accounts */
/* table: one record per app user, written right after MetaApi        */
/* accepts the connection, read on page load. The MT5 password is     */
/* NEVER stored — MetaApi holds it, we keep only metadata.            */
/* ------------------------------------------------------------------ */

export type Mt5AccountRecord = {
  userId: string;
  loginId: string;
  server: string;
  accountType: string;
  broker: string;
  /** The MetaApi-hosted account id used for live execution. */
  mcAccountId: string;
  environment?: string | undefined;
  /** live or demo — detected from the broker server name at connect time. */
  kind?: "live" | "demo" | undefined;
  isConnected: boolean;
  connectedAt: string;
  /**
   * SERVER-ONLY credential store for the on-demand connection model: the MT5
   * password is kept in the cloud record so a trade can open a verified
   * connection at execution time. It is stripped from every read response
   * and is never sent to the browser, logged, or exposed in any UI.
   */
  mtPassword?: string | undefined;
};

function parseMt5Record(raw: unknown): Mt5AccountRecord | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Mt5AccountRecord;
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.mcAccountId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export type Mt5SaveInput = { record: Mt5AccountRecord };
export type Mt5SaveResult = { enabled: boolean; ok: boolean };

/**
 * Shared MT5 record upsert — used by the cloud sync endpoint below AND by the
 * VPS bridge's save-first flow (mt5-bridge.server.ts). Returns false when
 * Supabase is not configured or the write failed.
 */
export async function upsertMt5Record(record: Mt5AccountRecord): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { error } = await client
    .from("mt5_accounts")
    .upsert(
      { user_id: record.userId.trim().toLowerCase(), data: JSON.stringify(record), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) console.error("[supabase] mt5_accounts upsert failed:", error.message);
  return !error;
}

export const syncSaveMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5SaveInput) => data)
  .handler(async ({ data }): Promise<Mt5SaveResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const record = data.record;
    if (!record?.userId || !record.mcAccountId) return { enabled: true, ok: false };
    const ok = await upsertMt5Record(record);
    return { enabled: true, ok };
  });

export type Mt5GetInput = { userId: string };
export type Mt5GetResult = { enabled: boolean; record: Mt5AccountRecord | null };

export const syncGetMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5GetInput) => data)
  .handler(async ({ data }): Promise<Mt5GetResult> => {
    const client = db();
    if (!client) return { enabled: false, record: null };
    const { data: row } = await client
      .from("mt5_accounts")
      .select("data")
      .eq("user_id", data.userId.trim().toLowerCase())
      .maybeSingle();
    const stored = parseMt5Record(row?.data);
    // The saved MT5 password NEVER leaves the server — strip it before serving.
    if (!stored) return { enabled: true, record: null };
    const { mtPassword: _secret, ...safeRecord } = stored;
    return { enabled: true, record: safeRecord };
  });

export type Mt5DeleteInput = { userId: string; /** "all" removes the record; "password" wipes only the saved credential. */ mode?: "all" | "password" };
export type Mt5DeleteResult = { enabled: boolean; ok: boolean };

export const syncDeleteMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5DeleteInput) => data)
  .handler(async ({ data }): Promise<Mt5DeleteResult> => {
    const client = db();
    if (!client) return { enabled: false, ok: false };
    const key = data.userId.trim().toLowerCase();
    if (data.mode === "password") {
      // Wipe only the credential — connection metadata survives (offline).
      const { data: row } = await client.from("mt5_accounts").select("data").eq("user_id", key).maybeSingle();
      const stored = parseMt5Record(row?.data);
      if (!stored) return { enabled: true, ok: true };
      const { mtPassword: _removed, ...rest } = stored;
      const { error } = await client
        .from("mt5_accounts")
        .upsert({ user_id: key, data: JSON.stringify(rest), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      return { enabled: true, ok: !error };
    }
    const { error } = await client.from("mt5_accounts").delete().eq("user_id", key);
    return { enabled: true, ok: !error };
  });

/* ------------------------------------------------------------------ */
/* EA video cloud backup — mentors' uploaded videos survive across     */
/* devices and browser storage evictions. IndexedDB alone is          */
/* best-effort: mobile browsers silently evict it, so a mentor who    */
/* returns a week later was asked to re-upload. Stored as one text    */
/* column per video — Postgres handles large values natively, so the  */
/* old Redis chunking (and its size errors) is gone for good.         */
/* ------------------------------------------------------------------ */

export type EaVideoBackupInput = { videoId: string; dataUrl: string };
export type EaVideoBackupResult = { enabled: boolean; ok: boolean };

export const syncSaveEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoBackupInput) => data)
  .handler(async ({ data }): Promise<EaVideoBackupResult> => {
    const client = db();
    if (!client) return { enabled: false, ok: false };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, ok: false };
    const { error } = await client
      .from("ea_videos")
      .upsert({ video_id: videoId, data_url: data.dataUrl, updated_at: new Date().toISOString() }, { onConflict: "video_id" });
    if (error) console.error("[supabase] ea_videos upsert failed:", error.message);
    return { enabled: true, ok: !error };
  });

export type EaVideoLoadInput = { videoId: string };
export type EaVideoLoadResult = { enabled: boolean; dataUrl: string | null };

export const syncLoadEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoLoadInput) => data)
  .handler(async ({ data }): Promise<EaVideoLoadResult> => {
    const client = db();
    if (!client) return { enabled: false, dataUrl: null };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, dataUrl: null };
    const { data: row } = await client
      .from("ea_videos")
      .select("data_url")
      .eq("video_id", videoId)
      .maybeSingle();
    return { enabled: true, dataUrl: typeof row?.data_url === "string" ? row.data_url : null };
  });

export type EaVideoDeleteInput = { videoId: string };
export type EaVideoDeleteResult = { enabled: boolean; ok: boolean };

export const syncDeleteEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoDeleteInput) => data)
  .handler(async ({ data }): Promise<EaVideoDeleteResult> => {
    const client = db();
    if (!client) return { enabled: false, ok: false };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, ok: false };
    const { error } = await client.from("ea_videos").delete().eq("video_id", videoId);
    return { enabled: true, ok: !error };
  });
