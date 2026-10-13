/**
 * Where can a registered NAME live? `users` has no name column and there is no
 * DDL path from this project, so the app must write the name into a table that
 * already exists. This probes which candidate tables the PUBLIC anon key can
 * actually write, because the sign-in screen runs in the browser.
 */
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase not configured");
  process.exit(0);
}
const probe = "probe.name@eamigratepro.invalid";

const pa = await supabase.from("portal_accounts").insert({ email: probe, data: JSON.stringify({ firstName: "Probe" }) });
console.log("portal_accounts insert:", pa.error ? `${pa.error.code} ${pa.error.message}` : "ok");
const paRead = await supabase.from("portal_accounts").select("email, data").eq("email", probe).maybeSingle();
console.log("portal_accounts read:", paRead.error ? `${paRead.error.code} ${paRead.error.message}` : JSON.stringify(paRead.data));
if (!paRead.error) {
  const paUpd = await supabase
    .from("portal_accounts")
    .update({ data: JSON.stringify({ firstName: "Probe", lastName: "Two" }) })
    .eq("email", probe);
  console.log("portal_accounts update:", paUpd.error ? `${paUpd.error.code} ${paUpd.error.message}` : "ok");
  const paDel = await supabase.from("portal_accounts").delete().eq("email", probe);
  console.log("portal_accounts delete:", paDel.error ? `${paDel.error.code} ${paDel.error.message}` : "ok");
}

const ma = await supabase.from("mentor_approvals").insert({ email: probe, status: "pending" });
console.log("mentor_approvals insert:", ma.error ? `${ma.error.code} ${ma.error.message}` : "ok");
const maDel = await supabase.from("mentor_approvals").delete().eq("email", probe);
console.log("mentor_approvals delete:", maDel.error ? `${maDel.error.code} ${maDel.error.message}` : "ok");
