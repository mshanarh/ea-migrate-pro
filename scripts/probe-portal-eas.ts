/** Does ANY portal_accounts row carry EAs (picture+symbols)? Projected read. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const t0 = Date.now();
const { data, error } = await db.from("portal_accounts").select("email, data->eas").limit(500);
if (error) {
  console.log("ERR", error.message);
  process.exit(1);
}
const withEas = (data ?? []).filter((r) => Array.isArray((r as { eas: unknown }).eas) && ((r as { eas: unknown[] }).eas.length > 0));
console.log(`scanned ${(data ?? []).length} rows in ${Date.now() - t0}ms; rows WITH eas: ${withEas.length}`);
for (const r of withEas.slice(0, 10)) {
  const eas = (r as { eas: Array<Record<string, unknown>> }).eas;
  console.log(
    `${r.email}: ${eas.length} EAs ${JSON.stringify(
      eas.slice(0, 6).map((ea) => ({
        id: ea["id"] ?? null,
        name: ea["name"] ?? null,
        image: typeof ea["image"] === "string" ? `${Math.round((ea["image"] as string).length / 1024)}KB` : "none",
        symbols: Array.isArray(ea["symbols"]) ? ea["symbols"] : "none",
      })),
    )}`,
  );
}
