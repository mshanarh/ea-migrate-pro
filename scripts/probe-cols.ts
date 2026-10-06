/**
 * Live column probe — asks the real database what columns each table actually
 * has. PostgREST answers 42703 with the offending column named, so this is how
 * we tell "the column does not exist" apart from "the app is broken" before
 * writing any query against it.
 */
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase not configured");
  process.exit(0);
}

const tables = ["users", "license_keys", "mentor_approvals", "portal_accounts", "app_settings", "paid_emails", "user_sessions"];

for (const table of tables) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  if (error) {
    console.log(`${table}: ERR ${error.code} ${error.message}`);
    continue;
  }
  const row = (data as Record<string, unknown>[])[0] ?? {};
  console.log(`${table}: ${Object.keys(row).join(", ") || "(empty)"}`);
}

// Does license_keys carry any activation ledger already?
const { data: keys, error: keyErr } = await supabase.from("license_keys").select("*").limit(2);
console.log("license_keys sample:", keyErr ? keyErr.message : JSON.stringify(keys).slice(0, 400));
