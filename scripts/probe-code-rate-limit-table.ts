/**
 * Does `email_code_requests` exist yet, and can this deployment create it?
 *
 * The rate limit the owner asked for is only real if the table behind it is
 * really there. This codebase has already been bitten by assuming otherwise —
 * `purchases` answers PGRST205 and every SQL entry point answers PGRST202 — so
 * the table is checked against the LIVE database before any code is written
 * against it.
 *
 * Read-only apart from creating and dropping its own throwaway table.
 *
 * Run: bun scripts/probe-code-rate-limit-table.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}

const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

const TABLE = "email_code_requests";

/* 1. Does the real table answer a read? */
const { data, error } = await db.from(TABLE).select("*").limit(1);
if (!error) {
  console.log(`EXISTS — ${TABLE} answers a read. Columns:`, Object.keys((data ?? [])[0] ?? {}).join(", ") || "(empty table)");
  process.exit(0);
}
console.log(`MISSING — ${TABLE}: ${error.code} ${error.message}`);

/* 2. Is there any DDL path from here? If there is, the migration can be
 *    applied automatically; if not, the owner runs it in the SQL editor. */
const probe = `probe_code_rate_limit_${Date.now()}`;
const ddl = await db.rpc("exec_sql" as never, { sql: `create table public.${probe} (id int)` } as never);
if (!ddl.error) {
  console.log("DDL PATH AVAILABLE — exec_sql exists.");
  await db.rpc("exec_sql" as never, { sql: `drop table public.${probe}` } as never);
} else {
  console.log(`NO DDL PATH — exec_sql: ${ddl.error.code} ${ddl.error.message}`);
  console.log("=> The owner must run supabase/email-code-rate-limit.sql in the SQL editor.");
}
process.exit(1);
