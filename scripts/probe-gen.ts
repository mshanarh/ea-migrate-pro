/**
 * Key-generation audit — replays EXACTLY what src/routes/dashboard.licenses.tsx
 * and src/routes/dashboard.tsx decide, for every portal account, using the
 * SAME sources the live app uses:
 *   approval    (mentor_approvals is authoritative; portal blob status is
 *               overwritten by it, dashboard polls this, sign-in merges it)
 *   eas/limit/licenses from portal_accounts.data
 *   allowed     (cloud cap row -> cap; else local licenseLimit > 0 -> local;
 *               else null => blocked)
 *   remaining   (allowed - local licenses.length)
 *   button      (disabled when remaining === 0 or eas.length === 0)
 *   submit check (cap !== null && countKeysForEmail >= cap -> blocked)
 * portal_accounts `data` blobs are fetched one email at a time (they are too
 * large to select in bulk - statement timeout).
 */
import { getLicenseCapForEmail, countKeysForEmail } from "../src/lib/admin-store";
import { portalCloudConfigured } from "../src/lib/portal-cloud";
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase NOT configured in this environment");
  process.exit(1);
}

type AccountData = {
  status?: string;
  role?: string;
  licenseLimit?: number;
  licenses?: unknown[];
  eas?: unknown[];
};

const settings = await supabase.from("app_settings").select("key,value").like("key", "limit:%");
const limitRows = new Map<string, number>();
for (const row of settings.data ?? []) {
  const email = String(row.key).slice("limit:".length);
  let value: unknown = row.value;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { continue; }
  }
  const limit = Number((value as { limit?: unknown } | null)?.limit);
  if (Number.isFinite(limit)) limitRows.set(email, Math.floor(limit));
}

const emails = await supabase.from("portal_accounts").select("email");
if (emails.error) {
  console.log("portal_accounts email list failed:", emails.error.message);
  process.exit(1);
}
const accounts: AccountData[] = [];
for (const row of emails.data ?? []) {
  const one = await supabase.from("portal_accounts").select("data").eq("email", row.email).maybeSingle();
  if (one.error || !one.data) continue;
  try {
    accounts.push({ ...(JSON.parse(String(one.data.data)) as AccountData), email: row.email });
  } catch {
    /* skip unparsable blob */
  }
}

// Approval cross-reference (authoritative).
const approvals = await supabase.from("mentor_approvals").select("email,status");
const approvalMap = new Map<string, string>();
for (const row of approvals.data ?? []) {
  if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
    approvalMap.set(row.email.toLowerCase(), row.status);
  }
}

console.log(`limit rows: ${limitRows.size} | portal accounts: ${accounts.length} | approvals: ${approvalMap.size}\n`);

const withRow: string[] = [];
const blockedWithRow: string[] = [];
const noRowCanGenerate: string[] = [];
const noRowBlocked: string[] = [];

for (const account of accounts) {
  const email = (account.email ?? "").trim().toLowerCase();
  if (!email) continue;

  const blobStatus = (account.status ?? "pending").toLowerCase();
  // Like portalGetAccount / dashboard poll: approval wins.
  const approval = approvalMap.get(email) ?? blobStatus;
  const gateApproved = approval === "approved";

  const cap = await getLicenseCapForEmail(email); // real function
  const localLimit = Number(account.licenseLimit);
  const allowed = cap !== null ? cap : (Number.isFinite(localLimit) && localLimit > 0 ? localLimit : null);
  const used = (account.licenses ?? []).length;
  const remaining = allowed === null ? 0 : Math.max(allowed - used, 0);
  const buttonEnabled = remaining > 0 && (account.eas ?? []).length > 0;

  let submitBlocked = false;
  if (cap !== null) {
    const cloudUsed = await countKeysForEmail(email);
    submitBlocked = cloudUsed >= cap;
  }

  const canGenerate = gateApproved && buttonEnabled && !submitBlocked;
  const hasRow = limitRows.has(email);

  const gateLabel = approval.padEnd(9);
  const line = `${email.padEnd(38)} approval=${gateLabel} cap=${String(cap).padEnd(5)} used(local)=${String(used).padEnd(3)} eas=${(account.eas ?? []).length} allowed=${allowed === null ? "null" : allowed} remaining=${remaining} btn=${buttonEnabled} submitOK=${!submitBlocked} => ${canGenerate ? "CAN generate" : "BLOCKED"}`;

  if (hasRow) {
    withRow.push(line);
    if (!canGenerate) blockedWithRow.push(line);
  } else {
    if (canGenerate) noRowCanGenerate.push(line);
    else noRowBlocked.push(line);
  }
}

console.log(`=== ACCOUNTS WITH AN ALLOWANCE ROW (${withRow.length}) ===`);
for (const l of withRow) console.log("  " + l);
console.log(`\n=== WITH ROW BUT BLOCKED (${blockedWithRow.length}) — these are the ones to fix ===`);
for (const l of blockedWithRow) console.log("  " + l);
console.log(`\n=== NO ROW (rejected — should stay blocked): ${noRowBlocked.length} blocked, ${noRowCanGenerate.length} leaking ===`);
for (const l of noRowCanGenerate) console.log("  LEAK: " + l);
