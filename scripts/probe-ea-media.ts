/** WHERE IS THE EA PICTURE + SYMBOLS?
 * With the anon key (exactly what the app's activation/sync uses):
 *   1. does rpc ea_media_for_email exist and return pictures?
 *   2. is portal_accounts readable, and does the mentor's blob carry
 *      eas[].image / eas[].symbols / licenses[] links?
 * Prints structure + lengths only — never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAILS = [
  "ntobekotraders.official@gmail.com",
  "biyasentobeko222@gmail.com",
  "eamigratepro@gmail.com",
];

// 1. The RPC
for (const email of EMAILS) {
  const { data, error } = await db.rpc("ea_media_for_email", { p_email: email });
  if (error) {
    console.log(`RPC ${email}: ERROR ${error.message}`);
  } else {
    const rows = Array.isArray(data) ? (data as Array<{ id?: string; name?: string; image?: string }>) : [];
    console.log(
      `RPC ${email}: ${rows.length} rows | withImage=${rows.filter((r) => typeof r.image === "string" && r.image.length > 0).length}` +
        ` | sizes=${rows.map((r) => (r.image ? `${r.name ?? r.id}:${Math.round(r.image.length / 1024)}KB` : `${r.name ?? r.id}:none`)).slice(0, 8).join(",")}`,
    );
  }
}

// 2. portal_accounts readability + blob structure
const { data: rows, error } = await db.from("portal_accounts").select("email, data");
if (error) {
  console.log(`portal_accounts: READ ERROR — ${error.message}`);
} else {
  console.log(`portal_accounts: readable, ${rows?.length ?? 0} rows`);
  for (const row of rows ?? []) {
    let blob: {
      eas?: Array<{ id?: string; name?: string; symbols?: unknown; image?: unknown }>;
      licenses?: Array<{ key?: string; eaId?: string; name?: string; symbols?: unknown; image?: unknown }>;
    } | null = null;
    try {
      blob = typeof row.data === "string" ? JSON.parse(row.data) : (row.data as typeof blob);
    } catch {
      console.log(`  ${row.email}: UNPARSEABLE data`);
      continue;
    }
    const eas = blob?.eas ?? [];
    const licenses = blob?.licenses ?? [];
    if (eas.length === 0 && licenses.length === 0) continue;
    console.log(
      `  ${row.email}: eas=${eas.length} (image=${eas.filter((e) => typeof e.image === "string" && e.image.length > 0).length}, ` +
        `symbols=${eas.filter((e) => Array.isArray(e.symbols) && e.symbols.length > 0).length}) | ` +
        `licenses=${licenses.length} (withEaId=${licenses.filter((l) => l.eaId).length}, ` +
        `withSymbols=${licenses.filter((l) => Array.isArray(l.symbols) && (l.symbols as unknown[]).length > 0).length}, ` +
        `withImage=${licenses.filter((l) => typeof l.image === "string" && (l.image as string).length > 0).length})`,
    );
    for (const ea of eas.slice(0, 6)) {
      console.log(
        `    EA "${ea.name}" id=${ea.id ?? "-"} image=${typeof ea.image === "string" && ea.image.length ? `${Math.round(ea.image.length / 1024)}KB` : "NONE"} symbols=${Array.isArray(ea.symbols) ? JSON.stringify(ea.symbols) : "NONE"}`,
      );
    }
    for (const lic of licenses.slice(0, 6)) {
      console.log(
        `    LIC key=${(lic.key ?? "").slice(0, 8)}… eaId=${lic.eaId ?? "-"} symbols=${Array.isArray(lic.symbols) ? JSON.stringify(lic.symbols) : "NONE"} image=${typeof lic.image === "string" && lic.image.length ? "YES" : "NONE"}`,
      );
    }
  }
}
