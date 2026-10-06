/** Does syncRobotsFromCloudPortal's STEP2 targeted query actually work?
 * Mirrors the exact call: select("email, data").or(`data.ilike.*<client>*`).
 * Full `data` on matched rows is intentional — the sync needs licenses+eas. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const CLIENT = "mpisimlondi@gmail.com"; // a real licence holder from license_keys
const t0 = Date.now();
const { data, error } = await db
  .from("portal_accounts")
  .select("email, data")
  .or(`data.ilike.*${CLIENT}*`);
const ms = Date.now() - t0;
if (error) {
  console.log(`targeted STEP2: ERROR ${error.message} (${ms}ms)`);
} else {
  console.log(`targeted STEP2: ok ${data?.length ?? 0} rows (${ms}ms) emails=${JSON.stringify((data ?? []).map((r) => r.email))}`);
}
