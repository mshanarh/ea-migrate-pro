/**
 * "A code is sent to PAID users only" — proved at the SEND, not at the reply.
 *
 * `scripts/probe-activation-http.ts` shows that an unpaid address is told "not
 * activated yet". That is weaker than what is being claimed: a refusal is only
 * evidence if the mail could not have been sent anyway. This probe therefore
 * watches the actual outbound call to Brevo.
 *
 * WHAT IT ASSERTS
 *   1. Unpaid  -> refused with the exact wording "This email is not marked as
 *                 paid. Contact admin." AND zero Brevo calls. Nothing leaves
 *                 the server and no code is generated.
 *   2. Unpaid  -> the code is refused even when it is the CORRECT code, so the
 *                 gate is on the account, not on guessing well.
 *   3. Paid    -> exactly one Brevo call, addressed to that exact address.
 *   4. Forging `users.is_paid` buys nothing. That column is writable by the
 *                 ANON key (re-verified live), so if it were the entitlement
 *                 signal, anyone could mark themselves paid and mail a code to
 *                 an arbitrary inbox. Entitlement must come from the ledger.
 *   5. A REPEATED request for a code is allowed (a code is not a one-shot
 *                 token), but the licence KEY is still single-use — the rule
 *                 that actually matters is enforced on the key, not the code.
 *   6. Codes EXPIRE: only the current 2-minute window verifies, so a code from
 *                 the previous window is refused.
 *
 * THE SENDER IS FORCED AUTHENTICATABLE FIRST, and deliberately so.
 * `api/activation.ts` now refuses to send when the `From:` domain can never be
 * authenticated by a receiving server — a free-mail address relayed through
 * Brevo fails SPF/DMARC alignment, and a message sent that way is deferred for
 * hours or dropped. That guard is proved separately, in
 * `scripts/verify-sender-guard.ts`, because it needs its own process per
 * sender. Here it would mask the thing this script exists to prove: with an
 * unauthenticatable sender, NOTHING is sent to anybody and the paid-only
 * question never gets asked.
 *
 * HOW: `globalThis.fetch` is wrapped so calls to api.brevo.com are recorded and
 * answered locally; everything else (the Supabase client) passes straight
 * through. No email is ever really sent.
 *
 * READ/WRITE: it creates only probe rows on the reserved `@eamigratepro.invalid`
 * domain and deletes them at the end. `license_keys` is NEVER written.
 *
 * Run: bun scripts/verify-code-paid-only.ts
 */
import { createClient } from "@supabase/supabase-js";

/**
 * Set BEFORE the handler is imported.
 *
 * `api/activation.ts` reads `BREVO_SENDER_EMAIL` once at module load, so this
 * has to happen first — hence the dynamic import below rather than a static
 * one. A static `import` is hoisted above this line and would capture whatever
 * the environment happened to hold, silently turning every send-check here
 * into a test of the sender guard instead of the payment gate.
 */
process.env["BREVO_SENDER_EMAIL"] = "no-reply@ea-migrate-pro.com";

const { default: handler } = await import("../api/activation");

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const anonKey = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !serviceRole || !anonKey) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const PAID = "probe.paidonly.paid@eamigratepro.invalid";
const UNPAID = "probe.paidonly.unpaid@eamigratepro.invalid";
const PROBES = [PAID, UNPAID];

/** Every outbound call to Brevo, captured live. */
const sent: Array<{ to: unknown }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (target.includes("api.brevo.com")) {
    let to: unknown = null;
    try {
      to = (JSON.parse(String(init?.body ?? "{}")) as { to?: unknown }).to;
    } catch {
      /* recorded as unreadable */
    }
    sent.push({ to });
    return new Response(JSON.stringify({ messageId: "<probe>" }), { status: 201 });
  }
  return realFetch(input, init);
}) as typeof fetch;

type Reply = { ok: boolean; unavailable?: boolean; error?: string };
type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(c: number): ApiResponse;
  json(b: unknown): void;
  setHeader(n: string, v: string): void;
};

