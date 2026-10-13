/**
 * CAN `users.is_paid` OR `is_whitelisted` BE TRUSTED AS "ADMIN MARKED PAID"?
 *
 * The request is to gate the activation code on the admin marking somebody
 * paid. That is already the behaviour. The open question is WHICH COLUMN may
 * answer it, because two of the suggested columns are not under admin control
 * at all:
 *
 *   users.is_paid     writable by the PUBLIC anon key (if still true) → anybody
 *                     could set it on their own row and mail a code to any
 *                     inbox they control.
 *   is_whitelisted    may not exist at all; there is no DDL path on this
 *                     deployment to add it.
 *
 * This re-checks both against the LIVE database rather than trusting an
 * earlier note, because the whole answer turns on them.
 *
 * READ/WRITE: writes only to a probe row on the reserved
 * `@eamigratepro.invalid` domain, and deletes it afterwards.
 *
 * Run: bun scripts/probe-entitlement-columns.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const anonKey = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !serviceRole || !anonKey) {
  console.log("Missing Supabase env.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const PROBE = "probe.entitlement.probe@eamigratepro.invalid";

async function main() {
  await admin.from("users").delete().eq("email", PROBE);
  await admin.from("users").insert({ email: PROBE });

  /* 1. Can the PUBLIC key set is_paid? */
  const forged = await anon.from("users").update({ is_paid: true }).eq("email", PROBE).select("is_paid");
  const wroteIt = !forged.error && ((forged.data ?? []) as Array<{ is_paid?: boolean }>).some((r) => r.is_paid === true);
  console.log(
    wroteIt
      ? "users.is_paid : WRITABLE BY THE PUBLIC ANON KEY — a stranger can mark themselves paid."
      : `users.is_paid : not anon-writable (${forged.error?.code ?? "no rows"}) — safe to trust.`,
  );

  /* 2. Does is_whitelisted exist? */
  const white = await anon.from("users").select("is_whitelisted").eq("email", PROBE).limit(1);
  const exists = !white.error && white.data !== null && Array.isArray(white.data);
  console.log(
    exists && ((white.data ?? []) as unknown[]).length > 0
      ? "users.is_whitelisted : EXISTS on the live table."
      : `users.is_whitelisted : DOES NOT EXIST (${white.error?.code ?? "no rows"}) — nothing to check.`,
  );

  /* 3. Confirm the ledger the console writes is the dependable signal. */
  await admin.from("paid_emails").delete().eq("email", PROBE);
  await admin.from("paid_emails").insert({ email: PROBE, paid_at: new Date().toISOString() });
  const ledger = await anon.from("paid_emails").select("paid_at").eq("email", PROBE).limit(1);
  const ledgerRow = ((ledger.data ?? []) as Array<{ paid_at?: string | null }>)[0];
  console.log(
    ledgerRow?.paid_at
      ? "paid_emails ledger : present and readable — this is the console's own Mark-paid record."
      : "paid_emails ledger : row missing.",
  );

  await admin.from("paid_emails").delete().eq("email", PROBE);
  await admin.from("users").delete().eq("email", PROBE);
  const left = await admin.from("users").select("email").eq("email", PROBE);
  console.log(`\nprobe rows removed: ${((left.data ?? []).length === 0) ? "yes" : "NO"}`);
}

void main();
