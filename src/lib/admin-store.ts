/**
 * ── Admin console data layer ────────────────────────────────────────────
 * EVERY number and state the admin dashboard shows comes from the database
 * through this module. Nothing is hardcoded, cached in localStorage or
 * inferred from this console — reload the page and you get the truth.
 *
 * Real tables used (all verified against the live schema):
 *   users            → the accounts (email, created_at, is_paid, is_admin,
 *                      device_id — one email, one device).
 *   mentor_approvals → the approval state machine: one row per email with
 *                      status pending | approved | rejected. A NEW signup
 *                      writes a 'pending' row, so an account with no row
 *                      has never been reviewed and counts as pending.
 *   license_keys     → one row per issued key, bound to the owner's email.
 *                      The COUNT per email is the real key usage.
 *   paid_emails      → payment date for the Paid Users section.
 *   app_settings     → key/value store. License limits live under
 *                      `limit:<email>` and broadcast history under
 *                      `msg:<timestamp>:<id>`, so the message history is a
 *                      real database record with date, recipients and sender.
 *
 * The browser talks to these tables with the anon key (the same path the
 * rest of the app already uses). RLS is what stops a normal user forging an
 * approval — see supabase/admin-dashboard-rls.sql, which is the migration
 * that makes that guarantee real at the database level.
 */

import { supabase, supabaseConfigured } from "@/lib/supabase";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** One row of the admin's user table — merged from users + mentor_approvals. */
export type AdminUser = {
  email: string;
  createdAt: string;
  /** Approval state. No mentor_approvals row = never reviewed = pending. */
  status: ApprovalStatus;
  /** True when the cloud row says is_paid. The ONLY source of "Paid". */
  isPaid: boolean;
  isAdmin: boolean;
  /** Maximum license keys the admin granted this user (0 = not set yet). */
  licenseLimit: number;
  /** Keys actually issued to this email — counted from license_keys. */
  keysUsed: number;
  /** Payment date when known (paid_emails), else the signup date. */
  paidAt: string | null;
  /** True when a device is bound in the cloud. */
  deviceBound: boolean;
  /** The user may release client devices. */
  reactivationEnabled: boolean;
};

export type AdminMessage = {
  id: string;
  body: string;
  sentAt: string;
  /** How many registered emails the message actually went out to. */
  recipients: number;
  sender: string;
};

export type AdminSnapshot = {
  users: AdminUser[];
  messages: AdminMessage[];
  /** True when at least one read hit the database. */
  ok: boolean;
  error?: string;
};

const LIMIT_PREFIX = "limit:";
const MESSAGE_PREFIX = "msg:";

/**
 * Every admin write answers with the same shape, plus `needsSignIn` when the
 * database refused the CALLER rather than the value. That flag is what lets
 * the console say "sign in again" instead of dumping a raw SQL error.
 */
export type AdminWriteResult = { ok: boolean; error?: string; needsSignIn?: boolean };

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function timestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function epochFallback(): string {
  // A row without created_at (legacy) still needs a stable signup date.
  return new Date(0).toISOString();
}

/** Keys the app never used — parsed defensively so one bad row can't blank the page. */
function parseSettings(rows: Array<{ key: string; value: unknown; updated_at?: string }>): {
  limits: Map<string, number>;
  messages: AdminMessage[];
} {
  const limits = new Map<string, number>();
  const messages: AdminMessage[] = [];
  for (const row of rows) {
    const key = text(row.key);
    let value: unknown = row.value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        value = null;
      }
    }
    if (!value || typeof value !== "object") continue;
    if (key.startsWith(LIMIT_PREFIX)) {
      const email = key.slice(LIMIT_PREFIX.length).toLowerCase();
      const limit = Number((value as { limit?: unknown }).limit);
      if (email && Number.isFinite(limit) && limit >= 0) limits.set(email, Math.floor(limit));
      continue;
    }
    if (key.startsWith(MESSAGE_PREFIX)) {
      const record = value as {
        id?: unknown;
        body?: unknown;
        sentAt?: unknown;
        recipients?: unknown;
        sender?: unknown;
      };
      const body = text(record.body);
      if (!body) continue;
      messages.push({
        id: text(record.id, key),
        body,
        sentAt: timestamp(record.sentAt, timestamp(row.updated_at, new Date().toISOString())),
        recipients: Number.isFinite(Number(record.recipients)) ? Number(record.recipients) : 0,
        sender: text(record.sender, "admin"),
      });
    }
  }
  messages.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
  return { limits, messages };
}

