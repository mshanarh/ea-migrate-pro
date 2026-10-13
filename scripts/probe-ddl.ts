/**
 * Can this project run DDL itself? The single-use licence lock and the emailed
 * activation code both need columns/tables that do not exist yet. Before asking
 * the owner to paste SQL into the Supabase dashboard, check whether any RPC
 * here can execute statements.
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !key) {
  console.log("no service-role credentials in this shell");
  process.exit(0);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const candidates = ["exec_sql", "execute_sql", "run_sql", "sql", "exec", "admin_exec_sql"];
for (const fn of candidates) {
  const { error } = await db.rpc(fn, { sql: "select 1" } as never);
  console.log(`${fn}: ${error ? `${error.code} ${error.message}` : "AVAILABLE"}`);
}
