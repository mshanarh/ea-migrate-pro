/** Diagnostic: the FULL portal_accounts row for the platform owners.
 * Is `data` a plain object, a double-encoded JSON string, or genuinely
 * empty of EAs? Prints keys, counts and KB sizes — never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const TARGETS = [
  "ntobekotraders.official@gmail.com",
  "biyasentobeko222@gmail.com",
  "lwethunkandi3@gmail.com",
  "eamigratepro@gmail.com",
];

type Ea = { id?: string; name?: string; symbols?: unknown; image?: unknown; video?: unknown };
type Blob = { email?: string; role?: string; eas?: Ea[]; licenses?: Array<Record<string, unknown>> };

for (const email of TARGETS) {
  const t = Date.now();
  const { data, error } = await db.from("portal_accounts").select("data").eq("email", email).limit(1);
  const ms = Date.now() - t;
  if (error) {
    console.log(`${email}: ERROR ${error.message} in ${ms}ms`);
    continue;
  }
  const cell = (data ?? [])[0] as { data?: unknown } | undefined;
  if (cell === undefined) {
    console.log(`${email}: NO ROW in ${ms}ms`);
    continue;
  }
  const value = cell.data;
  const outerText = typeof value === "string" ? value : JSON.stringify(value ?? null);
  let blob: Blob | null = null;
  let doubleEncoded = false;
  try {
    const parsed = JSON.parse(outerText) as unknown;
    if (typeof parsed === "string") {
      doubleEncoded = true;
      blob = JSON.parse(parsed) as Blob;
    } else if (parsed && typeof parsed === "object") {
      blob = parsed as Blob;
    }
  } catch {
    console.log(`${email}: UNPARSEABLE (${outerText.length} bytes) in ${ms}ms`);
    continue;
  }
  const eas = Array.isArray(blob?.eas) ? blob.eas : [];
  const lics = Array.isArray(blob?.licenses) ? blob.licenses : [];
  console.log(
    `${email}: ${ms}ms | bytes=${outerText.length} doubleEncoded=${doubleEncoded} keys=${Object.keys(blob ?? {}).join("|")} eas=${eas.length} licenses=${lics.length}`,
  );
  for (const ea of eas.slice(0, 8)) {
    console.log(
      `    EA "${ea.name ?? "-"}" id=${ea.id ?? "-"} image=${
        typeof ea.image === "string" && ea.image.length ? `${Math.round(ea.image.length / 1024)}KB` : "NONE"
      } video=${typeof ea.video === "string" && ea.video.length ? `${Math.round(ea.video.length / 1024)}KB` : "no"} symbols=${
        Array.isArray(ea.symbols) ? JSON.stringify(ea.symbols).slice(0, 70) : "NONE"
      }`,
    );
  }
  for (const lic of lics.slice(0, 5)) {
    console.log(
      `    LIC key=${String(lic["key"] ?? "").slice(0, 10)}… eaId=${lic["eaId"] ?? "-"} client=${lic["clientEmail"] ?? "-"} image=${
        typeof lic["image"] === "string" && (lic["image"] as string).length ? "YES" : "NONE"
      }`,
    );
  }
}
