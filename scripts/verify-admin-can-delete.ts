/**
 * Can the people who can OPEN the admin console also CLEAR a message?
 *
 * This exists because the console gate and the delete endpoint do not ask the
 * same question, and that gap is a regression this change introduced:
 *
 *   console gate   `account.role === "admin"` OR the email is in OWNER_EMAILS
 *   /api/portal    the SAME three conditions — owner list, `users.is_admin`,
 *                  and the portal account's own role
 *
 * An owner address that can open the console but has no `users.is_admin` row
 * would render the console perfectly and then get "Only an administrator can
 * do that" from the delete button — the exact error this commit set out to
 * remove.
 *
 * READ-ONLY. Prints the answer and fails if any admin-capable address is
 * refused by the endpoint's own rule.
 *
 * Run: bun scripts/verify-admin-can-delete.ts
 */
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAILS } from "../src/lib/auth-store";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

/** Exactly the rule api/portal.ts applies to deleteMessage. */
async function isAdmin(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  // 1. The platform owner list. The authoritative copy is in
  //    src/lib/auth-store.ts; api/portal.ts keeps its own, so reading the
  //    authoritative one here is what catches the two drifting apart.
  if (OWNER_EMAILS.map((e) => e.trim().toLowerCase()).includes(clean)) return true;
  // 2. users.is_admin.
  const flag = await db.from("users").select("is_admin").eq("email", clean).limit(1);
  if (!flag.error && ((flag.data ?? []) as Array<{ is_admin?: boolean | null }>).some((r) => r.is_admin === true)) {
    return true;
  }
  // 3. The portal account's own role.
  const portal = await db.from("portal_accounts").select("data").eq("email", clean).limit(1);
  for (const row of (portal.data ?? []) as Array<{ data?: string | null }>) {
    if (!row.data) continue;
    try {
      const parsed = JSON.parse(row.data) as { role?: unknown };
      if (typeof parsed.role === "string" && parsed.role.toLowerCase() === "admin") return true;
    } catch {
      /* not parsable — carries no role */
    }
  }
  return false;
}

async function main() {
  const owners = OWNER_EMAILS.map((email) => email.trim().toLowerCase());

  const portalRows = ((await db.from("portal_accounts").select("email, data")).data ?? []) as Array<{
    email?: string;
    data?: string | null;
  }>;
  // Anyone the PORTAL itself marks as role "admin" can open the console too,
  // so they must clear messages as well.
  const portalAdmins: string[] = [];
  for (const row of portalRows) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email) continue;
    try {
      const parsed = JSON.parse(row.data ?? "{}") as { role?: unknown };
      if (typeof parsed.role === "string" && parsed.role.toLowerCase() === "admin") portalAdmins.push(email);
    } catch {
      /* a row without a parsable blob carries no role */
    }
  }

  const capable = [...new Set([...owners, ...portalAdmins])];
  console.log(`addresses that can open the admin console: ${capable.length}\n`);

  let failures = 0;
  for (const email of capable) {
    const admin = await isAdmin(email);
    const why = owners.includes(email) ? "OWNER_EMAILS" : "portal role=admin";
    console.log(`${admin ? "OK  " : "FAIL"}  ${email.padEnd(44)} ${why}`);
    if (!admin) failures++;
  }

  console.log("");
  if (failures > 0) {
    console.log("RESULT: FAIL — an address can open the console but cannot clear a message.");
    console.log("Fix: set users.is_admin = true for those addresses, or widen the rule in api/portal.ts.");
    process.exit(1);
  }
  console.log("RESULT: OK — everyone who can open the console can also clear a message");
}

void main();
