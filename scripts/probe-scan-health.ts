/** Health of the ONE query /api/ea-media phase 1 depends on.
 * Runs the cheap candidate scan (emails only) three times in a row, alone,
 * and reports success/latency — never row contents. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const NEEDLES = ["Sniper killer Ea v2+", "biyasentobeko222@gmail.com", "ea-muvcexrvvlhvbe"];
for (const needle of NEEDLES) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    const { data, error } = await db
      .from("portal_accounts")
      .select("email")
      .ilike("data", `%${needle}%`)
      .limit(6)
      .abortSignal(AbortSignal.timeout(8_000));
    console.log(
      `attempt ${attempt} "${needle}": ${error ? `ERROR ${error.message}` : `${(data ?? []).length} rows`} in ${Date.now() - started}ms`,
    );
  }
}
