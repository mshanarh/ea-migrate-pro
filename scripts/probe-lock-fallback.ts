/**
 * Probe: can the PUBLIC anon key implement a single-use licence lock on its own?
 *
 * Production serves a STATIC build (vercel.json → dist/, POST /_serverFn/* →
 * 405), so any check that needs a server secret is unavailable there. This
 * probe establishes whether an insert-once row in `app_settings` gives
 * first-write-wins semantics for the anon key, and whether that row can ever be
 * removed again.
 *
 * Everything it creates is deleted afterwards WITH THE SERVICE ROLE, because
 * the anon key is expected to be unable to delete it.
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

const LOCK_KEY = "lock:EMP-PROBE-LOCKFALL-0001";
const HOLDER = "probe.lockfall.holder@eamigratepro.invalid";
const ATTACKER = "probe.lockfall.attacker@eamigratepro.invalid";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // Baseline.
  await admin.from("app_settings").delete().eq("key", LOCK_KEY);

  // 1. anon can claim a key: one INSERT of a row named after the key.
  const claim = await anon
    .from("app_settings")
    .insert({ key: LOCK_KEY, value: JSON.stringify({ email: HOLDER, at: new Date().toISOString() }) });
  check("anon can insert the lock row", !claim.error, claim.error ? `${claim.error.code}` : "");

  // 2. A SECOND claim of the same key must be REFUSED (unique key → 23505).
  const second = await anon
    .from("app_settings")
    .insert({ key: LOCK_KEY, value: JSON.stringify({ email: ATTACKER, at: new Date().toISOString() }) });
  check("second claim of the same key is refused", !!second.error, second.error ? `${second.error.code}` : "ALLOWED");

  // 3. The stored holder is readable, which is what "already in use" is decided from.
  const read = await anon.from("app_settings").select("key, value").eq("key", LOCK_KEY).limit(1);
  const rows = (read.data ?? []) as Array<{ value?: string }>;
  const holder = rows.length === 1 ? (JSON.parse(rows[0]!.value ?? "{}") as { email?: string }).email : undefined;
  check("lock row is readable by anon", holder === HOLDER, String(holder));

  // 4. anon must NOT be able to delete the lock (that would be a release).
  const remove = await anon.from("app_settings").delete().eq("key", LOCK_KEY);
  check("anon cannot delete the lock row", !!remove.error, remove.error ? `${remove.error.code}` : "DELETE ALLOWED");

  // 5. Rewriting the holder must not make the key usable by anyone else: the
  //    claim is decided by the row EXISTING, not by who it names.
  const rewrite = await anon
    .from("app_settings")
    .update({ value: JSON.stringify({ email: ATTACKER, at: new Date().toISOString() }) })
    .eq("key", LOCK_KEY);
  const stillThere = await anon.from("app_settings").select("key").eq("key", LOCK_KEY).limit(1);
  check("rewriting the holder still leaves the key locked", (stillThere.data ?? []).length === 1, rewrite.error?.code ?? "");

  // Cleanup with the service role.
  const cleanup = await admin.from("app_settings").delete().eq("key", LOCK_KEY);
  const left = await admin.from("app_settings").select("key").eq("key", LOCK_KEY);
  check(
    "probe row removed with the service role",
    !cleanup.error && (left.data ?? []).length === 0,
    cleanup.error?.message ?? "",
  );

  console.log(failures === 0 ? "RESULT: OK" : `RESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();