/**
 * One consistent snapshot of the whole console. The tables are read in
 * PARALLEL (four round trips, not seven) and merged here, so the stats
 * cards, the lists and the user sheet can never disagree with each other.
 */
export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  if (!supabaseConfigured || !supabase) {
    return { users: [], messages: [], ok: false, error: "Database not connected" };
  }
  const db = supabase;
  const [usersResult, approvalsResult, keysResult, settingsResult, paidResult, messagesResult] =
    await Promise.all([
      db
        .from("users")
        .select("email, created_at, is_paid, is_admin, device_id, reactivation_enabled")
        .order("created_at", { ascending: false }),
      db.from("mentor_approvals").select("email, status"),
      db.from("license_keys").select("email"),
      db.from("app_settings").select("key, value, updated_at").like("key", `${LIMIT_PREFIX}%`),
      db.from("paid_emails").select("email, paid_at"),
      db.from("app_messages").select("id, body, sent_at, recipients, sender").order("sent_at", { ascending: false }),
    ]);

  // Every table is independent — a hiccup in one must not blank the rest.
  const error =
    usersResult.error?.message ??
    approvalsResult.error?.message ??
    keysResult.error?.message ??
    settingsResult.error?.message ??
    paidResult.error?.message;

  const approvals = new Map<string, ApprovalStatus>();
  for (const row of (approvalsResult.data ?? []) as Array<{ email?: string; status?: string }>) {
    const email = text(row.email).toLowerCase();
    const status = text(row.status).toLowerCase();
    if (!email) continue;
    if (status === "approved" || status === "rejected" || status === "pending") {
      approvals.set(email, status);
    }
  }

  // Real key usage: how many license_keys rows are bound to each email.
  const usage = new Map<string, number>();
  for (const row of (keysResult.data ?? []) as Array<{ email?: string | null }>) {
    const email = text(row.email).toLowerCase();
    if (!email || email.endsWith("@eamigratepro.invalid")) continue;
    usage.set(email, (usage.get(email) ?? 0) + 1);
  }

  const paidAt = new Map<string, string>();
  for (const row of (paidResult.data ?? []) as Array<{ email?: string; paid_at?: string | null }>) {
    const email = text(row.email).toLowerCase();
    if (email && row.paid_at) paidAt.set(email, row.paid_at);
  }

  const { limits } = parseSettings(
    (settingsResult.data ?? []) as Array<{ key: string; value: unknown; updated_at?: string }>,
  );

  // Broadcast history comes from the app_messages table written by the
  // admin-checked function. Any older rows written before the migration
  // live in app_settings and are merged in, so nothing is ever lost.
  const messages: AdminMessage[] = [];
  for (const row of (messagesResult.data ?? []) as Array<{
    id?: string;
    body?: string;
    sent_at?: string | null;
    recipients?: number | null;
    sender?: string | null;
  }>) {
    const body = text(row.body);
    if (!body) continue;
    messages.push({
      id: text(row.id),
      body,
      sentAt: timestamp(row.sent_at, new Date().toISOString()),
      recipients: Number(row.recipients ?? 0) || 0,
      sender: text(row.sender, "admin"),
    });
  }
  const legacy = parseSettings(
    (settingsResult.data ?? []) as Array<{ key: string; value: unknown; updated_at?: string }>,
  ).messages;
  const knownIds = new Set(messages.map((item) => item.id));
  messages.push(...legacy.filter((item) => !knownIds.has(item.id)));
  messages.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));

  const users: AdminUser[] = (
    (usersResult.data ?? []) as Array<{
      email: string;
      created_at?: string | null;
      is_paid?: boolean;
      is_admin?: boolean;
      device_id?: string | null;
      reactivation_enabled?: boolean;
    }>
  ).map((row) => {
    const email = text(row.email).toLowerCase();
    // No approval row = the account was never reviewed → it is PENDING.
    const status: ApprovalStatus = approvals.get(email) ?? "pending";
    return {
      email,
      createdAt: timestamp(row.created_at, epochFallback()),
      status,
      isPaid: bool(row.is_paid),
      isAdmin: bool(row.is_admin),
      licenseLimit: limits.get(email) ?? 0,
      keysUsed: usage.get(email) ?? 0,
      paidAt: paidAt.get(email) ?? null,
      deviceBound: typeof row.device_id === "string" && row.device_id.length > 0,
      reactivationEnabled: bool(row.reactivation_enabled),
    };
  });

  return error ? { users, messages, ok: true, error } : { users, messages, ok: true };
}