async function call(payload: Record<string, unknown>): Promise<{ status: number; body: Reply }> {
  let status = 200;
  let payload_: unknown = null;
  const res: ApiResponse = {
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      payload_ = value;
    },
    setHeader() {},
  };
  await handler({ method: "POST", body: JSON.stringify(payload) } satisfies ApiRequest, res);
  return { status, body: payload_ as Reply };
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(serviceRole),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const codeFor = async (email: string, back = 0) => {
    // MUST match api/activation.ts: 2-minute windows, current only.
    const window = Math.floor(Date.now() / (2 * 60 * 1000)) - back;
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`eamp-activation-v1|${email}|${window}`),
    );
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return String(100_000 + (Number.parseInt(hex.slice(0, 12), 16) % 900_000));
  };

  // Clean slate, and confirm UNPAID is unpaid by BOTH signals so a pass below
  // cannot be explained by some leftover row from an earlier probe.
  await admin.from("paid_emails").delete().in("email", PROBES);
  await admin.from("users").delete().in("email", PROBES);
  await admin.from("users").insert(PROBES.map((email) => ({ email })));
  await admin.from("paid_emails").insert([{ email: PAID, paid_at: new Date().toISOString() }]);

  const ledger = await admin.from("paid_emails").select("email").in("email", PROBES);
  const keys = await admin.from("license_keys").select("email").in("email", PROBES);
  check(
    "precondition: UNPAID is on no ledger and holds no licence key",
    !(ledger.data ?? []).some((r) => r.email === UNPAID) &&
      !(keys.data ?? []).some((r) => r.email === UNPAID),
  );

  // 1 — unpaid, nothing sent.
  const before = sent.length;
  const unpaid = await call({ action: "issueCode", email: UNPAID });
  check("unpaid is refused", unpaid.body.ok === false, unpaid.body.error ?? "");
  check(
    'unpaid is told exactly "This email is not marked as paid. Contact admin."',
    unpaid.body.error === "This email is not marked as paid. Contact admin.",
    unpaid.body.error ?? "",
  );
  check(
    "unpaid: Brevo was NOT called (nothing was sent)",
    sent.length === before,
    `${sent.length - before} call(s) to api.brevo.com`,
  );

  // 2 — the gate is on the ACCOUNT, not on the code being wrong.
  const rightCode = await codeFor(UNPAID);
  const verifyUnpaid = await call({ action: "verifyCode", email: UNPAID, code: rightCode });
  check(
    "unpaid is refused even holding the CORRECT code",
    verifyUnpaid.body.ok === false,
    verifyUnpaid.body.error ?? "",
  );
  check("unpaid verifyCode sent nothing either", sent.length === before);

  // 3 — paid, exactly one send, to exactly that address.
  const paid = await call({ action: "issueCode", email: PAID });
  check("paid is emailed a code", paid.body.ok === true, paid.body.error ?? "");
  check(
    "paid: exactly one Brevo call",
    sent.length === before + 1,
    `${sent.length - before} call(s)`,
  );
  const recipients = sent
    .slice(before)
    .flatMap((entry) => (Array.isArray(entry.to) ? entry.to : []))
    .map((entry) => (entry as { email?: string }).email ?? "")
    .filter(Boolean);
  check(
    "the code went to the paid address and nowhere else",
    recipients.length === 1 && recipients[0] === PAID,
    recipients.join(", ") || "none",
  );

  // 4 — forging the anon-writable flag must not buy a code.
  const forged = await anon
    .from("users")
    .update({ is_paid: true })
    .eq("email", UNPAID)
    .select("is_paid");
  if (forged.error) {
    console.log(
      `SKIP  could not set users.is_paid (${forged.error.code ?? forged.error.message}) — check 4 not run`,
    );
  } else {
    const nowPaid = ((forged.data ?? []) as Array<{ is_paid?: boolean }>)[0]?.is_paid === true;
    const afterForge = sent.length;
    const forgeCall = await call({ action: "issueCode", email: UNPAID });
    check(`users.is_paid is ${nowPaid ? "now forged to true" : "not set"}`, true);
    check(
      "a forged is_paid does NOT buy a code",
      forgeCall.body.ok === false,
      forgeCall.body.error ?? "",
    );
    check(
      "  ...and nothing was sent",
      sent.length === afterForge,
      `${sent.length - afterForge} call(s)`,
    );
  }

  // Clean up. Only the probe rows this script created.
  /* 5 — a code may be re-requested; the KEY is what is single-use.
   *
   * This MUST run while PAID still has its ledger row. It used to sit after
   * the cleanup, which deleted that row first — so every assertion failed with
   * "not marked as paid" and looked like a product bug rather than a probe that
   * had already deleted the thing it was testing. */
  const KEY = "EMP-PAIDONLY-REPEAT-001";
  const claim1 = await call({ action: "claimKey", email: PAID, key: KEY });
  check("a paid account can activate a key", claim1.body.ok === true, claim1.body.error ?? "");
  const claim2 = await call({ action: "claimKey", email: PAID, key: KEY });
  check(
    "the SAME key cannot be activated again",
    claim2.body.ok === false && claim2.body.error === "License key already in use",
    claim2.body.error ?? "",
  );
  const repeatCode = await call({ action: "issueCode", email: PAID });
  check(
    "a code can still be re-requested (it is not a one-shot token)",
    repeatCode.body.ok === true,
    repeatCode.body.error ?? "",
  );

  /* 6 — THE TWO-MINUTE RULE. Only the CURRENT window is accepted, so a code
   * from the previous window must be refused. This is the assertion the whole
   * change rests on: without it, "everything passes" could just mean the check
   * stopped checking. */
  const justExpired = await codeFor(PAID, 1);
  const stale = await call({ action: "verifyCode", email: PAID, code: justExpired });
  check(
    "a code from the PREVIOUS 2-minute window is refused",
    stale.body.ok === false,
    stale.body.ok ? "a stale code was ACCEPTED — codes are not expiring" : "",
  );
  const fresh = await codeFor(PAID, 0);
  const live = await call({ action: "verifyCode", email: PAID, code: fresh });
  check(
    "a code from the CURRENT window still verifies",
    live.body.ok === true,
    live.body.error ?? "",
  );

  // Clean up only what this probe created.
  await admin.from("users").update({ license_key: null }).eq("email", PAID);
  await admin.from("paid_emails").delete().in("email", PROBES);
  await admin.from("users").delete().in("email", PROBES);
  const left = await admin.from("users").select("email").in("email", PROBES);
  check("probe rows removed", (left.data ?? []).length === 0);

  globalThis.fetch = realFetch;
  console.log(
    failures === 0
      ? "RESULT: OK — a code is sent to paid accounts only, and nothing is sent to anyone else"
      : `RESULT: ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
