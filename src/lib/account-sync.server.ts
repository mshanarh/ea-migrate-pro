import { createServerFn } from "@tanstack/react-start";
import { OWNER_EMAILS, type Account, type PaymentRecord, type PortalStatus } from "@/lib/auth-store";

/**
 * Shared cloud account sync — makes registrations visible on the admin page
 * in near-real time across ALL devices.
 *
 * Why: auth-store lives in each device's localStorage, so a person registering
 * on their phone never appeared on the admin's phone. These server functions
 * (this stack's edge functions) mirror account records into an Upstash Redis
 * instance, and the admin console polls them every ~3 seconds.
 *
 * Everything is env-gated: with no KV credentials set, every function returns
 * { enabled: false } and the app keeps working exactly as before (offline
 * localStorage behaviour). Set these in hosting env settings:
 *   UPSTASH_REDIS_REST_URL   (or KV_REST_API_URL)
 *   UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)
 *
 * Security model:
 * - `password` NEVER leaves the server. List responses strip it; sign-in
 *   verification happens server-side.
 * - Admin mutations require the caller's email to belong to an admin-role
 *   account stored in the cloud store.
 */

const ACCOUNTS_KEY = "eamp:accounts";
const PAYMENTS_KEY = "eamp:payments";

function restUrl(): string | null {
  const url = (process.env["UPSTASH_REDIS_REST_URL"] ?? process.env["KV_REST_API_URL"] ?? "").trim();
  return url.length > 0 ? url.replace(/\/+$/, "") : null;
}

function restToken(): string | null {
  const token = (process.env["UPSTASH_REDIS_REST_TOKEN"] ?? process.env["KV_REST_API_TOKEN"] ?? "").trim();
  return token.length > 0 ? token : null;
}

export function cloudSyncConfigured(): boolean {
  return restUrl() !== null && restToken() !== null;
}

/**
 * Emails stripped of admin status by the platform owner. Any cloud/local
 * account record for these emails is demoted to a regular mentor wherever it
 * is loaded, and they can never sign in through the admin console path.
 */
export const REMOVED_ADMIN_EMAILS = ["lwethunkandi3@gmail.com"];

function isRemovedAdmin(email: string): boolean {
  return REMOVED_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

type PipelineResult = { result?: unknown; error?: string | null };

/** Runs Redis commands via the REST pipeline endpoint. Returns null when not configured. */
async function pipeline(commands: (string | number)[][]): Promise<PipelineResult[] | null> {
  const url = restUrl();
  const token = restToken();
  if (!url || !token) return null;
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as PipelineResult[];
    return Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
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
    const results = await pipeline([
      ["HSET", ACCOUNTS_KEY, email, JSON.stringify(merged)],
    ]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });

/* ------------------------------------------------------------------ */
/* List — the admin console polls this every ~3 seconds.              */
/* ------------------------------------------------------------------ */

export type SyncListResult = { enabled: boolean; accounts: PublicAccount[]; payments: PaymentRecord[] };

export const syncListAccounts = createServerFn({ method: "POST" }).handler(async (): Promise<SyncListResult> => {
  if (!cloudSyncConfigured()) return { enabled: false, accounts: [], payments: [] };
  const results = await pipeline([
    ["HGETALL", ACCOUNTS_KEY],
    ["HGETALL", PAYMENTS_KEY],
  ]);
  if (!results) return { enabled: false, accounts: [], payments: [] };

  const accountsRaw = (results[0]?.result ?? {}) as Record<string, unknown>;
  const accounts = Object.values(accountsRaw)
    .map(parseAccount)
    .filter((account): account is Account => account !== null)
    // A removed admin's stale cloud record is demoted wherever it is listed,
    // so no device can ever hydrate them back into an admin role.
    .map((account) => (isRemovedAdmin(account.email) ? { ...account, role: "mentor" as const } : account))
    .map(toPublic);

  const paymentsRaw = (results[1]?.result ?? {}) as Record<string, unknown>;
  const payments = Object.entries(paymentsRaw)
    .map(([email, raw]) => {
      try {
        const parsed = JSON.parse(String(raw)) as PaymentRecord;
        return typeof parsed?.paid === "boolean" ? ({ ...parsed, email } as PaymentRecord) : null;
      } catch {
        return null;
      }
    })
    .filter((payment): payment is PaymentRecord => payment !== null);

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
    const results = await pipeline([["HGET", ACCOUNTS_KEY, email]]);
    const raw = results?.[0]?.result;
    const account = typeof raw === "string" ? parseAccount(raw) : null;
    if (!account) return { enabled: true, ok: false, error: "Wrong email or password. Check the email you registered with and try again." };
    if (account.password !== data.password) {
      return { enabled: true, ok: false, error: "Wrong email or password. Check the email you registered with and try again." };
    }
    // Removed admins keep their (mentor) access but never their admin role.
    const resolved = isRemovedAdmin(email) ? { ...account, role: "mentor" as const } : account;
    return { enabled: true, ok: true, account: toPublic(resolved) };
  });

/* ------------------------------------------------------------------ */
/* Status refresh — a signed-in device polls this so admin decisions   */
/* (approve / reject / license limit) appear LIVE without signing out. */
/* ------------------------------------------------------------------ */

export type SyncGetAccountInput = { email: string };
export type SyncGetAccountResult = { enabled: boolean; account: PublicAccount | null };

export const syncGetAccount = createServerFn({ method: "POST" })
  .validator((data: SyncGetAccountInput) => data)
  .handler(async ({ data }): Promise<SyncGetAccountResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, account: null };
    const account = await readAccount(data.email);
    const resolved =
      account && isRemovedAdmin(account.email) ? { ...account, role: "mentor" as const } : account;
    return { enabled: true, account: resolved ? toPublic(resolved) : null };
  });

