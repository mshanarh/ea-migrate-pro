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

/**
 * THE SOLE ADMIN — the one address the APP's access gate always lets in.
 *
 * Deliberately separate from OWNER_ADMIN_EMAILS below, which governs the ADMIN
 * CONSOLE. Access to the trading app is decided by payment stores for every
 * other address — including the console accounts — so a paid mark (or its
 * absence) is answered by the stores, and only this address bypasses them.
 *
 * `biyasentobeko222@gmail` is the same mailbox typed without the TLD; it is
 * kept so the owner's dotless form also passes.
 */
export const SOLE_ADMIN_EMAILS = ["biyasentobeko222@gmail.com", "biyasentobeko222@gmail"];

/** Case-insensitive exact match against SOLE_ADMIN_EMAILS. */
export function isSoleAdminEmail(email: string): boolean {
  return SOLE_ADMIN_EMAILS.includes(normalizeEmail(email));
}

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

/**
 * WHICH SERVER VARIABLES ARE ACTUALLY PRESENT.
 *
 * Diagnostics used to say "KV is not configured in this build
 * (VITE_KV_REST_HOST missing…)" — a CLIENT-side variable name that was never
 * set and could never authenticate a KV call anyway. This reports the real
 * server names, so an operator can see exactly what the deployment has.
 */
export function storeConfigInfo(): {
  configured: boolean;
  urlVar: string | null;
  tokenVar: string | null;
} {
  const urlVar = process.env["KV_REST_API_URL"]?.trim()
    ? "KV_REST_API_URL"
    : process.env["UPSTASH_REDIS_REST_URL"]?.trim()
      ? "UPSTASH_REDIS_REST_URL"
      : null;
  const tokenVar = process.env["KV_REST_API_TOKEN"]?.trim()
    ? "KV_REST_API_TOKEN"
    : process.env["KV_REST_API_READ_ONLY_TOKEN"]?.trim()
      ? "KV_REST_API_READ_ONLY_TOKEN"
      : process.env["UPSTASH_REDIS_REST_TOKEN"]?.trim()
        ? "UPSTASH_REDIS_REST_TOKEN"
        : null;
  return { configured: Boolean(urlVar && tokenVar), urlVar, tokenVar };
}

/**
 * READ-ONLY KV COMMAND — uses the read-only token when the write token is not
 * present in this deployment, so a diagnostic read never needs write rights.
 */
export async function kvRead(command: (string | number)[]): Promise<unknown> {
  const url = (process.env["KV_REST_API_URL"] ?? process.env["UPSTASH_REDIS_REST_URL"] ?? "").trim().replace(/\/+$/, "");
  const token = (
    process.env["KV_REST_API_TOKEN"] ??
    process.env["KV_REST_API_READ_ONLY_TOKEN"] ??
    process.env["UPSTASH_REDIS_REST_TOKEN"] ??
    ""
  ).trim();
  if (!url || !token) {
    throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set on the server");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error ?? `Storage error ${response.status}`);
  return payload.result;
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

/** Admin-CONSOLE rights (registrations, approvals, media). Not app access. */
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
 * CLEAR THE DEVICE BINDING — and NOTHING ELSE.
 *
 * The portal's Re-activate Client action is a device unbind, so it must not be
 * able to touch payment, the licence limit or the EA config that live in the
 * same record. The record is read, ONLY `deviceId` is set to null, and the
 * record is written back; every other field travels untouched. Returns the
 * previous binding so the caller can log what was released.
 */
export async function clearDeviceIdForEmail(email: string): Promise<string | null> {
  const registration = await getRegistration(email);
  if (!registration) return null;
  const previous = registration.deviceId ?? null;
  await saveRegistration({ ...registration, deviceId: null });
  return previous;
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
