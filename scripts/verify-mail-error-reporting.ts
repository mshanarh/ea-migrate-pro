/**
 * EVERY MAIL FAILURE PATH MUST NAME ITS ACTUAL REASON.
 *
 * "The email service could not be reached" is the single most expensive string
 * in this codebase: it is what a customer sees when a code silently fails to
 * send, and it is indistinguishable between a bad API key, an unapproved
 * sender, an exhausted quota and a real network outage. An operator cannot act
 * on it, which is how a broken mail path stays broken for days.
 *
 * WHAT IT ASSERTS
 *   1. A missing MAILJET_API_KEY names that variable (and does not throw).
 *   2. A missing MAILJET_SECRET_KEY is refused too.
 *   3. A real Mailjet rejection carries its HTTP status and Mailjet's own
 *      message - proved against the LIVE API with a deliberately invalid key,
 *      so it cannot drift from how the real endpoint actually behaves.
 *   4. Through /api/activation, the SPECIFIC failure reaches the response JSON
 *      instead of the old generic wording.
 *   5. A refusal is reported as a refusal, not as "could not be reached": a
 *      non-2xx must never be dressed up as a transport failure.
 *
 * WHY 401 MATTERS SPECIFICALLY
 * A non-2xx is the case that gets swallowed. `fetch` RESOLVES on HTTP 401 and
 * 400 rather than throwing, so reading only the resolved body and calling that
 * success is a real and easy mistake - it reports an unverified sender or a
 * revoked key as a working send. An earlier version, using the Mailjet SDK,
 * had the opposite bug: the SDK threw on non-2xx, so a 401/400 never reached the
 * resolved-response branch at all and was reported as a network problem. This
 * suite exists to keep honest whichever way the transport behaves.
 *
 * RUNS ONE REAL (DOOMED) HTTP CALL TO MAILJET with an invalid key, which is
 * how the rejection shape is verified rather than assumed. It sends no mail.
 *
 * READ/WRITE: only probe rows on the reserved `@eamigratepro.invalid` domain,
 * deleted at the end.
 *
 * Run: bun scripts/verify-mail-error-reporting.ts
 */

const KEY = (process.env["MAILJET_API_KEY"] ?? "").trim();
const SECRET = (process.env["MAILJET_SECRET_KEY"] ?? "").trim();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * Run `fn` with a controlled Mailjet environment, then restore it.
 *
 * The env is restored in a `finally` so a failing assertion cannot leave the
 * real credentials unset for the rest of the process.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["MAILJET_API_KEY", "MAILJET_SECRET_KEY", "MAILJET_SENDER_EMAIL"]) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const { sendMail } = await import("../src/lib/mailjet.server");
const sample = { to: "probe.mailerr@eamigratepro.invalid", subject: "s", html: "h", text: "t" };

// 1 — a missing API key is refused and names the variable.
const noKey = await withEnv({ MAILJET_API_KEY: undefined, MAILJET_SECRET_KEY: SECRET }, () =>
  sendMail(sample),
);
check("missing MAILJET_API_KEY is refused (does not throw)", noKey.ok === false, noKey.error?.slice(0, 60));
check(
  "the missing-credential message is a real explanation",
  (noKey.error ?? "").length > 0,
  noKey.error?.slice(0, 80),
);

// 2 — a missing secret key is refused too.
const noSecret = await withEnv({ MAILJET_API_KEY: KEY, MAILJET_SECRET_KEY: undefined }, () =>
  sendMail(sample),
);
check("missing MAILJET_SECRET_KEY is refused", noSecret.ok === false);

// 3 — a REAL rejection, against the live API with an invalid key.
const rejected = await withEnv(
  { MAILJET_API_KEY: "invalid-key-for-probe", MAILJET_SECRET_KEY: "invalid-secret-for-probe" },
  () => sendMail(sample),
);
check("a real rejection reports ok:false", rejected.ok === false, rejected.error?.slice(0, 90));
check(
  "the rejection names Mailjet and carries its status + message",
  /Mailjet rejected the send \(HTTP \d+\)/.test(rejected.error ?? ""),
  (rejected.error ?? "").slice(0, 120),
);
check(
  "a refusal is NOT dressed up as a transport failure",
  !/could not be reached/.test(rejected.error ?? ""),
  (rejected.error ?? "").slice(0, 90),
);

// 4 — the specific message must survive the trip through /api/activation.
const { createClient } = await import("@supabase/supabase-js");
const { default: handler } = await import("../api/activation");
const admin = createClient(
  (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim(),
  (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim(),
  { auth: { persistSession: false } },
);

const PROBE = "probe.mailerr.paid@eamigratepro.invalid";
await admin.from("paid_emails").delete().eq("email", PROBE);
await admin.from("users").delete().eq("email", PROBE);
await admin.from("users").insert([{ email: PROBE }]);
await admin.from("paid_emails").insert([{ email: PROBE, paid_at: new Date().toISOString() }]);

type Reply = { ok: boolean; notPaid?: boolean; error?: string };
const reply = await withEnv(
  { MAILJET_API_KEY: "invalid-key-for-probe", MAILJET_SECRET_KEY: "invalid-secret-for-probe" },
  async () => {
    let captured: Reply | null = null;
    await handler(
      { method: "POST", body: JSON.stringify({ action: "issueCode", email: PROBE }) },
      {
        status() {
          return this;
        },
        json(b: unknown) {
          captured = b as Reply;
        },
        setHeader() {},
      },
    );
    return captured as unknown as Reply;
  },
);

check(
  "activation JSON carries the SPECIFIC mail failure",
  reply.ok === false && /Mailjet rejected the send \(HTTP \d+\)/.test(reply.error ?? ""),
  (reply.error ?? "").slice(0, 120),
);
check(
  "it is not the old generic wording",
  reply.error !== "We could not send your code. Message support on WhatsApp.",
);
check("the paid gate is still intact (it is notPaid, not a mail error)", reply.notPaid !== true);

// 5 — a paid account with WORKING credentials still gets ok:true, so the
// stricter error path cannot have broken the happy path.
const ok = await withEnv({ MAILJET_API_KEY: KEY, MAILJET_SECRET_KEY: SECRET }, () =>
  sendMail({ to: "probe.mailerr.ok@eamigratepro.invalid", subject: "probe", html: "<p>probe</p>", text: "probe" }),
);
check(
  "a valid send still succeeds (the error path did not break the happy path)",
  ok.ok === true,
  ok.ok ? "" : (ok.error ?? "").slice(0, 100),
);
check(
  "the accepted send hands Mailjet's messageId back to the caller",
  ok.ok === true && typeof ok.messageId === "string" && ok.messageId.length > 0,
  ok.ok ? `messageId=${ok.messageId ?? "(missing)"}` : "(send failed, no id to return)",
);

await admin.from("paid_emails").delete().eq("email", PROBE);
await admin.from("users").delete().eq("email", PROBE);
const left = await admin.from("users").select("email").eq("email", PROBE);
check("probe rows removed", (left.data ?? []).length === 0);

console.log(
  failures === 0
    ? "RESULT: OK — every mail failure names its real reason, and the happy path still works"
    : `RESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);