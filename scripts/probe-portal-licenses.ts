/** Which portal_accounts rows hold licenses / EAs at all? (projected, cheap) */
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  (process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const t0 = Date.now();
const { data: rows, error } = await db
  .from("portal_accounts")
  .select("email, data->licenses")
  .limit(500);
if (error) {
  console.log("ERR", error.message);
  process.exit(1);
}
const withLic = (rows ?? []).filter((r) => Array.isArray((r as { licenses: unknown }).licenses) && ((r as { licenses: unknown[] }).licenses.length > 0));
console.log(`scanned ${rows?.length} rows in ${Date.now() - t0}ms; rows WITH licenses: ${withLic.length}`);
for (const r of withLic) {
  const lic = (r as { licenses: Array<Record<string, unknown>> }).licenses;
  console.log(
    `${r.email}: ${lic.length} licenses → ${JSON.stringify(
      lic.slice(0, 4).map((l) => ({
        key: typeof l["key"] === "string" ? (l["key"] as string).slice(0, 8) : null,
        client: l["clientEmail"] ?? null,
        eaId: l["eaId"] ?? null,
        name: l["name"] ?? l["robotName"] ?? null,
        symbols: Array.isArray(l["symbols"]) ? l["symbols"] : "none",
        image: typeof l["image"] === "string" ? `${Math.round((l["image"] as string).length / 1024)}KB` : "none",
      })),
    )}`,
  );
  // second hop: only these rows' eas (the fat one — one row at a time)
  const e = await db.from("portal_accounts").select("data->eas").eq("email", r.email).limit(1);
  const eas = ((e.data ?? [])[0] as { eas?: unknown } | undefined)?.eas;
  if (Array.isArray(eas)) {
    console.log(
      `  eas=${eas.length} → ${JSON.stringify(
        eas.map((ea) => {
          const a = ea as Record<string, unknown>;
          return {
            id: a["id"] ?? null,
            name: a["name"] ?? null,
            image: typeof a["image"] === "string" ? `${Math.round((a["image"] as string).length / 1024)}KB` : "none",
            symbols: Array.isArray(a["symbols"]) ? a["symbols"] : "none",
            video: typeof a["video"] === "string" ? `${Math.round((a["video"] as string).length / 1024)}KB` : "none",
          };
        }),
      )}`,
    );
  } else {
    console.log(`  eas: ${e.error ? "ERR " + e.error.message : JSON.stringify(eas)}`);
  }
}
