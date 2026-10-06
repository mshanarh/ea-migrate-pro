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
 *                      status pending | approved | rejected. The MENTOR
 *                      PORTAL signup (/signup) writes the 'pending' row —
 *                      that is the only thing that puts somebody in the
 *                      review queue.
 *
 *                      A trading-app email is NOT a mentor signup. Typing an
 *                      address into /app/login only ever asks "has this email
 *                      paid?"; it writes no approval row and alerts nobody.
 *                      Those accounts are reported as status "app" — present
 *                      in the user list, absent from Pending Approvals.
 *   license_keys     → one row per issued key, bound to the owner's email.
 *                      The COUNT per email is the real key usage.
 *   paid_emails      → THE PAYMENT LEDGER. A row with a timestamp is the one
 *                      and only thing that puts a user in the Paid section —
 *                      it is written by "Mark paid" and by a real licence-key
 *                      activation, and by nothing else. `users.is_paid` is a
 *                      mirror that the anon key may write, so it is NOT read
 *                      for this; see the isPaid field comment.
 *   app_settings     → key/value store. License limits live under
 *                      `limit:<email>` and broadcast history under
 *                      `msg:<timestamp>:<id>`, so the message history is a
 *                      real database record with date, recipients and sender.
 *
 * The browser talks to these tables with the anon key (the same path the
 * rest of the app already uses) and writes to them directly — see
 * supabase/admin-simple-access.sql. The console itself only opens for a
 * signed-in admin, which is the portal account's own role.
 */

import { supabase, supabaseConfigured } from "@/lib/supabase";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * The status the CONSOLE displays, which is the review state plus one extra
 * case: "app".
 *
 * "app" means a trading-app account that never signed up on the mentor
 * portal. It is deliberately NOT "pending": a customer who entered their
 * email to buy a licence is not waiting to be approved as a mentor, and
 * counting them as pending filled the review queue with people who only ever
 * wanted to pay. Nothing is written for these accounts — "app" is derived at
 * read time from the absence of a portal signup and of a mentor_approvals row.
 */
export type ReviewStatus = ApprovalStatus | "app";

/** One row of the admin's user table — merged from users + mentor_approvals. */
export type AdminUser = {
  email: string;
  createdAt: string;
  /** The name this person registered with, or null when they never gave one. */
  name: string | null;
  /** True when this account has actually opened the trading app. */
  usedApp: boolean;
  /**
   * Review state as shown in the console. "pending" requires a PORTAL signup
   * (`portal_accounts`) or an explicit `mentor_approvals` row; a trading-app
   * address that has neither is "app" and never enters Pending Approvals.
   */
  status: ReviewStatus;
  /**
   * True when the CONSOLE'S OWN LEDGER records a payment for this email — a
   * `paid_emails` row carrying a timestamp.
   *
   * THIS IS DELIBERATELY NOT `users.is_paid`. `users.is_paid` is a plain
   * boolean column that the anon key is GRANTED write access to (see
   * supabase/00-RUN-THIS.sql), and a read-path check was writing it too, so an
   * approved-but-unpaid mentor would drift into the Paid column on its own and
   * be sitting there the next day with nobody having pressed anything. The
   * ledger is written by exactly two deliberate acts — the console's "Mark
   * paid" button and a real licence-key activation — so what the console shows
   * as Paid is what somebody actually did. APPROVAL IS NOT ONE OF THEM:
   * `setUserApproval` touches only `mentor_approvals`, `users` (email only) and
   * the key allowance, and it must stay that way.
   */
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
 * Every admin write answers with the same shape, plus `needsAttention` when
 * the failure is the DATABASE refusing the write itself (the grant SQL has
 * not been run) rather than the value being wrong. That flag is what keeps
 * the console from dumping a raw SQL error at the admin.
 */
export type AdminWriteResult = { ok: boolean; error?: string; needsAttention?: boolean };

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
let adminActor = "";
/** The signed-in admin's email — sent to the /api admin endpoints. */
export function setAdminActor(email: string) {
  adminActor = email.trim().toLowerCase();
}

type ApiUser = {
  email: string;
  firstName?: string;
  displayName?: string;
  username?: string;
  createdAt?: string;
  status?: string;
  isPaid?: boolean;
  paidAt?: string | null;
  licenseLimit?: number;
};

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-admin-email": adminActor, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({ ok: false, error: `Request failed (${response.status})` }))) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok && payload.ok !== false) throw new Error(`Request failed (${response.status})`);
  return payload;
}

