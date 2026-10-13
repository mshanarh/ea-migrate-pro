/** Diagnostic: what does portal_accounts.data actually look like?
 *  1. `select email` for every row (cheap) — who is in the table?
 *  2. ONE row read at a time — is `data` text or json? double-encoded?
 *     which top-level keys exist (eas / licenses) and how big is it?
 * Prints lengths and key names only, never image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const t0 = Date.now();
const { data: emails, error } = await db.from("portal_accounts").select("email").limit(1000);
console.log(`emails read: ${error ? `ERROR ${error.message}` : (emails?.length ?? 0)} in ${Date.now() - t0}ms`);
if (error || !emails) process.exit(0);

const interesting: string[] = [];
for (const row of emails as Array<{ email?: string }>) {
  if (row.email) interesting.push(row.email);
}
console.log(`sample emails: ${interesting.slice(0, 8).join(", ")}`);

// Read a handful of rows fully — one statement each, never the whole table.
const targets = interesting.slice(0, 4);
for (const email of targets) {
  const t1 = Date.now();
  const { data, error: rowError } = await db.from("portal_accounts").select("data").eq("email", email).limit(1);
  const ms = Date.now() - t1;
  if (rowError) {
    console.log(`${email}: ERROR ${rowError.message} in ${ms}ms`);
    continue;
  }
  const raw = (data ?? [])[0] as { data?: unknown } | undefined;
  const value = raw?.data;
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  let keys: string[] = [];
  let inner: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text ?? "") as unknown;
    if (typeof parsed === "string") {
      console.log(`${email}: DOUBLE-ENCODED string (${parsed.length} chars) in ${ms}ms`);
      inner = JSON.parse(parsed) as Record<string, unknown>;
    } else if (parsed && typeof parsed === "object") {
      inner = parsed as Record<string, unknown>;
    }
    if (inner) keys = Object.keys(inner);
  } catch {
    console.log(`${email}: not JSON (first chars: ${String(text).slice(0, 40)}) in ${ms}ms`);
  }
  if (inner) {
    const eas = Array.isArray(inner["eas"]) ? (inner["eas"] as Array<Record<string, unknown>>) : [];
    const lics = Array.isArray(inner["licenses"]) ? (inner["licenses"] as Array<Record<string, unknown>>) : [];
    console.log(
      `${email}: ${ms}ms | bytes=${text.length} | keys=${keys.join("|")} | eas=${eas.length} licenses=${lics.length}`,
    );
    for (const ea of eas.slice(0, 4)) {
      console.log(
        `    EA "${ea["name"] ?? "-"}" id=${ea["id"] ?? "-"} image=${
          typeof ea["image"] === "string" && (ea["image"] as string).length
            ? `${Math.round((ea["image"] as string).length / 1024)}KB`
            : "NONE"
        } video=${typeof ea["video"] === "string" && (ea["video"] as string).length ? "YES" : "no"} symbols=${
          Array.isArray(ea["symbols"]) ? JSON.stringify(ea["symbols"]).slice(0, 80) : "NONE"
        }`,
      );
    }
    for (const lic of lics.slice(0, 4)) {
      console.log(
        `    LIC key=${String(lic["key"] ?? "").slice(0, 10)}… eaId=${lic["eaId"] ?? "-"} client=${lic["clientEmail"] ?? "-"} image=${
          typeof lic["image"] === "string" && (lic["image"] as string).length ? "YES" : "NONE"
        }`,
      );
    }
  }
}
