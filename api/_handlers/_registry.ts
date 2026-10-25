/**
 * Shared server-side registration store for /api/register, /api/admin-users
 * and /api/admin-approve. Records live in Vercel KV / Upstash Redis (REST),
 * keyed by email in one hash: `eamp:registrations` → field = email, value = JSON.
 * Underscore prefix keeps Vercel from exposing this file as a route.
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";

export type ApprovalState = "pending" | "approved" | "rejected";

export type Registration = {
  email: string;
  firstName: string;
  displayName: string;
  username: string;
  whatsapp: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  status: ApprovalState;
  isPaid: boolean;
  paidAt: string | null;
  licenseLimit: number;
  /**
   * TRUE ONLY WHEN THE ADMIN PRESSED "Save limit".
   *
   * `licenseLimit: 0` is the default of every record this store creates (an
   * approval, a payment change, a future device bind), so it cannot be read as
   * "the admin allowed zero keys" — that would lock every freshly approved
   * mentor out of key creation, which is the dead end the dashboard explicitly
   * falls back to 2000 keys to avoid. The limit counts only when this flag says
   * the number was chosen on purpose ("Save limit" with 0 IS a deliberate
   * block, and it is honoured).
   */
  licenseLimitSet?: boolean;
  /** Device Id this email is bound to (from the app's sign-in flow). Null = not bound. */
  deviceId?: string | null;
  /**
   * May this account release a client's device? Locked unless an admin turned
   * it on (the 🔒 next to Approve). Admins and owners are always unlocked.
   */
  reactivationEnabled?: boolean;
  /**
   * CONSOLE ADMIN — written only by "Make Admin". The fixed OWNER_ADMIN_EMAILS
   * list and ADMIN_EMAILS still identify platform admins without a record, so
   * the owner can always get in; this flag lets an admin promote somebody the
   * list has never heard of. It is a ROLE, never a payment receipt.
   */
  isAdmin?: boolean;
};

/** What the admin console receives — never the password hash/salt. */
export type PublicRegistration = Omit<Registration, "passwordHash" | "passwordSalt">;

export type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
export type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

const HASH_KEY = "eamp:registrations";

const OWNER_ADMIN_EMAILS = [
  "biyasentobeko222@gmail.com",
  "biyasentobeko222@gmail",
  "admin@eamigrate.pro",
  "ntobekotraders.official@gmail.com",
];

function kvConfig() {
  const url = (process.env["KV_REST_API_URL"] ?? process.env["UPSTASH_REDIS_REST_URL"] ?? "").trim().replace(/\/+$/, "");
  const token = (process.env["KV_REST_API_TOKEN"] ?? process.env["UPSTASH_REDIS_REST_TOKEN"] ?? "").trim();
  return url && token ? { url, token } : null;
}

export function storeConfigured(): boolean {
  return kvConfig() !== null;
}

