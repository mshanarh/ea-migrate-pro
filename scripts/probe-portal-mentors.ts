/** Which portal_accounts rows carry licenses/eas, and how big is the table?
 * Projected reads only (never the fat `data`). Structure/lengths only. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const t0 = Date.now();
const { data: all, error: allErr } = await db.from("portal_accounts").select("email").limit(1000);
console.log(`all emails: ${allErr ? "ERR " + allErr.message : `${all?.length} rows`} (${Date.now() - t0}ms)`);

const CANDIDATES = [
  "ntobekotraders.official@gmail.com",
  "biyasentobeko222@gmail.com",
  "eamigratepro@gmail.com",
  "lwethunkandi3@gmail.com",
  "admin@eamigrate.pro",
];
for (const email of CANDIDATES) {
  const { data, error } = await db
    .from("portal_accounts")
    .select("email, data->licenses, data->eas")
    .eq("email", email);
  if (error) {
    console.log(`${email}: ERR ${error.message}`);
    continue;
  }
  const row = (data ?? [])[0] as
    | { email: string; licenses: unknown; eas: unknown }
    | undefined;
  if (!row) {
    console.log(`${email}: NO ROW`);
    continue;
  }
  const licenses = Array.isArray(row.licenses) ? row.licenses : [];
  const eas = Array.isArray(row.eas) ? row.eas : [];
  const licSample = licenses.slice(0, 3).map((lic) => {
    const l = lic as Record<string, unknown>;
    return {
      key: typeof l["key"] === "string" ? (l["key"] as string).slice(0, 8) : null,
      clientEmail: l["clientEmail"] ?? null,
      eaId: l["eaId"] ?? null,
      symbols: Array.isArray(l["symbols"]) ? (l["symbols"] as unknown[]).length : "none",
      image: typeof l["image"] === "string" ? `${(l["image"] as string).length}B` : "none",
    };
  });
  const eaSample = eas.slice(0, 5).map((ea) => {
    const e = ea as Record<string, unknown>;
    return {
      id: e["id"] ?? null,
      name: e["name"] ?? null,
      image: typeof e["image"] === "string" ? `${Math.round((e["image"] as string).length / 1024)}KB` : "none",
      symbols: Array.isArray(e["symbols"]) ? e["symbols"] : "none",
      video: typeof e["video"] === "string" ? `${Math.round((e["video"] as string).length / 1024)}KB` : "none",
    };
  });
  console.log(`${email}: licenses=${licenses.length} ${JSON.stringify(licSample)}`);
  console.log(`${email}: eas=${eas.length} ${JSON.stringify(eaSample)}`);
}
