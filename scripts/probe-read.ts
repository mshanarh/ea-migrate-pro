/**
 * Which tables can the PUBLIC anon key READ?
 *
 * A six-digit activation code is only as strong as the place it is stored: if
 * the anon key can read the column, so can anybody with the (public) anon key,
 * and a million SHA-256 guesses is not a defence. This probe answers that per
 * table so the code can be stored in the least-readable table available.
 */
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase not configured");
  process.exit(0);
}

const tables = ["users", "license_keys", "mentor_approvals", "portal_accounts", "app_settings", "paid_emails", "user_sessions", "app_messages"];
for (const table of tables) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  console.log(`${table}: ${error ? `DENIED ${error.code}` : `READABLE (${(data as unknown[]).length} row sampled)`}`);
}
