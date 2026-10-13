/** What tables/columns exist for EA media, and how heavy is portal_accounts? */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
async function q(label: string, p: PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>) {
  const { data, error, count } = await p;
  console.log(label + ":", error ? "ERROR " + error.message : `ok ${count ?? ""} ${JSON.stringify(data ?? "").slice(0, 260)}`);
}
await q("portal_accounts count", db.from("portal_accounts").select("*", { count: "exact", head: true }));
await q("eas", db.from("eas").select("id, name, image_url, symbols, mentor_id").limit(3));
await q("host_robot_keys", db.from("host_robot_keys").select("key_code, ea_id, is_used").limit(3));
await q("license_keys sample", db.from("license_keys").select("*").limit(2));
await q("light portal rows", db.from("portal_accounts").select("email, length(data)").limit(5));
