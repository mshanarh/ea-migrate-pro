/**
 * HOW MANY MENTORS NEED AN ID, AND DO ANY ALREADY HAVE ONE?
 *
 * A 3-digit mentor ID has 1000 slots, so the number of portal accounts decides
 * whether "unique" is even achievable and whether any ID already exists to
 * preserve. This is read-only.
 *
 * Run: bun scripts/probe-mentor-ids.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

// `data` is a large JSON blob per row, and selecting it for every account at
// once exceeded PostgREST's statement timeout on the live database (verified).
// The roles and the existing IDs both live inside that blob, so it has to be
// read — but as pages, so no single request carries every row.
const PAGE = 50;
const rows: Array<{ email?: string; data?: string | null }> = [];
let offset = 0;
for (;;) {
  const page = await db.from("portal_accounts").select("email, data").range(offset, offset + PAGE - 1);
  if (page.error) {
    console.log(`Could not read portal_accounts: ${page.error.message}`);
    process.exit(1);
  }
  const batch = (page.data ?? []) as Array<{ email?: string; data?: string | null }>;
  rows.push(...batch);
  if (batch.length < PAGE) break;
  offset += PAGE;
}
const roles: Record<string, number> = {};
const taken = new Set<string>();
let missing = 0;
let corrupt = 0;

for (const row of rows) {
  if (!row.data) {
    missing++;
    continue;
  }
  try {
    const account = JSON.parse(row.data) as { mentorId?: unknown; role?: string };
    const role = account.role ?? "mentor";
    roles[role] = (roles[role] ?? 0) + 1;
    if (typeof account.mentorId === "string" && account.mentorId) taken.add(account.mentorId);
    else missing++;
  } catch {
    corrupt++;
  }
}

console.log(`portal_accounts rows : ${rows.length}`);
console.log(`by role              : ${JSON.stringify(roles)}`);
console.log(`already has mentorId : ${taken.size}${taken.size ? ` (${[...taken].sort().join(", ")})` : ""}`);
console.log(`needs one assigned   : ${missing}`);
console.log(`unparseable rows     : ${corrupt}`);
console.log(`\n3-digit space        : 1000 slots, ${rows.length} accounts need one`);
console.log(rows.length < 1000 ? "unique assignment is achievable" : "NOT ENOUGH SLOTS — the ID cannot be unique");
