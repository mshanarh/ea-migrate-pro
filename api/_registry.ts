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
  "lwethunkandi3@gmail.com",
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
