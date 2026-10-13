/** Diagnostic: can a PROJECTED two-hop read still get EA media out of
 * Supabase while full reads time out?
 *   1. `select email, data->licenses` (projected, no videos) — timed?
 *   2. for rows that mention EAs: `data->eas` for THAT row only — timed,
 *      and how many of those EAs actually carry a picture?
 * Prints sizes/counts only, never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const t0 = Date.now();
const { data: projected, error } = await db
  .from("portal_accounts")
  .select("email, data->licenses")
  .limit(1000);
console.log(
  `STEP1 projected licenses read: ${error ? `ERROR ${error.message}` : `${projected?.length ?? 0} rows`} in ${Date.now() - t0}ms`,
);
if (error || !projected) process.exit(0);

const rows = projected as Array<{ email?: string; licenses?: unknown }>;
const withLicenses = rows.filter(
  (row) => Array.isArray(row.licenses) && (row.licenses as unknown[]).length > 0,
);
console.log(`rows carrying licences: ${withLicenses.length}`);

for (const row of withLicenses.slice(0, 6)) {
  const email = (row.email ?? "").trim().toLowerCase();
  const t1 = Date.now();
  const easRead = await db.from("portal_accounts").select("data->eas").eq("email", email).limit(1);
  const ms = Date.now() - t1;
  if (easRead.error) {
    console.log(`STEP2 eas read for ${email}: ERROR ${easRead.error.message} in ${ms}ms`);
    continue;
  }
  const eas = ((easRead.data ?? [])[0] as { eas?: unknown } | undefined)?.eas;
  const list = Array.isArray(eas) ? (eas as Array<{ name?: string; id?: string; image?: unknown; symbols?: unknown }>) : [];
  const lic = row.licenses as Array<Record<string, unknown>>;
  console.log(
    `STEP2 ${email}: ${ms}ms | eas=${list.length} withImage=${list.filter((e) => typeof e.image === "string" && e.image.length > 0).length}` +
      ` | licenses=${lic.length} withImage=${lic.filter((l) => typeof l.image === "string" && (l.image as string).length > 0).length}`,
  );
  for (const ea of list.slice(0, 5)) {
    console.log(
      `    EA "${ea.name ?? "-"}" id=${ea.id ?? "-"} image=${
        typeof ea.image === "string" && ea.image.length ? `${Math.round(ea.image.length / 1024)}KB` : "NONE"
      } symbols=${Array.isArray(ea.symbols) ? JSON.stringify(ea.symbols).slice(0, 80) : "NONE"}`,
    );
  }
}
