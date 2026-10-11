/** Diagnostic: which Supabase tables still answer, what columns do they
 * carry, and do any of them link a client to an EA picture?
 * Prints column names and sizes only — never image bytes, never secrets. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
const service = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const svcClient = service ? createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
console.log(`service role available: ${svcClient ? "yes" : "no"}`);

function summarise(label: string, rows: unknown, ms: number): void {
  const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  console.log(`${label}: ${list.length} rows in ${ms}ms`);
  if (list.length === 0) return;
  const columns = Object.keys(list[0]);
  console.log(`  columns: ${columns.join(" | ")}`);
  for (const row of list.slice(0, 2)) {
    const sizes = columns
      .map((col) => {
        const value = row[col];
        if (typeof value === "string") return `${col}:str(${value.length})`;
        if (value === null) return `${col}:null`;
        return `${col}:${Array.isArray(value) ? `arr(${value.length})` : typeof value}`;
      })
      .join(", ");
    console.log(`  row: ${sizes}`);
  }
}

async function probe(client: typeof anonClient, label: string, table: string): Promise<void> {
  const t = Date.now();
  const { data, error } = await client.from(table).select("*").limit(2);
  if (error) console.log(`${label}: ERROR ${error.message} in ${Date.now() - t}ms`);
  else summarise(label, data, Date.now() - t);
}

await probe(anonClient, "anon mentor_approvals", "mentor_approvals");
await probe(anonClient, "anon license_keys", "license_keys");
await probe(anonClient, "anon users", "users");
await probe(anonClient, "anon paid_emails", "paid_emails");
if (svcClient) {
  await probe(svcClient, "svc license_keys", "license_keys");
}
