/** Can anon INSERT into portal_accounts at all?
 * The insert intentionally omits the required `email` column, so NO ROW can
 * ever be created. The ERROR TEXT tells us which check fired first:
 *   "violates row-level security"       → RLS blocks anon writes (THE bug)
 *   "null value in column email"        → RLS PASSED; anon writes allowed */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error } = await db.from("portal_accounts").insert({ data: "{}" });
console.log("insert without email →", error ? `${error.code ?? ""} ${error.message}` : "UNEXPECTED SUCCESS (no row should exist — check table!)");
