/** Timing probe for the two-phase read strategy of /api/ea-media.
 *
 *  A. ONE cheap `.or()` ILIKE scan returning only emails (candidate finder).
 *  B. TWO cheap scans run in parallel (the alternative to A).
 *  C. one heavy single-row read (`select data` for one email) — the second
 *     phase: how long does ONE 6.4 MB mentor row take?
 * Prints row counts and milliseconds only, never data or image bytes. */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anon = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anon) {
  console.log("MISSING VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL = "biyasentobeko222@gmail.com";
const NAME = "Sniper killer Ea v2+";

/* A. one combined cheap scan */
const t0 = Date.now();
const combined = await db
  .from("portal_accounts")
  .select("email")
  .or(`data.ilike.%${EMAIL}%,data.ilike.%${NAME}%`)
  .limit(6);
console.log(
  `A combined .or scan: ${combined.error ? `ERROR ${combined.error.message}` : `${(combined.data ?? []).length} rows`} in ${Date.now() - t0}ms`,
);
const combinedEmails = ((combined.data ?? []) as Array<{ email?: string }>).map((row) => row.email ?? "");

/* B. two cheap scans in parallel */
const t1 = Date.now();
const [byEmail, byName] = await Promise.all([
  db.from("portal_accounts").select("email").ilike("data", `%${EMAIL}%`).limit(6),
  db.from("portal_accounts").select("email").ilike("data", `%${NAME}%`).limit(6),
]);
console.log(
  `B two cheap scans in parallel: ${byEmail.error ? `ERR ${byEmail.error.message}` : `${(byEmail.data ?? []).length} rows`} + ${
    byName.error ? `ERR ${byName.error.message}` : `${(byName.data ?? []).length} rows`
  } in ${Date.now() - t1}ms`,
);

/* C. one heavy row read, first candidate */
const candidate = combinedEmails[0];
if (candidate) {
  const t2 = Date.now();
  const row = await db.from("portal_accounts").select("data").eq("email", candidate).limit(1);
  const size = ((row.data ?? []) as Array<{ data?: unknown }>)?.[0]?.data;
  console.log(
    `C single-row read (${candidate}): ${row.error ? `ERROR ${row.error.message}` : "ok"} bytes=${
      typeof size === "string" ? size.length : 0
    } in ${Date.now() - t2}ms`,
  );
}
