/**
 * Removes the PROBE/TEST rows that inflate the admin console counts, and
 * nothing else.
 *
 * THE SAFETY RULE, which is the whole point of this script:
 *   • It ONLY ever matches rows this repository's own probes created. Every
 *     probe address ends in `@eamigratepro.invalid` — a reserved TLD that can
 *     never receive mail, so a real customer can never be on it.
 *   • Real customers, real licence keys, real payments and real approvals are
 *     never matched, and the script prints the exact rows it will touch BEFORE
 *     touching anything (`--dry-run`, which is the default).
 *   • `license_keys` is NEVER touched, probe or not: a key row is revenue and
 *     the customer asked that no licence data be deleted.
 *
 * Run:  bun scripts/clean-test-data.ts            (dry run — changes nothing)
 *       bun scripts/clean-test-data.ts --apply
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing cleaned.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

/** The only pattern this script will ever delete. */
const TEST_DOMAIN = "@eamigratepro.invalid";
const apply = process.argv.includes("--apply");

type Row = { email?: string | null; key?: string | null; value?: string | null };

async function findIn(table: string, column = "email"): Promise<Row[]> {
  const { data, error } = await db.from(table).select("*").like(column, `%${TEST_DOMAIN}`);
  if (error) {
    console.log(`  ! could not read ${table}: ${error.message}`);
    return [];
  }
  return (data ?? []) as Row[];
}

async function main() {
  console.log(apply ? "APPLYING — the rows below will be deleted\n" : "DRY RUN — nothing is being deleted. Re-run with --apply.\n");

  const users = await findIn("users");
  const approvals = await findIn("mentor_approvals");
  const paid = await findIn("paid_emails");
  const sessions = await findIn("user_sessions");
  const portal = await findIn("portal_accounts");
  const settings = await findIn("app_settings", "key");

  console.log(`users             ${users.length}`);
  for (const row of users.slice(0, 60)) console.log(`    ${row.email}`);
  console.log(`mentor_approvals  ${approvals.length}`);
  for (const row of approvals.slice(0, 60)) console.log(`    ${row.email}`);
  console.log(`paid_emails       ${paid.length}`);
  console.log(`user_sessions     ${sessions.length}`);
  console.log(`portal_accounts   ${portal.length}`);
  console.log(`app_settings      ${settings.length}`);
  for (const row of settings.slice(0, 60)) console.log(`    ${row.key}`);

  // Never delete anything from license_keys — that is live revenue data.
  const keys = await findIn("license_keys");
  console.log(`\nlicense_keys      ${keys.length} (NEVER deleted — licence data is kept)`);

  if (!apply) {
    console.log("\nNothing changed.");
    return;
  }

  const deletions: Array<[string, Promise<{ error: { message: string } | null }>]> = [
    ["user_sessions", db.from("user_sessions").delete().like("email", `%${TEST_DOMAIN}`)],
    ["portal_accounts", db.from("portal_accounts").delete().like("email", `%${TEST_DOMAIN}`)],
    ["paid_emails", db.from("paid_emails").delete().like("email", `%${TEST_DOMAIN}`)],
    ["mentor_approvals", db.from("mentor_approvals").delete().like("email", `%${TEST_DOMAIN}`)],
    ["app_settings", db.from("app_settings").delete().like("key", `%${TEST_DOMAIN}`)],
    ["users", db.from("users").delete().like("email", `%${TEST_DOMAIN}`)],
  ];
  for (const [table, promise] of deletions) {
    const { error } = await promise;
    console.log(`${error ? "FAILED" : "deleted"}  ${table}${error ? ` — ${error.message}` : ""}`);
  }

  console.log("\nRemaining test rows (must all be 0):");
  for (const table of ["users", "mentor_approvals", "paid_emails", "user_sessions", "portal_accounts"]) {
    console.log(`  ${table}: ${(await findIn(table)).length}`);
  }
  console.log(`  app_settings: ${(await findIn("app_settings", "key")).length}`);
}

void main();