/* ------------------------------------------------------------------ */
/* Admin mutations — verified server-side against an admin account.   */
/* ------------------------------------------------------------------ */

export type AdminPatch = {
  status?: PortalStatus;
  licenseLimit?: number;
  licenses?: Account["licenses"];
};

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
  const results = await pipeline([["HGET", ACCOUNTS_KEY, clean]]);
  const raw = results?.[0]?.result;
  const admin = typeof raw === "string" ? parseAccount(raw) : null;
  if (!admin || admin.role !== "admin") return { ok: false, error: "Only admins can make these changes." };
  return { ok: true };
}

async function readAccount(targetEmail: string): Promise<Account | null> {
  const results = await pipeline([["HGET", ACCOUNTS_KEY, targetEmail.trim().toLowerCase()]]);
  const raw = results?.[0]?.result;
  if (typeof raw !== "string") return null;
  return parseAccount(raw);
}

export const syncAdminUpdate = createServerFn({ method: "POST" })
  .validator((data: SyncAdminUpdateInput) => data)
  .handler(async ({ data }): Promise<SyncAdminUpdateResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const adminCheck = await requireAdmin(data.adminEmail);
    if (!adminCheck.ok) return { enabled: true, ok: false, error: adminCheck.error };

    const targetEmail = data.targetEmail.trim().toLowerCase();
    const account = await readAccount(targetEmail);
    if (!account) return { enabled: true, ok: false, error: "Account not found in the cloud store yet." };

    const patch = data.patch;
    const updated: Account = {
      ...account,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.licenseLimit !== undefined ? { licenseLimit: Math.max(0, Math.floor(patch.licenseLimit)) } : {}),
      ...(patch.licenses !== undefined ? { licenses: patch.licenses } : {}),
    };
    const results = await pipeline([["HSET", ACCOUNTS_KEY, targetEmail, JSON.stringify(updated)]]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });

export type SyncPaymentInput = { adminEmail: string; email: string; paid: boolean };
export type SyncPaymentResult = { enabled: boolean; ok: boolean; error?: string };

export const syncSetPayment = createServerFn({ method: "POST" })
  .validator((data: SyncPaymentInput) => data)
  .handler(async ({ data }): Promise<SyncPaymentResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const adminCheck = await requireAdmin(data.adminEmail);
    if (!adminCheck.ok) return { enabled: true, ok: false, error: adminCheck.error };

    const clean = data.email.trim().toLowerCase();
    const record: PaymentRecord = { email: clean, paid: data.paid, ...(data.paid ? { paidAt: new Date().toISOString() } : {}) };
    const command = data.paid
      ? (["HSET", PAYMENTS_KEY, clean, JSON.stringify(record)] as (string | number)[])
      : (["HDEL", PAYMENTS_KEY, clean] as (string | number)[]);
    const results = await pipeline([command]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });

/* ------------------------------------------------------------------ */
/* MT5 account persistence — the cloud equivalent of the mt5_accounts */
/* table: one record per app user, written right after MetaApi        */
/* accepts the connection, read on page load. The MT5 password is     */
/* NEVER stored — MetaApi holds it, we keep only metadata.            */
/* ------------------------------------------------------------------ */

const MT5_KEY = "eamp:mt5-accounts";

export type Mt5AccountRecord = {
  userId: string;
  loginId: string;
  server: string;
  accountType: string;
  broker: string;
  /** The MetaApi-hosted account id used for live execution. */
  mcAccountId: string;
  environment?: string | undefined;
  isConnected: boolean;
  connectedAt: string;
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

export const syncSaveMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5SaveInput) => data)
  .handler(async ({ data }): Promise<Mt5SaveResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const record = data.record;
    if (!record?.userId || !record.mcAccountId) return { enabled: true, ok: false };
    const results = await pipeline([["HSET", MT5_KEY, record.userId.trim().toLowerCase(), JSON.stringify(record)]]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });

