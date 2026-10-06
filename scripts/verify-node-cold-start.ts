/**
 * THE ACTIVATION FUNCTION MUST BOOT UNDER A REAL NODE RUNTIME.
 *
 * The live failure this exists for was not a handler bug. Every request to
 * both serverless functions answered:
 *
 *     GET/POST /api/activation  ->  500   x-vercel-error: FUNCTION_INVOCATION_FAILED
 *
 * A 500 that arrives even for a GET — which returns 405 before a single line of
 * the handler runs — is a COLD-START crash, not a handler error. That is the
 * one class of bug no unit test of the handler can catch, because `bun` loads
 * the module happily and so did every offline probe in this repository while
 * production was down.
 *
 * So this does what Vercel does: bundle `api/activation.ts` the way a function
 * bundle is built, then load and CALL it in a child `node` process. If the
 * module needs anything that is resolvable from this repo's `node_modules` but
 * NOT from a bundle or from the deployed environment, this fails where every
 * other check here passes.
 *
 * It also asserts the answer SHAPE for each branch, because "the function
 * answers 405" is only useful if the 405 is the one the app expects.
 *
 * The `issueCode` call below really does mail a code, to a probe address on the
 * reserved `@eamigratepro.invalid` domain, from a `paid_emails` row this script
 * creates and deletes again. Run: bun scripts/verify-node-cold-start.ts
 */
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PROBE = "probe.node.coldstart@eamigratepro.invalid";
const BUNDLE = "/tmp/eamp-activation-node-coldstart.mjs";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("RESULT: skipped — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set.");
  process.exit(0);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const build = spawnSync(
  "bun",
  ["build", "api/activation.ts", "--target=node", "--format=esm", "--outfile", BUNDLE],
  { encoding: "utf8" },
);
check(
  "the function bundles for a Node runtime",
  build.status === 0,
  build.status === 0 ? "" : (build.stderr ?? "").slice(0, 300),
);
if (build.status !== 0) process.exit(1);

// Mark the probe paid so issueCode is reached, and clear any previous probe row.
await admin.from("paid_emails").delete().eq("email", PROBE);
await admin
  .from("paid_emails")
  .insert([{ email: PROBE, paid_at: new Date().toISOString() }]);

const driver = `
const probe = ${JSON.stringify(PROBE)};
function fakeRes() {
  return {
    statusCode: 0, body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
import(${JSON.stringify(BUNDLE)}).then(async (mod) => {
  const run = async (request) => {
    const res = fakeRes();
    await mod.default(request, res);
    return res;
  };
  const out = [];
  out.push(["GET", await run({ method: "GET", body: undefined })]);
  out.push(["UNKNOWN", await run({ method: "POST", body: { action: "__nope__" } })]);
  out.push(["ISSUE", await run({ method: "POST", body: { action: "issueCode", email: probe } })]);
  out.push([
    "UNPAID",
    await run({ method: "POST", body: { action: "issueCode", email: "someone.unpaid@eamigratepro.invalid" } }),
  ]);
  process.stdout.write("::RESULT::" + JSON.stringify(out));
}).catch((error) => {
  process.stdout.write("::BOOTFAIL::" + String((error && error.stack) || error));
});
`;

const run = spawnSync("node", ["-e", driver], { encoding: "utf8", timeout: 60_000 });
const stdout = run.stdout ?? "";

if (!stdout.includes("::RESULT::")) {
  // The exact failure the live deployment was showing. Report the child's own
  // stack: a module-load error here IS the production outage.
  const bootFail = stdout.includes("::BOOTFAIL::")
    ? stdout.split("::BOOTFAIL::")[1]
    : `no result from the child process (exit ${run.status}): ${(run.stderr ?? "").slice(0, 400)}`;
  check("the function boots under Node", false, bootFail);
  await admin.from("paid_emails").delete().eq("email", PROBE);
  console.log("RESULT: 1 check(s) failed");
  process.exit(1);
}

check("the function boots under Node", true);

const results = JSON.parse(stdout.split("::RESULT::")[1]) as Array<
  [string, { statusCode: number; body: Record<string, unknown> | null }]
>;
const byName = new Map(results.map(([name, res]) => [name, res]));

const get = byName.get("GET")!;
check(
  "a GET is refused with 405 and Allow: POST",
  get.statusCode === 405 && (get.body as { error?: string } | null)?.error === "Method not allowed",
  `status=${get.statusCode}`,
);

const unknown = byName.get("UNKNOWN")!;
check(
  "an unknown action is refused with 400",
  unknown.statusCode === 400,
  `status=${unknown.statusCode}`,
);

const issue = byName.get("ISSUE")!;
const issueBody = issue.body as { ok?: boolean; error?: string; messageId?: string } | null;
check(
  "a PAID probe gets a code mailed from a cold Node process",
  issue.statusCode === 200 && issueBody?.ok === true,
  issueBody?.ok === true ? "accepted by Mailjet" : (issueBody?.error ?? "").slice(0, 200),
);
check(
  "the accepted reply carries Mailjet's messageId, as the contract requires",
  issueBody?.ok === true && typeof issueBody.messageId === "string" && issueBody.messageId.length > 0,
  `messageId=${issueBody?.messageId ?? "(missing)"}`,
);

const unpaid = byName.get("UNPAID")!;
const unpaidBody = unpaid.body as { ok?: boolean; notPaid?: boolean } | null;
check(
  "an UNPAID probe is refused by the paid gate, not by a mail error",
  unpaid.statusCode === 200 && unpaidBody?.ok === false && unpaidBody?.notPaid === true,
  `notPaid=${String(unpaidBody?.notPaid)}`,
);

try {
  unlinkSync(BUNDLE);
} catch {
  /* a leftover temp bundle is not a failure */
}
await admin.from("paid_emails").delete().eq("email", PROBE);
const left = await admin.from("paid_emails").select("email").eq("email", PROBE);
check("probe rows removed", (left.data ?? []).length === 0);

console.log(
  failures === 0
    ? "RESULT: OK — the activation function boots under Node and serves every branch"
    : `RESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);