/** Diagnostic: settle (a) is portal_accounts.data text or json/jsonb?
 * (b) are there duplicate rows per email? (c) does a `like` scan work?
 * Prints types, counts and short prefixes only — never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const TARGET = "ntobekotraders.official@gmail.com";

// (b) duplicates?
const { data: all } = await db.from("portal_accounts").select("email").limit(1000);
const counts = new Map<string, number>();
for (const row of (all ?? []) as Array<{ email?: string }>) {
  const key = String(row.email ?? "").toLowerCase();
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log(`total rows=${(all ?? []).length} distinct=${counts.size} | ${TARGET}: ${counts.get(TARGET) ?? 0} rows`);

// (a1) json projection — error or null?
const t1 = Date.now();
const projected = await db.from("portal_accounts").select("data->eas").eq("email", TARGET).limit(1);
const cell1 = ((projected.data ?? []) as Array<Record<string, unknown>>)[0];
console.log(
  `data->eas : error=${projected.error ? projected.error.message : "none"} in ${Date.now() - t1}ms | type=${
    cell1 && "eas" in cell1 ? typeof cell1["eas"] : "no-eas-key"
  } | keys=${cell1 ? Object.keys(cell1).join("|") : "none"}`,
);

// (a2) the raw column — string or object?
const t2 = Date.now();
const raw = await db.from("portal_accounts").select("data").eq("email", TARGET).limit(1);
const cell2 = ((raw.data ?? []) as Array<Record<string, unknown>>)[0];
const value = cell2 ? cell2["data"] : undefined;
const prefix = typeof value === "string" ? value.slice(0, 60) : JSON.stringify(value ?? null).slice(0, 60);
console.log(
  `data raw : error=${raw.error ? raw.error.message : "none"} in ${Date.now() - t2}ms | typeof=${typeof value} | prefix=${prefix}`,
);

// (c) does a text `like` predicate on the column work?
const t3 = Date.now();
const liked = await db.from("portal_accounts").select("email").like("data", "%Sniper killer%").limit(50);
console.log(
  `like scan: error=${liked.error ? liked.error.message : "none"} in ${Date.now() - t3}ms | rows=${
    ((liked.data ?? []) as unknown[]).length
  } | emails=${((liked.data ?? []) as Array<{ email?: string }>).map((r) => r.email).join(",")}`,
);
