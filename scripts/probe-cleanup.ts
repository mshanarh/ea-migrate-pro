/**
 * Cleanup for probe-anon.ts. The anon key can INSERT and UPDATE app_settings
 * but NOT delete (42501), so the probe row can only be removed with the
 * service role. Run once after probing.
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !key) {
  console.log("no service-role credentials in this shell");
  process.exit(0);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const gone = await db.from("app_settings").delete().like("key", "%@eamigratepro.invalid").select("key");
console.log("app_settings removed:", gone.error ? gone.error.message : JSON.stringify(gone.data));

const left = await db.from("app_settings").select("key").like("key", "%@eamigratepro.invalid");
console.log("remaining probe rows:", JSON.stringify(left.data));

const lk = await db.from("license_keys").delete().like("key", "EMP-PROBE-%").select("key");
console.log("license_keys probe rows:", lk.error ? lk.error.message : JSON.stringify(lk.data));
