/**
 * What the admin console now shows, and what is left in it that looks like
 * test residue. READ-ONLY — nothing is deleted here.
 *
 * The @eamigratepro.invalid probes are already gone (scripts/clean-test-data.ts).
 * What this shows is the remainder, so the owner can decide row by row: the
 * rule here is that nothing real is deleted on a guess.
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

async function main() {
  const users = (await admin.from("users").select("email, created_at")).data ?? [];
  const approvals = (await admin.from("mentor_approvals").select("email, status, created_at")).data ?? [];
  const paid = (await admin.from("paid_emails").select("email, paid_at")).data ?? [];
  const portal = (await admin.from("portal_accounts").select("email")).data ?? [];

  const has = (rows: Array<{ email?: string }>, email: string) =>
    rows.some((row) => (row.email ?? "").toLowerCase() === email);
  const pending = approvals.filter((row) => row.status === "pending");
  const rejected = approvals.filter((row) => row.status === "rejected");

  console.log("ADMIN CONSOLE COUNTS (what the tabs will show)");
  console.log(`  App users (have a users row) : ${users.length}`);
  console.log(`  Pending users                 : ${pending.length}`);
  console.log(`  Rejected users                : ${rejected.length}`);
  console.log(`  Paid users                    : ${(paid as Array<{ paid_at?: string | null }>).filter((r) => r.paid_at).length}`);
  console.log(`  Portal signups                : ${portal.length}`);
  console.log("");

  console.log("PENDING — each one sits in the review queue until a human decides:");
  for (const row of pending) {
    const email = (row.email ?? "").toLowerCase();
    console.log(
      `  ${email.padEnd(42)} app:${has(users, email) ? "yes" : "no "}  portal:${has(portal, email) ? "yes" : "no "}  joined ${String(row.created_at ?? "").slice(0, 10)}`,
    );
  }
  console.log("");
  console.log("REJECTED (already closed, listed for reference):");
  for (const row of rejected) console.log(`  ${(row.email ?? "").toLowerCase()}`);
}

void main();