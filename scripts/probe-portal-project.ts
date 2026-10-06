/** Can we read portal_accounts CHEAPLY by projecting only the JSON we need?
 * PostgREST supports `data->licenses` / `data->eas` horizontal projection —
 * if these answer inside the statement timeout, activation can resolve the
 * picture+symbols without ever downloading the inline base64 videos. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
async function timed(label: string, run: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  const start = Date.now();
  const { data, error } = await run();
  const ms = Date.now() - start;
  if (error) return console.log(`${label}: ERROR ${error.message} (${ms}ms)`);
  const rows = Array.isArray(data) ? data : [];
  console.log(`${label}: ok ${rows.length} rows (${ms}ms) sample=${JSON.stringify(rows[0] ?? null).slice(0, 200)}`);
}
await timed("emails only", () => db.from("portal_accounts").select("email").limit(100));
await timed("licenses projected", () => db.from("portal_accounts").select("email, data->licenses").limit(100));
await timed("emails eq filter", () =>
  db.from("portal_accounts").select("email, data->licenses").eq("email", "biyasentobeko222@gmail.com"),
);
