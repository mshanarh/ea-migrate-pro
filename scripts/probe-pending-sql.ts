import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error } = await db.from("email_code_requests").select("*").limit(1);
console.log(`email_code_requests: ${error ? "MISSING — " + error.message.slice(0, 90) : "exists"}`);
