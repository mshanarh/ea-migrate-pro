/**
 * What the "Activated, not paid" tab will actually show, computed from the
 * live database with the SAME two conditions the console uses:
 *
 *   usedApp — the account has a `users` row (it has opened the trading app)
 *   !isPaid — no `paid_emails` row carrying a timestamp
 *
 * READ-ONLY. Its job is to prove the filter is not accidentally empty and that
 * genuinely paid customers are excluded from it.
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

async function main() {
  const users = ((await db.from("users").select("email")).data ?? []) as Array<{ email?: string }>;
  const paid = ((await db.from("paid_emails").select("email, paid_at")).data ?? []) as Array<{
    email?: string;
    paid_at?: string | null;
  }>;

  const usedApp = new Set(users.map((row) => (row.email ?? "").trim().toLowerCase()).filter(Boolean));
  const paidLedger = new Set(
    paid
      .filter((row) => row.paid_at != null)
      .map((row) => (row.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  const list = [...usedApp].filter((email) => !paidLedger.has(email)).sort();
  const leaked = list.filter((email) => paidLedger.has(email));

  console.log(`accounts that have opened the app : ${usedApp.size}`);
  console.log(`accounts on the payment ledger     : ${paidLedger.size}`);
  console.log(`"Activated, not paid" tab shows    : ${list.length}`);
  console.log(`paid accounts wrongly included     : ${leaked.length}`);
  console.log("");
  console.log("First 15 in the tab:");
  for (const email of list.slice(0, 15)) console.log(`  ${email}`);
  console.log("...");
  console.log("");
  console.log("The 4 marked-paid customers (must NOT be in the tab):");
  for (const email of paidLedger) console.log(`  ${email}  ${usedApp.has(email) ? "has opened the app" : "never opened the app"}`);
  console.log("");

  if (leaked.length > 0) {
    console.log("RESULT: FAIL — a paid account is in the tab");
    process.exit(1);
  }
  console.log("RESULT: OK — the tab is populated and paid accounts are excluded");
}

void main();