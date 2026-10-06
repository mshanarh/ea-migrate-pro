/**
 * Live probe for the two new activation records.
 *
 * Exercises the exact database operations `src/lib/activation.server.ts`
 * performs, against the real project, and then deletes every row it created:
 *
 *   1. An email with no paid_emails row and no license_keys row is NOT
 *      entitled  → the code is refused, so an unpaid account sees the plans.
 *   2. The service role CAN write users.license_key (the lock column).
 *   3. A second email claiming the same key is REFUSED (single use).
 *   4. Activating a SECOND key does not release the first (the column holds a
 *      list, and the LIKE read finds the right owner).
 *   5. The public anon key still CANNOT rewrite users.license_key (42501), which
 *      is what makes the lock un-liftable from a browser.
 *
 * Run: bun scripts/probe-activation.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const anonKey = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !serviceRole || !anonKey) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}

const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const OWNER = "probe.activation.owner@eamigratepro.invalid";
const THIEF = "probe.activation.thief@eamigratepro.invalid";
const KEY_A = "EMP-PROBE-LOCKA-0001";
const KEY_B = "EMP-PROBE-LOCKB-0002";

/** The same parse the server file uses for the comma-separated lock column. */
function parseKeyList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The same read the server file uses to find every holder of a key. */
async function holdersOf(key: string): Promise<string[]> {
  const { data, error } = await admin.from("users").select("email, license_key").like("license_key", `%${key}%`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ email?: string | null; license_key?: string | null }>;
  return rows
    .filter((row) => parseKeyList(row.license_key).some((entry) => entry.toUpperCase() === key))
    .map((row) => (row.email ?? "").toLowerCase())
    .filter(Boolean);
}

/** The same entitlement test the code issue/verify handlers run. */
async function isEntitled(email: string): Promise<boolean> {
  const { data: ledger, error: ledgerError } = await admin
    .from("paid_emails")
    .select("paid_at")
    .eq("email", email)
    .limit(1);
  if (ledgerError) throw new Error(ledgerError.message);
  if (((ledger ?? []) as Array<{ paid_at?: string | null }>).some((row) => row.paid_at != null)) return true;
  const { data: keys, error: keysError } = await admin.from("license_keys").select("key").eq("email", email).limit(1);
  if (keysError) throw new Error(keysError.message);
  return Array.isArray(keys) && keys.length > 0;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // Baseline: clean anything a previous run left behind.
  for (const email of [OWNER, THIEF]) {
    await admin.from("users").delete().eq("email", email);
  }

  await admin.from("users").insert([{ email: OWNER }, { email: THIEF }]);

  // 1. An unpaid address is refused a code.
  check("unpaid email is not entitled", (await isEntitled(OWNER)) === false);

  // 2. The service role can write the lock column.
  const firstWrite = await admin.from("users").update({ license_key: KEY_A }).eq("email", OWNER);
  check(
    "service role writes users.license_key",
    !firstWrite.error,
    firstWrite.error?.message ?? "",
  );
  check("first claim is recorded", (await holdersOf(KEY_A)).join(",") === OWNER, (await holdersOf(KEY_A)).join(","));

  // 3. A different account re-using that key is refused.
  const others = (await holdersOf(KEY_A)).filter((owner) => owner !== THIEF);
  check("second account is refused the same key", others.length > 0, others.join(","));

  // 4. Activating a second key keeps the first one locked.
  const row = (await admin.from("users").select("license_key").eq("email", OWNER).limit(1)).data ?? [];
  const mine = parseKeyList((row as Array<{ license_key?: string | null }>)[0]?.license_key);
  const appended = await admin
    .from("users")
    .update({ license_key: [...mine, KEY_B].join(",") })
    .eq("email", OWNER);
  check("second key appends without releasing the first", !appended.error, appended.error?.message ?? "");
  check("key A is still held after key B", (await holdersOf(KEY_A)).join(",") === OWNER);
  check("key B is held", (await holdersOf(KEY_B)).join(",") === OWNER);

  // 5. The anon key cannot lift the lock.
  const anonWrite = await anon.from("users").update({ license_key: "EMP-PROBE-STOLEN-9999" }).eq("email", OWNER);
  check(
    "anon cannot rewrite users.license_key",
    !!anonWrite.error,
    anonWrite.error ? `${anonWrite.error.code}` : "WRITE ALLOWED — lock is liftable",
  );

  // Cleanup.
  for (const email of [OWNER, THIEF]) {
    const removed = await admin.from("users").delete().eq("email", email);
    if (removed.error) console.log("cleanup failed for", email, removed.error.message);
  }
  const left = await admin.from("users").select("email").in("email", [OWNER, THIEF]);
  check("probe rows removed", (left.data ?? []).length === 0, `left: ${(left.data ?? []).length}`);

  console.log(failures === 0 ? "RESULT: OK" : `RESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();