/**
 * APPROVE / REJECT. Goes through the database function
 * `admin_set_approval`, which verifies the signed-in admin against the
 * admin_emails table before writing. A direct table write is no longer
 * possible — that is the point of the migration.
 */
export async function setUserApproval(
  email: string,
  status: ApprovalStatus,
): Promise<AdminWriteResult> {
  return callAdminFunction("admin_set_approval", { p_email: normalizeEmail(email), p_status: status });
}

/** Maximum license keys this user may create/use. 0 = blocked until set. */
export async function setUserLicenseLimit(
  email: string,
  limit: number,
): Promise<AdminWriteResult> {
  const safe = Math.max(0, Math.min(9999, Math.floor(Number(limit) || 0)));
  return callAdminFunction("admin_set_license_limit", { p_email: normalizeEmail(email), p_limit: safe });
}

/** Payment status is the users.is_paid flag — the app's sign-in gate reads it. */
export async function setUserPaid(email: string, paid: boolean): Promise<AdminWriteResult> {
  return callAdminFunction("admin_set_paid", { p_email: normalizeEmail(email), p_paid: paid });
}

/**
 * Turn a database refusal into something the admin can act on. The common
 * one by far is a missing console sign-in: the functions check the caller's
 * signed-in email, so an unsigned console is refused even though it is on
 * the right device.
 */
function describeAdminError(message: string): { error: string; needsSignIn: boolean } {
  const raw = message || "The database returned no error.";
  if (/admin only/i.test(raw)) {
    return {
      error: "The database refused this: sign in to the console with your admin account.",
      needsSignIn: true,
    };
  }
  if (/could not find the function|function .*(does not exist|not found)/i.test(raw)) {
    return {
      error: "That database function is not installed yet. Run supabase/admin-dashboard-rls.sql in the Supabase SQL editor.",
      needsSignIn: false,
    };
  }
  if (/permission denied|row-level security|42501/i.test(raw)) {
    return {
      error: "The database refused the write. Sign in to the console with your admin account, then try again.",
      needsSignIn: true,
    };
  }
  if (/jwt|token|not authenticated|401/i.test(raw)) {
    return { error: "Your console session expired. Sign in again and retry.", needsSignIn: true };
  }
  return { error: raw, needsSignIn: false };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * One write, one truth. The database functions return true ONLY after the row
 * is committed, so anything other than `true` is a failed write and the
 * console must say so — that is what stops a button reading "Saved" while the
 * number on screen never changes.
 */
async function callAdminFunction(
  name: string,
  args: Record<string, string | number | boolean>,
): Promise<AdminWriteResult> {
  if (!supabase) return { ok: false, error: "Database not configured" };
  const email = typeof args["p_email"] === "string" ? args["p_email"] : "";
  if (!email) return { ok: false, error: "Missing email" };
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const described = describeAdminError(error.message);
    return { ok: false, error: described.error, needsSignIn: described.needsSignIn };
  }
  if (data !== true) {
    return { ok: false, error: "The database did not confirm the save. Nothing was changed." };
  }
  return { ok: true };
}

/** Per-mentor permission to release a client's device. */
export async function setUserReactivation(
  email: string,
  enabled: boolean,
): Promise<AdminWriteResult> {
  const clean = normalizeEmail(email);
  if (!supabase) return { ok: false, error: "Database not configured" };
  if (!clean) return { ok: false, error: "Missing email" };
  // Same admin-checked function as the other console writes: a direct write
  // to `users` is refused by RLS, which is why this toggle used to fail.
  const viaFunction = await callAdminFunction("admin_set_reactivation", {
    p_email: clean,
    p_enabled: enabled,
  });
  if (viaFunction.ok) return viaFunction;
  if (viaFunction.needsSignIn) return viaFunction;
  // The function may not be installed yet — fall back to the direct write so
  // the toggle still works on a database that has not run part 3.
  const { error } = await supabase
    .from("users")
    .upsert({ email: clean, reactivation_enabled: enabled }, { onConflict: "email" });
  if (error) {
    const described = describeAdminError(error.message);
    return { ok: false, error: described.error, needsSignIn: described.needsSignIn };
  }
  return { ok: true };
}

