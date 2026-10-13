/**
 * THE CRITICAL QUESTION for two features: which tables can the PUBLIC anon key
 * UPDATE?
 *
 * The activation code and the single-use licence lock are both security records.
 * If anon can write the table they live in, a customer can pre-write their own
 * "correct" value and walk straight past the check — anon having UPDATE on
 * app_settings and license_keys is exactly that hole. Anything the service role
 * writes must go somewhere anon cannot update.
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

// Seed one real row per table with the SERVICE role, then try to UPDATE it
// with the ANON key. If anon can update it, that table cannot hold a
// security-critical record.
const email = "probe.write@eamigratepro.invalid";

if (svc) {
  await svc.from("users").upsert({ email, is_paid: false, is_admin: false }, { onConflict: "email" });
  await svc.from("mentor_approvals").upsert({ email, status: "pending" }, { onConflict: "email" });
  await svc.from("paid_emails").upsert({ email, paid_at: null }, { onConflict: "email" });
  await svc.from("app_settings").upsert({ key: `probe:write:${email}`, value: "seed", updated_at: new Date().toISOString() }, { onConflict: "key" });
  await svc.from("license_keys").upsert({ key: "EMP-PROBE-WRITE-0000", email }, { onConflict: "key" });
  await svc.from("user_sessions").insert({ email, license_key: null });
  console.log("seeded via service role");
}

const attempts: Array<[string, () => Promise<{ error: { code: string; message: string } | null }>]> = [
  ["users.device_id", () => supabase.from("users").update({ device_id: "anon-probe" }).eq("email", email)],
  ["users.license_key", () => supabase.from("users").update({ license_key: "ANON-KEY" }).eq("email", email)],
  ["users.is_paid", () => supabase.from("users").update({ is_paid: true }).eq("email", email)],
  ["mentor_approvals.status", () => supabase.from("mentor_approvals").update({ status: "approved" }).eq("email", email)],
  ["paid_emails.paid_at", () => supabase.from("paid_emails").update({ paid_at: new Date().toISOString() }).eq("email", email)],
  ["app_settings.value", () => supabase.from("app_settings").update({ value: "anon" }).eq("key", `probe:write:${email}`)],
  ["license_keys.email", () => supabase.from("license_keys").update({ email: "anon@eamigratepro.invalid" }).eq("key", "EMP-PROBE-WRITE-0000")],
  ["user_sessions.license_key", () => supabase.from("user_sessions").update({ license_key: "ANON" }).eq("email", email)],
];

for (const [label, run] of attempts) {
  const { error } = await run();
  console.log(`${label}: ${error ? `BLOCKED ${error.code}` : "ANON CAN UPDATE"}`);
}

if (svc) {
  for (const t of [
    () => svc.from("users").delete().eq("email", email),
    () => svc.from("mentor_approvals").delete().eq("email", email),
    () => svc.from("paid_emails").delete().eq("email", email),
    () => svc.from("app_settings").delete().eq("key", `probe:write:${email}`),
    () => svc.from("license_keys").delete().eq("key", "EMP-PROBE-WRITE-0000"),
    () => svc.from("user_sessions").delete().eq("email", email),
  ]) {
    await t();
  }
  console.log("cleaned up");
}
