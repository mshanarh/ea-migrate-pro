/** Does portal_accounts.updated_at have a DEFAULT?
 * Insert omits BOTH email (not-null) and updated_at. No row can be created.
 * If the error names `email` first → updated_at has a default (or is
 * nullable): portalUpsertLicense's {email,data}-only upsert is fine.
 * If it names `updated_at` → THAT is why license pushes never landed. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error } = await db.from("portal_accounts").insert({ data: "{}" });
console.log("insert without email+updated_at →", error ? `${error.code} ${error.message}` : "UNEXPECTED SUCCESS");
// Which column has a default? Ask PostgREST for a row's updated_at value.
const { data, error: e2 } = await db.from("portal_accounts").select("updated_at").not("updated_at", "is", null).limit(1);
console.log("rows with updated_at set:", e2 ? `ERR ${e2.message}` : JSON.stringify(data));
