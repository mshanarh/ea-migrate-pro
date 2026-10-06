/**
 * What can the PUBLIC anon key actually do here?
 *
 * There is no DDL path from this project (see probe-ddl), so anything the app
 * needs to persist has to live in a table the anon key can already write. This
 * probe writes one throwaway key, reads it back, then deletes it, so the
 * single-use licence lock and the activation code can be built on facts rather
 * than on the grants in supabase/*.sql (which have drifted from the live DB
 * before — the live table has columns the committed schema never declares).
 */
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase not configured");
  process.exit(0);
}

const probeKey = "probe:anon-capability-check@eamigratepro.invalid";

const read = await supabase.from("app_settings").select("key, value, updated_at").eq("key", probeKey).maybeSingle();
console.log("select:", read.error ? `${read.error.code} ${read.error.message}` : JSON.stringify(read.data));

const ins = await supabase.from("app_settings").insert({ key: probeKey, value: "probe-1" });
console.log("insert:", ins.error ? `${ins.error.code} ${ins.error.message}` : "ok");

const upd = await supabase.from("app_settings").update({ value: "probe-2" }).eq("key", probeKey);
console.log("update:", upd.error ? `${upd.error.code} ${upd.error.message}` : "ok");

const after = await supabase.from("app_settings").select("value").eq("key", probeKey).maybeSingle();
console.log("after update:", after.error ? after.error.message : JSON.stringify(after.data));

const del = await supabase.from("app_settings").delete().eq("key", probeKey);
console.log("delete:", del.error ? `${del.error.code} ${del.error.message}` : "ok");

const gone = await supabase.from("app_settings").select("key").eq("key", probeKey).maybeSingle();
console.log("after delete:", gone.error ? gone.error.message : JSON.stringify(gone.data));

// license_keys: can the anon key write the columns a single-use lock needs?
const lockKey = "EMP-PROBE-LOCK-TEST-0000";
const lkIns = await supabase.from("license_keys").insert({ key: lockKey, email: "probe@eamigratepro.invalid" });
console.log("license_keys insert:", lkIns.error ? `${lkIns.error.code} ${lkIns.error.message}` : "ok");
const lkRead = await supabase.from("license_keys").select("*").eq("key", lockKey).maybeSingle();
console.log("license_keys read:", lkRead.error ? lkRead.error.message : JSON.stringify(lkRead.data));
const lkUpd = await supabase.from("license_keys").update({ email: "probe2@eamigratepro.invalid" }).eq("key", lockKey);
console.log("license_keys update:", lkUpd.error ? `${lkUpd.error.code} ${lkUpd.error.message}` : "ok");
const lkDel = await supabase.from("license_keys").delete().eq("key", lockKey);
console.log("license_keys delete:", lkDel.error ? `${lkDel.error.code} ${lkDel.error.message}` : "ok");
