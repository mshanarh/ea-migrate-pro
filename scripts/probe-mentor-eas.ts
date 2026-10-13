/** Diagnostic: where does the EA PICTURE live, and can it be read cheaply?
 *  1. mentor_approvals → the mentor emails (cheap, 2 rows).
 *  2. for each mentor: `select data->eas` for THAT row only — timed, and
 *     does each EA carry an image?
 *  3. license_keys.ea_name list — can a robot NAME be matched to an EA?
 * Prints names, ids and KB sizes only, never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const t0 = Date.now();
const { data: approvals, error: approvalError } = await db.from("mentor_approvals").select("email, status");
console.log(
  `mentor_approvals: ${approvalError ? `ERROR ${approvalError.message}` : `${approvals?.length ?? 0} rows`} in ${Date.now() - t0}ms`,
);

const mentors = (approvals ?? []).map((row) => String(row.email).trim().toLowerCase()).filter(Boolean);
type Ea = { id?: string; name?: string; symbols?: unknown; image?: unknown; video?: unknown };
const allEas: Array<{ mentor: string; ea: Ea }> = [];

for (const mentor of mentors) {
  const t = Date.now();
  const { data, error } = await db.from("portal_accounts").select("data->eas").eq("email", mentor).limit(1);
  const ms = Date.now() - t;
  if (error) {
    console.log(`${mentor}: ERROR ${error.message} in ${ms}ms`);
    continue;
  }
  const eas = ((data ?? [])[0] as { eas?: unknown } | undefined)?.eas;
  const list = Array.isArray(eas) ? (eas as Ea[]) : [];
  console.log(
    `${mentor}: ${ms}ms | eas=${list.length} withImage=${list.filter((e) => typeof e.image === "string" && e.image.length > 0).length}`,
  );
  for (const ea of list) {
    allEas.push({ mentor, ea });
    console.log(
      `    id=${ea.id ?? "-"} name="${ea.name ?? "-"}" image=${
        typeof ea.image === "string" && ea.image.length ? `${Math.round(ea.image.length / 1024)}KB` : "NONE"
      } video=${typeof ea.video === "string" && ea.video.length ? `${Math.round(ea.video.length / 1024)}KB` : "no"} symbols=${
        Array.isArray(ea.symbols) ? JSON.stringify(ea.symbols).slice(0, 60) : "NONE"
      }`,
    );
  }
}

const t1 = Date.now();
const { data: keys, error: keysError } = await db.from("license_keys").select("email, ea_name");
console.log(
  `license_keys: ${keysError ? `ERROR ${keysError.message}` : `${keys?.length ?? 0} rows`} in ${Date.now() - t1}ms`,
);
const names = new Set<string>();
for (const row of keys ?? []) {
  const name = String(row.ea_name ?? "").trim();
  if (name) names.add(name);
}
console.log(`distinct ea_name values: ${[...names].join(" | ")}`);
const eaNames = new Set(allEas.map((entry) => (entry.ea.name ?? "").trim().toLowerCase()));
for (const name of names) {
  console.log(`  "${name}" → mentor EA match: ${eaNames.has(name.trim().toLowerCase()) ? "YES" : "NO"}`);
}