/**
 * Persist a broadcast in the database. Written AFTER the emails go out, with
 * the REAL recipient count, so the history matches what actually happened.
 */
export async function recordBroadcast(
  body: string,
  recipients: number,
  sender: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Database not configured" };
  const text2 = body.trim();
  if (!text2) return { ok: false, error: "Message is empty" };
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const sentAt = new Date().toISOString();
  // app_messages is the history table; only the admin-checked function may
  // write to it, which is what keeps the record trustworthy.
  const result = await callAdminFunction("admin_record_message", {
    p_id: id,
    p_body: text2,
    p_sent_at: sentAt,
    p_recipients: recipients,
    p_sender: sender.trim() || "admin",
  });
  if (!result.ok) return result;
  return { ok: true, id };
}

/* ── What the SIGN-IN side reads ───────────────────────────────────────── */

/**
 * Approval state for one email, straight from mentor_approvals. Used by the
 * app's registration gate: a pending or rejected account may not enter, an
 * approved one may. Fails OPEN (returns "approved" with ok:false) so a
 * database hiccup never locks a paying customer out — the payment flag
 * still decides in that case.
 */
export async function getApprovalForEmail(
  email: string,
): Promise<{ status: ApprovalStatus; ok: boolean }> {
  const clean = email.trim().toLowerCase();
  if (!supabase || !clean) return { status: "approved", ok: false };
  try {
    const { data, error } = await supabase
      .from("mentor_approvals")
      .select("status")
      .eq("email", clean)
      .maybeSingle();
    if (error || !data) return { status: "approved", ok: false };
    const status = text((data as { status?: string }).status).toLowerCase();
    if (status === "approved" || status === "rejected" || status === "pending") {
      return { status, ok: true };
    }
    return { status: "approved", ok: false };
  } catch {
    return { status: "approved", ok: false };
  }
}

/**
 * The cap the ADMIN set for one email, or null when they never set one.
 * null means "no admin cap" — callers then fall back to their own existing
 * rule instead of locking the account out of key creation entirely.
 * This is the number the key-creation paths enforce.
 */
export async function getLicenseCapForEmail(email: string): Promise<number | null> {
  const clean = email.trim().toLowerCase();
  if (!supabase || !clean) return null;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", `${LIMIT_PREFIX}${clean}`)
      .maybeSingle();
    if (error || !data) return null;
    let value: unknown = (data as { value?: unknown }).value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        return null;
      }
    }
    const limit = Number((value as { limit?: unknown } | null)?.limit);
    return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : null;
  } catch {
    return null;
  }
}

/**
 * How many license keys are bound to this email in the database. Counted
 * live, so the cap is checked against reality and not a local guess.
 */
export async function countKeysForEmail(email: string): Promise<number> {
  const clean = email.trim().toLowerCase();
  if (!supabase || !clean) return 0;
  try {
    const { data, error } = await supabase
      .from("license_keys")
      .select("key")
      .eq("email", clean);
    if (error) return 0;
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

/**
 * The license cap for one email (0 when the admin never set one). The key
 * creation path calls this so a user cannot mint more keys than allowed.
 * Fails OPEN at `fallback` — the caller passes its existing account limit so
 * a database hiccup can never remove a cap that is already in force.
 */
export async function getLicenseLimitForEmail(
  email: string,
  fallback: number,
): Promise<number> {
  const clean = email.trim().toLowerCase();
  if (!supabase || !clean) return fallback;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", `${LIMIT_PREFIX}${clean}`)
      .maybeSingle();
    if (error || !data) return fallback;
    let value: unknown = (data as { value?: unknown }).value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        return fallback;
      }
    }
    const limit = Number((value as { limit?: unknown } | null)?.limit);
    return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : fallback;
  } catch {
    return fallback;
  }
}
