import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PortalStatus } from "@/lib/auth-store";

/**
 * TEMPORARY one-time migration bridge (Upstash → Supabase).
 *
 * The old admin console mirrored mentor records into an Upstash Redis hash
 * (`eamp:accounts`) — 44 registrations lived there before the Supabase
 * cutover. This module reads that legacy store (while UPSTASH_REDIS_REST_URL
 * and UPSTASH_REDIS_REST_TOKEN still exist in the environment), previews
 * every record, and on confirmation writes each email into Supabase:
 *
 *   mentor_approvals — { email, status } (the authoritative approval index)
 *   portal_accounts  — full record JSON when the hash row carries one
 *
 * Both are UP- inserts: existing Supabase rows are never downgraded, so
 * running the migration twice is safe.
 */

const UPSTASH_URL = (process.env["UPSTASH_REDIS_REST_URL"] ?? process.env["KV_REST_API_URL"] ?? "").trim().replace(/\/+$/, "");
const UPSTASH_TOKEN = (process.env["UPSTASH_REDIS_REST_TOKEN"] ?? process.env["KV_REST_API_TOKEN"] ?? "").trim();
const ACCOUNTS_KEY = "eamp:accounts";

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();

function upstashConfigured(): boolean {
  return UPSTASH_URL.length > 0 && UPSTASH_TOKEN.length > 0;
}

function supabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Runs one Redis REST command. Returns null when Upstash is unreachable. */
async function redisCommand(command: (string | number)[]): Promise<{ result?: unknown; error?: string } | null> {
  if (!upstashConfigured()) return null;
  try {
    const response = await fetch(`${UPSTASH_URL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { result?: unknown; error?: string };
  } catch {
    return null;
  }
}

export type MigrateSourceRow = {
  email: string;
  status: PortalStatus;
  role: string;
  /** Mentors the old store knew: licenses and EAs counts for the preview. */
  licenses: number;
  eas: number;
  /** Full record JSON from the old store — carried over on migrate. */
  raw?: string;
  alreadyInSupabase: boolean;
  alreadyApproved: boolean;
};

export type MigratePreviewResult = {
  upstashConfigured: boolean;
  supabaseConfigured: boolean;
  rows: MigrateSourceRow[];
  error?: string;
};

function parseStatus(value: unknown): PortalStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/** Normalises any stored record into a preview row. */
function toRow(email: string, raw: unknown, existing: Set<string>, approved: Set<string>): MigrateSourceRow {
  let status: PortalStatus = "pending";
  let role = "mentor";
  let licenses = 0;
  let eas = 0;
  let rawJson: string | undefined;
  const clean = email.trim().toLowerCase();

  if (typeof raw === "string" && raw.length > 0) {
    rawJson = raw;
    try {
      const parsed = JSON.parse(raw) as {
        status?: unknown;
        role?: unknown;
        licenses?: unknown[];
        eas?: unknown[];
      };
      status = parseStatus(parsed.status);
      role = typeof parsed.role === "string" ? parsed.role : "mentor";
      licenses = Array.isArray(parsed.licenses) ? parsed.licenses.length : 0;
      eas = Array.isArray(parsed.eas) ? parsed.eas.length : 0;
    } catch {
      /* keep defaults */
    }
  }

  return {
    email: clean,
    status,
    role,
    licenses,
    eas,
    ...(rawJson !== undefined ? { raw: rawJson } : {}),
    alreadyInSupabase: existing.has(clean),
    alreadyApproved: approved.has(clean),
  };
}

/** Preview — reads the whole legacy hash and diff against Supabase. */
export const migratePreview = createServerFn({ method: "GET" }).handler(
  async (): Promise<MigratePreviewResult> => {
    if (!supabaseConfiguredEnv()) {
      return { upstashConfigured: upstashConfigured(), supabaseConfigured: false, rows: [], error: "Supabase env vars are missing — cannot migrate." };
    }
    if (!upstashConfigured()) {
      return { upstashConfigured: false, supabaseConfigured: true, rows: [], error: "Upstash env vars are gone — the legacy store can no longer be read." };
    }

    const client = supabase();
    if (!client) return { upstashConfigured: true, supabaseConfigured: false, rows: [], error: "Supabase client failed." };

    const read = await redisCommand(["HGETALL", ACCOUNTS_KEY]);
    if (!read || read.error) {
      return { upstashConfigured: true, supabaseConfigured: true, rows: [], error: `Upstash read failed: ${read?.error ?? "unreachable"}` };
    }

    const records = (read.result ?? {}) as Record<string, unknown>;
    const [{ data: existingRows }, { data: approvalRows }] = await Promise.all([
      client.from("portal_accounts").select("email"),
      client.from("mentor_approvals").select("email, status").in("status", ["approved"]),
    ]);
    const existing = new Set((existingRows ?? []).map((row) => row.email.toLowerCase()));
    const approved = new Set((approvalRows ?? []).map((row) => row.email.toLowerCase()));

    const rows = Object.entries(records)
      .filter(([email]) => typeof email === "string" && email.includes("@"))
      .map(([email, raw]) => toRow(email, raw, existing, approved))
      .sort((a, b) => a.email.localeCompare(b.email));

    return { upstashConfigured: true, supabaseConfigured: true, rows };
  },
);

function supabaseConfiguredEnv(): boolean {
  return SUPABASE_URL.length > 0 && SERVICE_ROLE.length > 0;
}

export type MigrateRunResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/**
 * Runs the migration: every previewed email is upserted into
 * mentor_approvals with its legacy status, and full portal_accounts rows
 * are restored when the old record carries one. Existing Supabase data is
 * never overwritten with a worse state (approved stays approved).
 */
export const migrateRun = createServerFn({ method: "POST" }).handler(
  async (): Promise<MigrateRunResult> => {
    const result: MigrateRunResult = { ok: true, inserted: 0, skipped: 0, failed: 0, errors: [] };
    const client = supabase();
    if (!client) {
      result.ok = false;
      result.errors.push("Supabase env vars are missing.");
      return result;
    }
    if (!upstashConfigured()) {
      result.ok = false;
      result.errors.push("Upstash env vars are missing — nothing to read.");
      return result;
    }

    const read = await redisCommand(["HGETALL", ACCOUNTS_KEY]);
    const records = (read?.result ?? {}) as Record<string, unknown>;
    const entries = Object.entries(records).filter(([email]) => typeof email === "string" && email.includes("@"));
    if (entries.length === 0) {
      result.ok = false;
      result.errors.push("The legacy store returned no records.");
      return result;
    }

    for (const [email, raw] of entries) {
      const clean = email.trim().toLowerCase();
      try {
        // Status comes from the legacy record when it parses; default pending.
        let status: PortalStatus = "pending";
        let accountJson: string | undefined;
        if (typeof raw === "string" && raw.length > 0) {
          accountJson = raw;
          try {
            status = parseStatus((JSON.parse(raw) as { status?: unknown }).status);
          } catch {
            /* keep pending */
          }
        }

        // mentor_approvals: INSERT-if-missing so a decision made AFTER the old
        // store was frozen (e.g. approved in Supabase since) is never undone.
        const { data: current } = await client
          .from("mentor_approvals")
          .select("status")
          .eq("email", clean)
          .maybeSingle();
        if (current?.status) {
          result.skipped += 1;
        } else {
          const { error } = await client
            .from("mentor_approvals")
            .upsert({ email: clean, status }, { onConflict: "email" });
          if (error) {
            result.failed += 1;
            result.errors.push(`${clean}: ${error.message}`);
            continue;
          }
          result.inserted += 1;
        }

        // portal_accounts: only when the legacy record exists AND Supabase
        // has none — a live Supabase record always wins.
        if (accountJson) {
          const { data: accountRow } = await client
            .from("portal_accounts")
            .select("email")
            .eq("email", clean)
            .maybeSingle();
          if (!accountRow) {
            const { error } = await client.from("portal_accounts").upsert({
              email: clean,
              data: accountJson,
              updated_at: new Date().toISOString(),
            }, { onConflict: "email" });
            if (error) result.errors.push(`${clean} (account copy): ${error.message}`);
          }
        }
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${clean}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    result.ok = result.failed === 0;
    return result;
  },
);
