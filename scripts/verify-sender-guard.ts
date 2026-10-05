/**
 * WILL THIS SENDER'S MAIL ACTUALLY REACH ANYONE?
 *
 * The bug this guards against: Brevo answers `201 Created` for a message it has
 * only queued, the app logged that as "sent", and every customer was told to
 * check an inbox that stayed empty. Delivery was never checked because nothing
 * in the product could distinguish queued from delivered.
 *
 * `api/activation.ts` and `api/portal.ts` now REFUSE to send when the `From:`
 * domain can never be authenticated by a receiving server. A free-mail address
 * (gmail.com, yahoo.com, …) relayed through Brevo cannot: `gmail.com`'s SPF is
 * `v=spf1 redirect=_spf.google.com`, which authorises Google's servers and not
 * Brevo's, so the message is unauthenticated and gets deferred or dropped.
 *
 * WHY A SUBPROCESS PER SENDER
 * ───────────────────────────
 * Both API modules read `BREVO_SENDER_EMAIL` ONCE at module load. Reassigning
 * `process.env` after import would change nothing, so testing two senders in
 * one process would silently test the first one twice and pass regardless of the
 * second. Each case therefore runs in its own `bun` process with the
 * environment set before the module is ever imported.
 *
 * WHAT IT ASSERTS, per sender
 *   free-mail  -> `ok:false`, `senderUnauthenticated:true`, and ZERO Brevo calls
 *   real domain-> `ok:true` and exactly one Brevo call, addressed to the request
 *
 * READ/WRITE: it inserts one probe row on the reserved `@eamigratepro.invalid`
 * domain, marks it paid through the ledger, and deletes it at the end. Brevo is
 * stubbed inside each child process, so no mail is ever really sent.
 *
 * Run: bun scripts/verify-sender-guard.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const PAID = "probe.sender.paid@eamigratepro.invalid";

/**
 * The child program. Runs inside a fresh `bun` process so the handler reads a
 * sender chosen before module load, stubs Brevo so nothing is really sent, and
 * prints one JSON line for the parent to assert on.
 */
const CHILD = `
/* The sender and the target inbox arrive as ENVIRONMENT variables, not argv.
 * Under \`bun -e\` the script is given no path argument, so \`process.argv\` is
 * shifted by one and positional reads silently yield \`undefined\` — which made
 * every case answer "Enter a valid email address." and pass for the wrong
 * reason. Env cannot be indexed out of step like that. */
const sender = process.env["GUARD_SENDER"];
const target = process.env["GUARD_EMAIL"];
process.env["BREVO_SENDER_EMAIL"] = sender;
let brevoCalls = 0;
let brevoTo = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const target0 = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (target0.includes("api.brevo.com")) {
    brevoCalls++;
    try { brevoTo = JSON.parse(String(init?.body ?? "{}")).to?.[0]?.email ?? null; } catch {}
    return new Response(JSON.stringify({ messageId: "<guard>" }), { status: 201 });
  }
  return realFetch(input, init);
}) ;
const { default: handler } = await import("./api/activation");
let status = 200;
let payload = null;
const res = { status(c){status=c; return res;}, json(v){payload=v;}, setHeader(){} };
await handler({ method: "POST", body: JSON.stringify({ action: "issueCode", email: target }) }, res);
console.log("__RESULT__" + JSON.stringify({ ok: payload?.ok === true, senderUnauthenticated: payload?.senderUnauthenticated === true, brevoCalls, brevoTo, payload, status }));
`;

type Case = {
  sender: string;
  expectSent: boolean;
  why: string;
};

const CASES: Case[] = [
  {
    sender: "eamigratepro@gmail.com",
    expectSent: false,
    why: "gmail.com's SPF does not list Brevo, so the message is unauthenticated",
  },
  {
    sender: "no-reply@mail.yahoo.com",
    expectSent: false,
    why: "no free-mail domain can carry a DKIM record the sender controls",
  },
  {
    sender: "no-reply@ea-migrate-pro.com",
    expectSent: true,
    why: "a real domain can publish SPF and DKIM naming the sending service",
  },
];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Seed one paid probe row so the guard — not the payment gate — is what decides.
await admin.from("paid_emails").delete().eq("email", PAID);
await admin.from("users").delete().eq("email", PAID);
await admin.from("users").insert([{ email: PAID }]);
await admin.from("paid_emails").insert([{ email: PAID, paid_at: new Date().toISOString() }]);

for (const testCase of CASES) {
  process.stdout.write(`\nSENDER ${testCase.sender}\n`);
  const proc = Bun.spawn({
    cmd: ["bun", "-e", CHILD],
    env: {
      ...process.env,
      BREVO_API_KEY: "guard-probe",
      GUARD_SENDER: testCase.sender,
      GUARD_EMAIL: PAID,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const marker = stdout.split("__RESULT__")[1]?.split("\n")[0];
  if (!marker) {
    check("child produced a result", false, stdout.slice(0, 200));
    continue;
  }
  const result = JSON.parse(marker) as {
    ok: boolean;
    senderUnauthenticated: boolean;
    brevoCalls: number;
    brevoTo: string | null;
    payload: Record<string, unknown> | null;
    status: number;
  };
  console.log(`  reply: HTTP ${result.status} ${JSON.stringify(result.payload)}`);

  check(
    testCase.expectSent ? "mail IS attempted" : "mail is REFUSED, not silently queued",
    result.ok === testCase.expectSent,
    testCase.why,
  );
  if (testCase.expectSent) {
    check("exactly one Brevo call", result.brevoCalls === 1, String(result.brevoCalls));
    check("addressed to the requesting inbox", result.brevoTo === PAID, String(result.brevoTo));
  } else {
    check(
      "nothing was sent",
      result.brevoCalls === 0,
      `${result.brevoCalls} call(s) to api.brevo.com`,
    );
    check("the refusal is machine-readable", result.senderUnauthenticated === true);
  }
}

await admin.from("paid_emails").delete().eq("email", PAID);
await admin.from("users").delete().eq("email", PAID);
const left = await admin.from("users").select("email").eq("email", PAID);
check("probe rows removed", (left.data ?? []).length === 0);

console.log(
  failures === 0
    ? "\nRESULT: OK — the app refuses to report mail as sent when the sender cannot be authenticated"
    : `\nRESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
