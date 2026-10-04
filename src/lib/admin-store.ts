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
export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  if (!supabaseConfigured || !supabase) {
    return { users: [], messages: [], ok: false, error: "Database not connected" };
  }
  const db = supabase;
  const [usersResult, approvalsResult, keysResult, settingsResult, paidResult, messagesResult, accountsResult] =
    await Promise.all([
      db
        .from("users")
        .select("email, created_at, is_paid, is_admin, device_id, reactivation_enabled")
        .order("created_at", { ascending: false }),
      db.from("mentor_approvals").select("email, status, created_at"),
      db.from("license_keys").select("email"),
      db.from("app_settings").select("key, value, updated_at").like("key", `${LIMIT_PREFIX}%`),
      db.from("paid_emails").select("email, paid_at"),
      db.from("app_messages").select("id, body, sent_at, recipients, sender").order("sent_at", { ascending: false }),
      // The website signup form writes its account HERE, not into `users`
      // (that write is the app's sign-in path). Without this read a mentor who
      // registered on the portal had no `users` row, so they never appeared in
      // this console at all — the registration looked like it never happened.
      db.from("portal_accounts").select("email, data, updated_at"),
    ]);

  // Every table is independent — a hiccup in one must not blank the rest.
  const error =
    usersResult.error?.message ??
    approvalsResult.error?.message ??
    keysResult.error?.message ??
    settingsResult.error?.message ??
    paidResult.error?.message;

  const approvals = new Map<string, ApprovalStatus>();
  const approvalDates = new Map<string, string>();
  for (const row of (approvalsResult.data ?? []) as Array<{
    email?: string;
    status?: string;
    created_at?: string | null;
  }>) {
    const email = text(row.email).toLowerCase();
    const status = text(row.status).toLowerCase();
    if (!email) continue;
    if (row.created_at) approvalDates.set(email, row.created_at);
    if (status === "approved" || status === "rejected" || status === "pending") {
      approvals.set(email, status);
    }
  }

  // Portal signups: email → the signup moment, taken from the stored account
  // (createdAt) so the console's date column is real rather than epoch-zero.
  const portalSignups = new Map<string, string>();
  // email → the name they registered with. Same blob, no second read.
  //
  // There is no name column on `users` and no DDL path to add one (every SQL
  // entry point on this deployment answers PGRST202), so the name comes out of
  // `portal_accounts.data` — where the website signup already keeps
  // firstName / displayName / username, and where the app stores `appName`.
  //
  // The email local-part is deliberately NOT used as a name. It is a guess, and
  // a guessed label in front of the owner is worse than an honest dash.
  const registeredNames = new Map<string, string>();
  for (const row of (accountsResult?.data ?? []) as Array<{
    email?: string;
    data?: string | null;
    updated_at?: string | null;
  }>) {
    const email = text(row.email).toLowerCase();
    if (!email) continue;
    let created = text(row.updated_at);
    if (row.data) {
      try {
        const parsed = JSON.parse(row.data) as {
          createdAt?: unknown;
          firstName?: unknown;
          lastName?: unknown;
          displayName?: unknown;
          username?: unknown;
          appName?: unknown;
        };
        if (typeof parsed.createdAt === "string" && parsed.createdAt) created = parsed.createdAt;
        const both = [parsed.firstName, parsed.lastName]
          .map((part) => text(part).trim())
          .filter(Boolean)
          .join(" ");
        const name =
          text(parsed.appName).trim() ||
          text(parsed.displayName).trim() ||
          both ||
          text(parsed.username).trim();
        if (name) registeredNames.set(email, name);
      } catch {
        /* corrupted row — the updated_at timestamp still orders it */
      }
    }
    portalSignups.set(email, created);
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

  const byEmail = new Map<string, AdminUser>();
  for (const row of (usersResult.data ?? []) as Array<{
    email: string;
    created_at?: string | null;
    is_paid?: boolean;
    is_admin?: boolean;
    device_id?: string | null;
    reactivation_enabled?: boolean;
  }>) {
    const email = text(row.email).toLowerCase();
    if (!email) continue;
    // A `users` ROW IS NOT A MENTOR SIGNUP — this used to fall back to
    // "pending" for every email, so anyone who had ever opened the trading app
    // filled the Pending Approvals queue. Pending now requires a PORTAL signup
    // (`portal_accounts`) or an explicit `mentor_approvals` row; an app-only
    // address is "app" — listed as a user, never pending, never counted.
    const status: ReviewStatus = approvals.get(email) ?? (portalSignups.has(email) ? "pending" : "app");
    byEmail.set(email, {
      email,
      createdAt: timestamp(row.created_at, portalSignups.get(email) ?? approvalDates.get(email) ?? epochFallback()),
      // The name comes from the signup blob, not from this row: `users` has no
      // name column. `usedApp` is true precisely because this row exists.
      name: registeredNames.get(email) ?? null,
      usedApp: true,
      status,
      // The LEDGER, never `users.is_paid` — see the isPaid doc comment. The
      // `users` row is still read for is_admin / device_id / created_at, but
      // its payment flag is a mirror somebody else can write, so it cannot
      // decide what this console calls Paid.
      isPaid: paidAt.has(email),
      isAdmin: bool(row.is_admin),
      licenseLimit: limits.get(email) ?? 0,
      keysUsed: usage.get(email) ?? 0,
      paidAt: paidAt.get(email) ?? null,
      deviceBound: typeof row.device_id === "string" && row.device_id.length > 0,
      reactivationEnabled: bool(row.reactivation_enabled),
    });
  }

  // EVERY SIGNUP MUST APPEAR. An account that registered on the website has no
  // `users` row, and a signup whose users write failed has no account row but
  // always has an approval row. Union all three sources so "I registered and
  // my email never showed up" cannot happen again.
  for (const email of new Set([...approvals.keys(), ...portalSignups.keys()])) {
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email,
      createdAt: portalSignups.get(email) ?? approvalDates.get(email) ?? epochFallback(),
      name: registeredNames.get(email) ?? null,
      // No `users` row means this account has never opened the trading app —
      // it only registered on the website. That distinction is exactly what
      // separates "people using the app" from "mentor signups".
      usedApp: false,
      status: approvals.get(email) ?? "pending",
      isPaid: paidAt.has(email),
      isAdmin: false,
      licenseLimit: limits.get(email) ?? 0,
      keysUsed: usage.get(email) ?? 0,
      paidAt: paidAt.get(email) ?? null,
      deviceBound: false,
      reactivationEnabled: false,
    });
  }

  const users = Array.from(byEmail.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return error ? { users, messages, ok: true, error } : { users, messages, ok: true };
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
export async function setUserApproval(
  email: string,
  status: ApprovalStatus,
): Promise<AdminWriteResult> {
  if (!supabase) return { ok: false, error: "Database not configured" };
  const clean = normalizeEmail(email);
  if (!clean) return { ok: false, error: "Missing email" };
  // The row has to exist before it can be approved, and the account may
  // not have opened the app yet.
  const { error: userError } = await supabase
    .from("users")
    .upsert({ email: clean }, { onConflict: "email", ignoreDuplicates: true });
  if (userError) return { ok: false, error: userError.message };
  const { error } = await supabase
    .from("mentor_approvals")
    .upsert({ email: clean, status }, { onConflict: "email" });
  if (error) return { ok: false, error: error.message };
  // REJECT CLOSES THE APP — BUT IT DOES NOT WRITE A PAYMENT MARKER.
  //
  // An earlier version of this file wrote `paid_emails.paid_at = null` here so
  // that a rejection would also read as a deactivation on the phone. That was
  // wrong in a way that only showed up against real data: it fabricated a
  // payment history for accounts that had never paid, and the gate — correctly
  // — treats that marker as "this account HAD access and it was taken away".
  // The result was that all 29 rejected members were told their portal had
  // been deactivated, on a screen with no way forward, when in truth nothing
  // had ever been taken from them.
  //
  // Nothing is written here now. The rejection itself is the record, and the
  // access gate reads `mentor_approvals` directly (isRejected in
  // payment-gate.ts): a rejected account is closed regardless of payment, and
  // is shown "deactivated" only when it actually held something. Never-paid
  // rejected accounts get the plans, which is the only route to buying in.
  //
  // To genuinely deprecate someone who WAS paid, use "Mark unpaid" — that
  // writes the `paid_at = null` marker and is exactly what it is for.
  return { ok: true };
}

/** Maximum license keys this user may create/use. 0 = blocked until set. */
export async function setUserLicenseLimit(
  email: string,
  limit: number,
): Promise<AdminWriteResult> {
  if (!supabase) return { ok: false, error: "Database not configured" };
  const clean = normalizeEmail(email);
  if (!clean) return { ok: false, error: "Missing email" };
  const safe = Math.max(0, Math.min(9999, Math.floor(Number(limit) || 0)));
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: `${LIMIT_PREFIX}${clean}`, value: { limit: safe }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
  if (!supabase) return { ok: false, error: "Database not configured" };
  const clean = normalizeEmail(email);
  if (!clean) return { ok: false, error: "Missing email" };
  const { error } = await supabase
    .from("users")
    .update({ is_paid: paid })
    .eq("email", clean);
  // Zero rows is not a failure — the account may not exist yet, and the
  // upsert below creates it.
  if (error && error.code !== "PGRST116") return { ok: false, error: error.message };
  const { error: paidError } = await supabase
    .from("paid_emails")
    .upsert(
      paid
        ? { email: clean, paid_at: new Date().toISOString() }
        : { email: clean, paid_at: null },
      { onConflict: "email" },
    );
  if (paidError) return { ok: false, error: paidError.message };
  return { ok: true };
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
