/**
 * Does the ADMIN_EMAILS / role=admin bypass work against the REAL database?
 *
 * The rate limit has to be proved against a double, because its table does not
 * exist yet. This bypass needs no new table, so it is proved for real: the
 * actual /api/activation handler, the actual Supabase project, the actual
 * Mailjet sender.
 *
 * What it establishes:
 *   1. An address in `ADMIN_EMAILS` gets a code WITHOUT an entry in
 *      `paid_emails` — the operator is not forced to mark their own inbox as a
 *      paying customer to test the code step.
 *   2. An address with `users.is_admin = true` gets the same bypass.
 *   3. Everyone else is still refused — the bypass does not leak into a general
 *      "unpaid means allowed" hole.
 *   4. A genuinely PAID address is unaffected — the ordinary path still works.
 *
 * ⚠ IT SENDS REAL MAIL. Every probe address is on the reserved `.invalid` TLD
 * (RFC 2606), which can never receive mail: Mailjet accepts the message and it
 * bounces. No real inbox is touched.
 *
 * READ/WRITE: probe rows on `@eamigratepro.invalid` only, deleted at the end.
 *
 * Run: bun scripts/verify-admin-bypass.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}

/* Must be set BEFORE the handler module is imported: it reads ADMIN_EMAILS
 * once at module load, exactly as it does on Vercel. */
const ENV_ADMIN = "probe.admin.env@eamigratepro.invalid";
const DB_ADMIN = "probe.admin.role@eamigratepro.invalid";
const STRANGER = "probe.admin.stranger@eamigratepro.invalid";
const PAYER = "probe.admin.payer@eamigratepro.invalid";
process.env["ADMIN_EMAILS"] = ENV_ADMIN;

const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { default: handler } = await import("../api/activation");

type Reply = { ok: boolean; notPaid?: boolean; error?: string };

async function issueCode(email: string): Promise<Reply> {
  let payload: Reply | null = null;
  const response = {
    status() {
      return response;
    },
    json(value: unknown) {
      payload = value as Reply;
    },
    setHeader() {},
  };
  await handler({ method: "POST", body: JSON.stringify({ action: "issueCode", email }) }, response);
  if (!payload) throw new Error("handler sent no JSON");
  return payload;
}

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  console.log(`${condition ? "PASS " : "FAIL "} ${name}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  if (!condition) failures++;
}

const PROBES = [ENV_ADMIN, DB_ADMIN, STRANGER, PAYER];

async function reset() {
  for (const email of PROBES) {
    await admin.from("paid_emails").delete().eq("email", email);
    await admin.from("users").delete().eq("email", email);
  }
  await admin.from("users").insert(PROBES.map((email) => ({ email })));
  // `DB_ADMIN` carries the admin role; nobody else does.
  await admin.from("users").update({ is_admin: true }).eq("email", DB_ADMIN);
  // `PAYER` is a real payer and nothing else.
  await admin.from("paid_emails").insert([{ email: PAYER, paid_at: new Date().toISOString() }]);
}

await reset();

/* 1. ADMIN_EMAILS, with no paid_emails row at all. */
const envAdmin = await issueCode(ENV_ADMIN);
check("an ADMIN_EMAILS address skips the paid check", envAdmin.ok === true, envAdmin.error);
check("it was not merely redirected as unpaid", envAdmin.notPaid !== true);

/* 2. role=admin, with no paid_emails row. */
const dbAdmin = await issueCode(DB_ADMIN);
check("a users.is_admin account skips the paid check", dbAdmin.ok === true, dbAdmin.error);

/* 3. An address with neither signal is still refused. */
const stranger = await issueCode(STRANGER);
check("an ordinary unpaid address is still refused", stranger.ok === false, stranger.error);
check("it gets the honest not-paid reason", stranger.notPaid === true, stranger.error);

/* 4. A genuinely paid address is unaffected by the bypass. */
const payer = await issueCode(PAYER);
check("a paid address still gets its code", payer.ok === true, payer.error);

/* 5. Revoking admin revokes the bypass immediately. */
await admin.from("users").update({ is_admin: false }).eq("email", DB_ADMIN);
const revoked = await issueCode(DB_ADMIN);
check("removing is_admin removes the bypass", revoked.ok === false && revoked.notPaid === true, revoked.error);

await reset();
for (const email of PROBES) {
  await admin.from("paid_emails").delete().eq("email", email);
  await admin.from("users").delete().eq("email", email);
}
const left = await admin.from("users").select("email").in("email", PROBES);
check("probe rows removed", (left.data ?? []).length === 0, `${(left.data ?? []).length} left`);

console.log(failures === 0 ? "\nRESULT: OK — the admin bypass works and does not leak." : `\nRESULT: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