export type Mt5GetInput = { userId: string };
export type Mt5GetResult = { enabled: boolean; record: Mt5AccountRecord | null };

export const syncGetMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5GetInput) => data)
  .handler(async ({ data }): Promise<Mt5GetResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, record: null };
    const results = await pipeline([["HGET", MT5_KEY, data.userId.trim().toLowerCase()]]);
    const raw = results?.[0]?.result;
    return { enabled: true, record: parseMt5Record(raw) };
  });

export type Mt5DeleteInput = { userId: string };
export type Mt5DeleteResult = { enabled: boolean; ok: boolean };

export const syncDeleteMt5Account = createServerFn({ method: "POST" })
  .validator((data: Mt5DeleteInput) => data)
  .handler(async ({ data }): Promise<Mt5DeleteResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const results = await pipeline([["HDEL", MT5_KEY, data.userId.trim().toLowerCase()]]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });

/* ------------------------------------------------------------------ */
/* EA video cloud backup — mentors' uploaded videos survive across     */
/* devices and browser storage evictions. IndexedDB alone is          */
/* best-effort: mobile browsers silently evict it, so a mentor who    */
/* returns a week later was asked to re-upload. Videos are stored     */
/* as base64 chunks (Redis values must stay small) behind one hash    */
/* key per EA, written immediately after a successful upload.         */
/* ------------------------------------------------------------------ */

const VIDEOS_KEY = "eamp:ea-videos";
/** Keep chunks safely below Redis' default 512MB value limit. */
const CHUNK_SIZE = 900_000;

export type EaVideoBackupInput = { videoId: string; dataUrl: string };
export type EaVideoBackupResult = { enabled: boolean; ok: boolean };

export const syncSaveEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoBackupInput) => data)
  .handler(async ({ data }): Promise<EaVideoBackupResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, ok: false };
    const commands: (string | number)[][] = [];
    const chunks = Math.ceil(data.dataUrl.length / CHUNK_SIZE);
    for (let index = 0; index < chunks; index += 1) {
      commands.push(["HSET", VIDEOS_KEY, `${videoId}:${index}`, data.dataUrl.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)]);
    }
    commands.push(["HSET", VIDEOS_KEY, `${videoId}:meta`, JSON.stringify({ chunks, at: new Date().toISOString() })]);
    const results = await pipeline(commands);
    return { enabled: true, ok: results !== null && results.every((item) => !item.error) };
  });

export type EaVideoLoadInput = { videoId: string };
export type EaVideoLoadResult = { enabled: boolean; dataUrl: string | null };

export const syncLoadEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoLoadInput) => data)
  .handler(async ({ data }): Promise<EaVideoLoadResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, dataUrl: null };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, dataUrl: null };
    const results = await pipeline([["HGET", VIDEOS_KEY, `${videoId}:meta`]]);
    const meta = results?.[0]?.result;
    let chunks = 0;
    if (typeof meta === "string") {
      try {
        chunks = (JSON.parse(meta) as { chunks?: number }).chunks ?? 0;
      } catch {
        chunks = 0;
      }
    }
    if (chunks <= 0) return { enabled: true, dataUrl: null };
    const partResults = await pipeline(Array.from({ length: chunks }, (_, index) => ["HGET", VIDEOS_KEY, `${videoId}:${index}`] as (string | number)[]));
    if (!partResults) return { enabled: true, dataUrl: null };
    const parts = partResults.map((item) => (typeof item.result === "string" ? item.result : null));
    if (parts.some((part) => part === null)) return { enabled: true, dataUrl: null };
    return { enabled: true, dataUrl: parts.join("") };
  });

export type EaVideoDeleteInput = { videoId: string };
export type EaVideoDeleteResult = { enabled: boolean; ok: boolean };

export const syncDeleteEaVideo = createServerFn({ method: "POST" })
  .validator((data: EaVideoDeleteInput) => data)
  .handler(async ({ data }): Promise<EaVideoDeleteResult> => {
    if (!cloudSyncConfigured()) return { enabled: false, ok: false };
    const videoId = data.videoId.trim();
    if (videoId.length === 0) return { enabled: true, ok: false };
    // Remove up to a generous chunk count plus meta — HDEL ignores missing fields.
    const fields = [`${videoId}:meta`, ...Array.from({ length: 80 }, (_, index) => `${videoId}:${index}`)];
    const results = await pipeline([["HDEL", VIDEOS_KEY, ...fields] as (string | number)[]]);
    return { enabled: true, ok: results !== null && !results[0]?.error };
  });