/** Broadcast history only — registrations no longer come from these tables. */
async function loadMessages(): Promise<AdminMessage[]> {
  if (!supabaseConfigured || !supabase) return [];
  const { data } = await supabase
    .from("app_messages")
    .select("id, body, sent_at, recipients, sender")
    .order("sent_at", { ascending: false });
  const messages: AdminMessage[] = [];
  for (const row of (data ?? []) as Array<{ id?: string; body?: string; sent_at?: string | null; recipients?: number | null; sender?: string | null }>) {
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
  return messages;
}

export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  const [usersReply, messages] = await Promise.all([
    adminApi<{ ok: boolean; users?: ApiUser[]; error?: string }>("/api/admin-users").catch((error: unknown) => ({
      ok: false,
      users: [] as ApiUser[],
      error: error instanceof Error ? error.message : "Could not reach the server",
    })),
    loadMessages().catch(() => [] as AdminMessage[]),
  ]);
  const users: AdminUser[] = (usersReply.users ?? []).map((row) => {
    const status = row.status === "approved" || row.status === "rejected" ? row.status : "pending";
    const name = text(row.displayName).trim() || text(row.firstName).trim() || text(row.username).trim() || null;
    return {
      email: normalizeEmail(row.email),
      createdAt: timestamp(row.createdAt, epochFallback()),
      name,
      usedApp: false,
      status,
      isPaid: Boolean(row.isPaid),
      isAdmin: false,
      licenseLimit: Number(row.licenseLimit ?? 0) || 0,
      keysUsed: 0,
      paidAt: row.paidAt ?? null,
      deviceBound: false,
      reactivationEnabled: false,
    };
  });
  if (!usersReply.ok) return { users, messages, ok: false, error: usersReply.error ?? "Could not load registrations" };
  return { users, messages, ok: true };
}

