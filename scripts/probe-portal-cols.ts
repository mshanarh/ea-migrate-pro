import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data, error } = await db.from("portal_accounts").select("*").limit(1);
if (error) console.log("ERR", error.message);
else console.log("portal_accounts columns:", data && data.length ? Object.keys(data[0]).join(", ") : "(no rows)");