async function kv(command: (string | number)[]): Promise<unknown> {
  const config = kvConfig();
  if (!config) throw new Error("Registration storage is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error ?? `Storage error ${response.status}`);
  return payload.result;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAdminEmail(email: string): boolean {
  const extra = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return OWNER_ADMIN_EMAILS.includes(email) || extra.includes(email);
}

export function adminFromRequest(request: ApiRequest): string | null {
  const raw = request.headers?.["x-admin-email"];
  const email = normalizeEmail(Array.isArray(raw) ? raw[0] : raw);
  return email && isAdminEmail(email) ? email : null;
}

export function parseBody(request: ApiRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return { hash, salt };
}

export async function getRegistration(email: string): Promise<Registration | null> {
  const raw = await kv(["HGET", HASH_KEY, email]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as Registration;
  } catch {
    return null;
  }
}

/** Writes only when the email is new. Returns false when it already exists. */
export async function createRegistration(record: Registration): Promise<boolean> {
  const result = await kv(["HSETNX", HASH_KEY, record.email, JSON.stringify(record)]);
  return Number(result) === 1;
}

export async function saveRegistration(record: Registration): Promise<void> {
  await kv(["HSET", HASH_KEY, record.email, JSON.stringify({ ...record, updatedAt: new Date().toISOString() })]);
}

export async function listRegistrations(): Promise<PublicRegistration[]> {
  const raw = await kv(["HVALS", HASH_KEY]);
  const rows: PublicRegistration[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") continue;
    try {
      rows.push(toPublic(JSON.parse(item) as Registration));
    } catch {
      /* skip corrupted record */
    }
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function toPublic(record: Registration): PublicRegistration {
  const { passwordHash: _hash, passwordSalt: _salt, ...rest } = record;
  return rest;
}

/** Get the device Id bound to this email, or null if not bound. */
export async function getDeviceIdForEmail(email: string): Promise<string | null> {
  const registration = await getRegistration(email);
  return registration?.deviceId ?? null;
}

/** Bind this email to a device Id in Upstash. */
export async function setDeviceIdForEmail(email: string, deviceId: string): Promise<void> {
  const registration = await getRegistration(email);
  if (registration) {
    registration.deviceId = deviceId;
    await saveRegistration(registration);
  } else {
    // Create a minimal record for device tracking if none exists
    const now = new Date().toISOString();
    await saveRegistration({
      email,
      firstName: "",
      displayName: "",
      username: "",
      whatsapp: "",
      passwordHash: "",
      passwordSalt: "",
      createdAt: now,
      updatedAt: now,
      status: "pending",
      isPaid: false,
      paidAt: null,
      licenseLimit: 0,
      deviceId,
    });
  }
}

/**
 * WRITE ONE FIELD OF AN EXISTING RECORD, leaving everything else intact.
 *
 * Every mutation below goes through here so a payment write can never rewrite
 * a mentor's licence limit, a device bind can never clear a payment flag, and
 * a reactivation can never touch an expiry. Returns false when there is no
 * record to patch — a write that matched nothing is not a success.
 */
async function patchRegistration(
  email: string,
  patch: Partial<Registration>,
): Promise<{ ok: boolean; record: Registration | null }> {
  const existing = await getRegistration(email);
  if (!existing) return { ok: false, record: null };
  const next: Registration = { ...existing, ...patch, email: existing.email, updatedAt: new Date().toISOString() };
  await saveRegistration(next);
  return { ok: true, record: next };
}

/**
 * MARK AN ACCOUNT PAID / UNPAID — the admin console's "Mark paid".
 *
 * `paidAt` is the receipt and `isPaid` follows it, EXCEPT for an explicit
 * revocation, which writes `isPaid: false, paidAt: null` (the marker the access
 * check reads as "revoked" rather than "never paid").
 */
export async function setPaidStatus(
  email: string,
  paid: boolean,
): Promise<{ ok: boolean; error?: string; record?: Registration }> {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, error: "email is required" };
  const existing = await getRegistration(address);
  if (!existing) {
    return { ok: false, error: "That email is not registered — it must sign up before it can be marked paid." };
  }
  const paidAt = paid ? new Date().toISOString() : null;
  const patched = await patchRegistration(address, { isPaid: paid, paidAt });
  return patched.ok && patched.record ? { ok: true, record: patched.record } : { ok: false, error: "The record could not be written" };
}

/**
 * HOW MANY ADMINS EXIST — the owner-bootstrap question, answered from KV.
 * The fixed allowlist counts as admins even with no record, because those
 * emails already have console access.
 */
export async function countAdmins(): Promise<number> {
  const rows = await listRegistrations();
  return rows.filter((row) => row.isAdmin === true || isAdminEmail(row.email)).length;
}

/** ADMIN ROLE — a role is not a receipt: this never changes payment. */
export async function setAdminFlag(email: string, admin: boolean): Promise<{ ok: boolean; error?: string }> {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, error: "email is required" };
  const patched = await patchRegistration(address, { isAdmin: admin });
  return patched.ok ? { ok: true } : { ok: false, error: "That email is not registered" };
}

/** The 🔒 toggle: may this account release a client's device? */
export async function setReactivationFlag(
  email: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, error: "email is required" };
  const patched = await patchRegistration(address, { reactivationEnabled: enabled });
  return patched.ok ? { ok: true } : { ok: false, error: "That email is not registered" };
}

/**
 * CLEAR ONLY THE DEVICE BINDING.
 *
 * Payment, `paidAt`, licence limit, approval status, EA config and the licence
 * keys themselves are all left exactly as they were — releasing a device is a
 * device action, not a subscription action. Returns the record so the caller
 * can prove the payment flag survived.
 */
export async function clearDeviceBinding(
  email: string,
): Promise<{ ok: boolean; error?: string; clearedAt?: string; record?: Registration }> {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, error: "email is required" };
  const patched = await patchRegistration(address, { deviceId: null });
  if (!patched.ok) return { ok: false, error: "That email is not registered" };
  return {
    ok: true,
    clearedAt: new Date().toISOString(),
    ...(patched.record ? { record: patched.record } : {}),
  };
}

/**
 * THE RAW REDIS COMMAND RUNNER, for the OTHER KV-backed stores in /api.
 *
 * Every record that used to live in a Supabase table now lives here instead:
 * registrations + approval + payment + licence limit already do (see the file
 * header), and the ISSUED LICENCE KEYS joined them so key generation and key
 * activation stop depending on a database that answers "exceed_egress_quota".
 * `api/_handlers/licenses.ts` uses this.
 *
 * Exported rather than duplicated on purpose: the URL/token pair, the 10s
 * timeout and the error shape are the parts that must never drift between
 * stores — a second copy is how one store silently keeps talking to an old
 * endpoint after the credentials are rotated.
 */
export function kvCommand(command: (string | number)[]): Promise<unknown> {
  return kv(command);
}