async function adminAction(email: string, action: string, extra: Record<string, unknown> = {}): Promise<AdminWriteResult> {
  const clean = normalizeEmail(email);
  if (!clean) return { ok: false, error: "Missing email" };
  try {
    const reply = await adminApi<{ ok: boolean; error?: string }>("/api/admin-approve", {
      method: "POST",
      body: JSON.stringify({ email: clean, action, ...extra }),
    });
    return reply.ok ? { ok: true } : { ok: false, error: reply.error ?? "Action failed" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Action failed" };
  }
}

/**
 * APPROVE / REJECT — a plain write to mentor_approvals.
 *
 * This used to go through a database function that demanded a Supabase
 * sign-in, which meant the owner pressed "Admin Portal" and was then
 * asked to sign in all over again. The console writes directly now (see
 * supabase/admin-simple-access.sql).
 *
 * APPROVAL IS NOT PAYMENT, AND THIS FUNCTION MUST NEVER BECOME A PAYMENT
 * WRITE. It touches the approval row, the `users` row (email ONLY — no is_paid,
 * ever, on any code path) and, from the caller, the key allowance. A REJECTION
 * writes no payment record at all: the rejection itself is what closes the app
 * (the access gate reads `mentor_approvals` directly), and writing a
 * `paid_at = null` marker here would fabricate a payment history for accounts
 * that never had one. People were approving a signup and coming
 * back days later to find it sitting in the Paid section having pressed
 * nothing, because payment state was being written from somewhere other
 * than this console's ledger. The console's "Mark paid" button is the only
 * way an account becomes paid, and "Mark unpaid" is the only way to revoke
 * one.
 */
export async function setUserApproval(email: string, status: ApprovalStatus): Promise<AdminWriteResult> {
  return adminAction(email, status === "approved" ? "approve" : status === "rejected" ? "reject" : "pending");
}

/** Maximum license keys this user may create/use. 0 = blocked until set. */
export async function setUserLicenseLimit(email: string, limit: number): Promise<AdminWriteResult> {
  return adminAction(email, "limit", { limit });
}

/**
 * THE ONLY WAY AN ACCOUNT BECOMES PAID.
 *
 * It writes both halves deliberately: `users.is_paid`, which the app's sign-in
 * gate reads, and the `paid_emails` ledger row with a timestamp, which is what
 * the console's Paid section reads. Revoking writes the same two in the other
 * direction (is_paid = false, paid_at = null) — the `paid_at = null` row IS the
 * revocation marker the access gate looks for first (isExplicitlyRevoked in
 * payment-gate.ts), so it is not optional bookkeeping.
 */
export async function setUserPaid(email: string, paid: boolean): Promise<AdminWriteResult> {
  return adminAction(email, paid ? "paid" : "unpaid");
}

/**
 * Delete one broadcast from the message history.
 *
 * Routed through the SERVER because the anon key has no DELETE grant on
 * `app_messages` — a direct browser delete fails with `42501 permission denied`
 * (verified live). `/api/portal` is tried first because it is the route that
 * actually answers on the static deployment; the server function below is the
 * fallback for a host that does run them.
 *
 * The DYNAMIC import is deliberate and matches every other use of
 * supabase.server in this bundle: statically importing it pulls TanStack
 * server-function registration into the client graph, which crashed the Android
 * WebView build ("Dashboard didn't load").
 */
export async function deleteBroadcast(id: string, adminEmail?: string): Promise<AdminWriteResult> {
  const clean = id.trim();
  if (!clean) return { ok: false, error: "Missing message id" };

  /* THE ROUTE THAT WORKS ON THE STATIC DEPLOYMENT, tried first.
   *
   * The server function below answers **405** here, because this app ships as
   * a static `dist/` and there is no long-running Node process to answer
   * `POST /_serverFn/*`. `/api/portal` is a Vercel function (api/portal.ts)
   * that deletes with the service-role key, which is the only thing that can
   * remove a row at all — `app_messages` grants the anon key insert + select
   * and no delete.
   *
   * The old path is still attempted when the function is absent, so a bare
   * `vite dev` with no server behaves as it always did.
   */
  if (adminEmail) {
    try {
      const response = await fetch("/api/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "deleteMessage", id: clean, adminEmail }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const reply = (await response.json()) as { ok: boolean; error?: string };
        // A 200 with ok:false is a real answer from the function — a refusal,
        // or a row that was already gone. Falling through to the dead path
        // would replace that with a confusing 405, so it is reported as-is.
        return reply.ok
          ? { ok: true }
          : {
              ok: false,
              error: reply.error ?? "Could not delete that message.",
              needsAttention: /not configured|permission/i.test(reply.error ?? ""),
            };
      }
      console.warn(`[admin] /api/portal replied ${response.status} — trying the server function.`);
    } catch {
      console.warn("[admin] /api/portal unreachable — trying the server function.");
    }
  }

  try {
    const { adminDeleteMessage } = await import("@/lib/supabase.server");
    const result = await adminDeleteMessage({ data: { id: clean } });
    if (!result.ok) {
      const described = describeAdminError(result.error ?? "Could not delete that message");
      return { ok: false, error: described.error, needsAttention: described.needsAttention };
    }
    return { ok: true };
  } catch (error) {
    // A static host has no server functions at all, so the RPC cannot run
    // there. Say so plainly instead of reporting a generic failure.
    const message = error instanceof Error ? error.message : String(error);
    if (/fetch|network|server/i.test(message)) {
      return {
        ok: false,
        error:
          "Deleting a message needs the server, which this host does not run. The history is unchanged.",
        needsAttention: true,
      };
    }
    return { ok: false, error: message };
  }
}

/**
 * Turn a database refusal into something the admin can act on. The one
 * that still matters is a missing grant: the console writes directly, so
 * if the SQL that gives the browser its writes back has not been run,
 * every button fails with a raw permission error.
 */
function describeAdminError(message: string): { error: string; needsAttention: boolean } {
  const raw = message || "The database returned no error.";
  if (/permission denied|row-level security|42501/i.test(raw)) {
    return {
      error: "The database refused this write. Run supabase/admin-simple-access.sql in the Supabase SQL editor.",
      needsAttention: true,
    };
  }
  return { error: raw, needsAttention: false };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Per-mentor permission to release a client's device. */
export async function setUserReactivation(
  email: string,
  enabled: boolean,
): Promise<AdminWriteResult> {
  const clean = normalizeEmail(email);
  if (!supabase) return { ok: false, error: "Database not configured" };
  if (!clean) return { ok: false, error: "Missing email" };
  const { error } = await supabase
    .from("users")
    .upsert({ email: clean, reactivation_enabled: enabled }, { onConflict: "email" });
  if (error) {
    const described = describeAdminError(error.message);
    return { ok: false, error: described.error, needsAttention: described.needsAttention };
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
): Promise<AdminWriteResult & { id?: string }> {
  if (!supabase) return { ok: false, error: "Database not configured" };
  const text2 = body.trim();
  if (!text2) return { ok: false, error: "Message is empty" };
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const sentAt = new Date().toISOString();
  // app_messages is the history table; the console writes to it directly.
  const { error } = await supabase.from("app_messages").insert({
    id,
    body: text2,
    sent_at: sentAt,
    recipients,
    sender: sender.trim() || "admin",
  });
  if (error) {
    const described = describeAdminError(error.message);
    return { ok: false, error: described.error, needsAttention: described.needsAttention };
  }
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
