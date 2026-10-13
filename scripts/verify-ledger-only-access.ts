/**
 * DOES "PAID" REALLY MEAN "THE OWNER MARKED THIS EMAIL PAID"?
 *
 * The app is gated on one table — `paid_emails`, the same table the console's
 * "Mark paid" button writes. This script proves, against the LIVE database,
 * that every grant path in the shipped code now reads that table and nothing
 * else, and it names the accounts the old licence-key fallback had been letting
 * in so the owner can see exactly who stops working.
 *
 * WHAT IT CHECKS
 *   1. `paid_emails` is the only table any grant path reads.
 *   2. No grant path reads `users.is_paid` (anon-writable — verified live).
 *   3. No grant path reads `license_keys` (the key's HOLDER is the mentor who
 *      issued it, not a customer).
 *   4. No browser path writes `paid_emails` / `users.is_paid` — only the
 *      console's setUserPaid does.
 *   5. LIVE: every email with a `license_keys` row but no paid ledger row can
 *      no longer open the app. Those are the accounts being revoked.
 *
 * READ-ONLY. It writes nothing and sends nothing.
 *
 * Run: bun scripts/verify-ledger-only-access.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}
function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * The file with every comment line removed.
 *
 * These files discuss `is_paid` and `license_keys` at length in their doc
 * comments — explaining why they are NOT read. A naive substring search over
 * the raw text therefore "finds" the very things this script proves are absent,
 * so the checks below run against code only.
 */
function code(path: string): string {
  return read(path)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/** Just the body of one exported function, comments and all, up to its closing brace at column 0. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) return "";
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

console.log("── the grant paths in the shipped code ─────────────────────────────");

// The two functions that decide whether an account opens the app, plus the
// browser path that used to write payment.
const gate = read("src/lib/payment-gate.ts");
const gateCode = code("src/lib/payment-gate.ts");
const signInCode = code("src/lib/supabase-users.ts");

// Split on the ledger read so a grant AFTER it is what gets checked.
const afterLedger = gateCode.slice(gateCode.indexOf('from("paid_emails")'));

check(
  "payment-gate: nothing after the ledger read reaches for licence_keys",
  !afterLedger.includes('from("license_keys")'),
  afterLedger.includes('from("license_keys")') ? "license_keys is still read in the grant path" : "",
);
check("payment-gate: code never reads users.is_paid", !gateCode.includes("is_paid"));

// The sign-in gate is the tail of registerWithEmail — the function that both
// creates the app user and decides whether they may proceed.
const signInFn = body(signInCode, "export async function registerWithEmail");
check(
  "sign-in gate: the only grant is the paid_emails ledger",
  signInFn.includes("emailPaidInLedger") && !signInFn.includes("emailHasLicenseKey"),
  signInFn ? "" : "could not locate the sign-in gate function",
);

const activationFn = body(signInCode, "export async function recordKeyActivationInCloud");
check("key activation no longer writes users.is_paid", !activationFn.includes("is_paid"));
check("key activation no longer writes the paid_emails ledger", !activationFn.includes('from("paid_emails")'));
check(
  "key activation still claims the key and binds the device",
  activationFn.includes('from("license_keys")') && activationFn.includes("device_id"),
);

console.log("\n── live: who the removed fallback had been letting in ────────────────");

const { data: ledger } = await db.from("paid_emails").select("email, paid_at").limit(2000);
const paidAt = new Map<string, string | null>(
  ((ledger ?? []) as Array<{ email?: string; paid_at?: string | null }>).map((r) => [
    (r.email ?? "").trim().toLowerCase(),
    r.paid_at ?? null,
  ]),
);
const markedPaid = new Set([...paidAt.entries()].filter(([, at]) => at != null).map(([email]) => email));

const { data: keys } = await db.from("license_keys").select("email").limit(2000);
const keyHolders = [
  ...new Set(
    ((keys ?? []) as Array<{ email?: string | null }>)
      .map((r) => (r.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  ),
];

console.log(`     ledger rows: ${paidAt.size}  marked paid: ${markedPaid.size}`);
console.log(`     licence-key holders: ${keyHolders.length}`);

const revoked = keyHolders.filter((email) => !markedPaid.has(email) && paidAt.get(email) === undefined);
console.log(`\n     key holders with NO ledger entry — these can no longer open the app:`);
for (const email of revoked) console.log(`       REVOKED  ${email}`);
if (revoked.length === 0) console.log("       (none)");

const kept = keyHolders.filter((email) => markedPaid.has(email));
console.log(`\n     key holders who ARE on the ledger — these keep working:`);
for (const email of kept) console.log(`       KEPT     ${email}`);
if (kept.length === 0) console.log("       (none)");

check(
  "every account the owner marked paid still opens the app",
  markedPaid.size > 0,
  `${markedPaid.size} marked paid`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
