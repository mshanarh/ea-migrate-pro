/**
 * Can the anon key INSERT a users row that already carries a license_key?
 *
 * This decides whether users.license_key can hold the single-use licence lock.
 * UPDATE on that column is blocked (42501), but INSERT is governed by a
 * different policy ("anon can register own email", with check
 * `is_paid = false and is_admin = false`) which says nothing about
 * license_key. If insert can set it, an attacker could plant any key on any
 * row and the lock would be forgeable.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase not configured");
  process.exit(0);
}
const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const svcKey = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const svc = url && svcKey ? createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const victim = "probe.insert@eamigratepro.invalid";

// 1. Plain register (what the app does) then try to set license_key by UPDATE.
const reg = await supabase.from("users").upsert({ email: victim }, { onConflict: "email", ignoreDuplicates: true });
console.log("register (upsert):", reg.error ? `${reg.error.code} ${reg.error.message}` : "ok");

const upd = await supabase.from("users").update({ license_key: "EMP-XXXX-XXXX-XXXX" }).eq("email", victim);
console.log("update license_key:", upd.error ? `BLOCKED ${upd.error.code}` : "ANON CAN UPDATE");

// 2. INSERT a brand-new row that already carries a license_key.
const other = "probe.insert2@eamigratepro.invalid";
const ins = await supabase.from("users").insert({ email: other, license_key: "EMP-YYYY-YYYY-YYYY" });
console.log("insert with license_key:", ins.error ? `BLOCKED ${ins.error.code} ${ins.error.message}` : "ANON CAN INSERT WITH license_key");

// 3. Can anon insert is_paid=true at the same time? (the register policy says no)
const rich = "probe.insert3@eamigratepro.invalid";
const ins2 = await supabase.from("users").insert({ email: rich, is_paid: true });
console.log("insert with is_paid=true:", ins2.error ? `BLOCKED ${ins2.error.code}` : "ANON CAN INSERT is_paid");

if (svc) {
  for (const e of [victim, other, rich]) {
    await svc.from("users").delete().eq("email", e);
  }
  const left = await svc.from("users").select("email").like("email", "probe.%@eamigratepro.invalid");
  console.log("cleaned; remaining:", JSON.stringify(left.data));
}
