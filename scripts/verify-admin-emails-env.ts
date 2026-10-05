/**
 * Does the bypass work for the addresses actually in ADMIN_EMAILS?
 *
 * verify-admin-bypass.ts sets ADMIN_EMAILS itself, which proves the MECHANISM.
 * This proves the VALUE the owner actually configured works, which is a
 * different thing: a typo, a stray space, or a value that was never set at all
 * would leave the feature silently inert while every other check still passed.
 *
 * ⚠ IT READS REAL ADDRESSES BUT SENDS NOTHING. Mail is intercepted at
 *    `src/lib/mailjet.server` and the interception is asserted before any result
 *    is believed, so the owner's own inbox is never contacted.
 *
 * The address is only ever passed to `isMarkedPaid`, which is a database READ.
 * No code is generated, no email is sent, and no probe rows are written.
 *
 * Run: bun scripts/verify-admin-emails-env.ts
 */
import { mock } from "bun:test";

type Sent = { to: string };
const sent: Sent[] = [];

mock.module("../src/lib/mailjet.server", () => ({
  sendMail: async (m: Sent) => {
    sent.push(m);
    return { ok: true as const };
  },
  mailConfigured: () => true,
  mailSender: () => "probe@eamigratepro.invalid",
}));

const { default: handler } = await import("../api/activation");

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  console.log(`${condition ? "PASS " : "FAIL "} ${name}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  if (!condition) failures++;
}

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

/* 0. The mail double must be in place before any PASS is believable. */
const raw = (process.env["ADMIN_EMAILS"] ?? "").trim();
const admins = raw
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

check("ADMIN_EMAILS is set in the environment", admins.length > 0, `${admins.length} address(es)`);

if (admins.length === 0) {
  console.log("\nRESULT: FAILED — ADMIN_EMAILS is not set, so no address can use the bypass.");
  process.exit(1);
}

/* 1. Every configured address parses to a usable email shape. */
for (const admin of admins) {
  check(`${admin} is a valid address`, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin));
}

/* 2. The FIRST configured address bypasses the paid check. If this fails, the
 *    env value is not reaching the module and the feature is inert. */
const before = sent.length;
const reply = await issueCode(admins[0]!);
check(`${admins[0]} skips the paid_emails check`, reply.ok === true, reply.error);
check("it was not answered with the not-paid reason", reply.notPaid !== true, reply.error);

/* 3. The admin's code email was INTERCEPTED, not delivered. Getting a code is
 *    the CORRECT behaviour for an admin, so the thing to prove is not "nothing
 *    was attempted" but "everything that was attempted stopped at the double" —
 *    the mock captured it, so no request ever reached Mailjet. */
check(
  "the admin's code email was intercepted by the double, not delivered",
  sent.length === before + 1 && sent[before]?.to === admins[0],
  `${sent.length - before} captured for ${sent[before]?.to ?? "nobody"}`,
);

/* 4. An address that is NOT configured still gets the honest refusal, so the
 *    list has not become a general bypass — and, unlike the admin above, it
 *    must produce no captured send at all. */
const stranger = "probe.notanadmin@eamigratepro.invalid";
const refused = await issueCode(stranger);
check("an unconfigured address is still refused", refused.ok === false && refused.notPaid === true, refused.error);
check("and it attempted no send whatsoever", sent.length === before + 1, `${sent.length - before - 1} extra captured`);

console.log(
  failures === 0
    ? `\nRESULT: OK — ADMIN_EMAILS is set and all ${admins.length} configured address(es) bypass correctly.`
    : `\nRESULT: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
