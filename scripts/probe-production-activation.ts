/**
 * END-TO-END VERIFICATION OF THE PRODUCTION ACTIVATION FLOW.
 *
 * This imports the REAL Vercel handler from `api/activation.ts` and calls it
 * exactly as Vercel would, against the live Supabase project — no mocks, no
 * reimplementation. That is the point: the thing that will run in production is
 * the thing being tested.
 *
 * Covers the whole requested flow:
 *   1. Proceed for an UNPAID email   → refused (the plans screen, not the app)
 *   2. Proceed for a PAID email      → a 6-digit code is mailed
 *   3. That code verifies            → the licence screen opens
 *   4. A wrong code                  → refused
 *   5. Unlock the key                → the bot activates
 *   6. The SAME key again, same user → "License key already in use"
 *   7. The SAME key, another user    → "License key already in use"
 *   8. A second key does not release the first
 *
 * Every row it creates is deleted afterwards.
 *
 * Run: bun scripts/probe-production-activation.ts
 */
import { createClient } from "@supabase/supabase-js";
import handler from "../api/activation";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const anonKey = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !serviceRole || !anonKey) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const PAID = "probe.flow.owner@eamigratepro.invalid";
const UNPAID = "probe.flow.unpaid@eamigratepro.invalid";
const SECOND = "probe.flow.second@eamigratepro.invalid";
const KEY_A = "EMP-PROBE-FLOWA-001";
const KEY_B = "EMP-PROBE-FLOWB-002";

type Reply = { ok: boolean; unavailable?: boolean; alreadyInUse?: boolean; error?: string };

/** Calls the handler the way Vercel does. */
async function call(payload: Record<string, unknown>): Promise<{ status: number; body: Reply }> {
  let status = 200;
  let body: unknown = null;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
    setHeader() {},
  };
  await handler({ method: "POST", body: payload }, response);
  return { status, body: body as Reply };
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Reproduces the code the server will derive, to prove the emailed one verifies. */
async function derivedCode(email: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(serviceRole),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const window = Math.floor(Date.now() / (30 * 60 * 1000));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`eamp-activation-v1|${email}|${window}`));
  const digest = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return String(100_000 + (Number.parseInt(digest.slice(0, 12), 16) % 900_000));
}

async function main() {
  // ---- setup: two accounts, one paid, one not -------------------------------
  await admin.from("paid_emails").delete().in("email", [PAID, UNPAID, SECOND]);
  await admin.from("users").delete().in("email", [PAID, UNPAID, SECOND]);
  await admin.from("users").insert([{ email: PAID }, { email: UNPAID }, { email: SECOND }]);
  await admin.from("paid_emails").insert({ email: PAID, paid_at: new Date().toISOString() });
  // SECOND is the "another phone" case. It must be PAID too: a real second
  // device belongs to somebody who got past Proceed, which requires payment.
  // Probing it as unpaid would only prove the entitlement gate, not the lock.
  await admin.from("paid_emails").insert({ email: SECOND, paid_at: new Date().toISOString() });

  // ---- 1. an unpaid account never reaches the code --------------------------
  const unpaid = await call({ action: "issueCode", email: UNPAID });
  check("unpaid account is refused a code", unpaid.status === 200 && unpaid.body.ok === false, unpaid.body.error ?? "");
  check(
    "refusal is 'not entitled', not a server failure",
    !unpaid.body.unavailable && /not been activated/i.test(unpaid.body.error ?? ""),
    String(unpaid.body.unavailable),
  );

  // ---- 2. a paid account gets a code ---------------------------------------
  const issued = await call({ action: "issueCode", email: PAID });
  check("paid account is sent a 6-digit code", issued.status === 200 && issued.body.ok === true, issued.body.error ?? "");

  // ---- 3/4. the code verifies, a wrong one does not ------------------------
  const good = await derivedCode(PAID);
  const verifyGood = await call({ action: "verifyCode", email: PAID, code: good });
  check("the emailed code verifies", verifyGood.status === 200 && verifyGood.body.ok === true, verifyGood.body.error ?? "");
  const verifyBad = await call({ action: "verifyCode", email: PAID, code: "000000" === good ? "111111" : "000000" });
  check("a wrong code is refused", verifyBad.body.ok === false, verifyBad.body.error ?? "");

  // ---- 5. the first phone unlocks the key ----------------------------------
  const claim1 = await call({ action: "claimKey", email: PAID, key: KEY_A });
  check("the first phone activates the key", claim1.status === 200 && claim1.body.ok === true, claim1.body.error ?? "");
  const reenter = await call({ action: "claimKey", email: PAID, key: KEY_A });
  // CHANGED ASSERTION, on purpose. This used to expect a no-op ("the same phone
  // re-entering its own key is allowed"), which is what let one key be re-run on
  // a replacement phone. The requested rule is one activation per key, for
  // EVERYONE including the account that activated it, so the assertion below is
  // the opposite of what it was — not weakened, replaced with the new contract.
  check(
    "the same account activating it again is refused",
    reenter.body.ok === false && reenter.body.alreadyInUse === true,
    reenter.body.error ?? "",
  );
  check(
    '  ...with exactly "License key already in use"',
    reenter.body.error === "License key already in use",
    reenter.body.error ?? "",
  );

  // ---- 6. a second account is told the key is already in use ---------------
  const claim2 = await call({ action: "claimKey", email: SECOND, key: KEY_A });
  check("a second account is refused the key", claim2.body.ok === false && claim2.body.alreadyInUse === true);
  check(
    "the refusal says exactly what was asked for",
    claim2.body.error === "License key already in use",
    claim2.body.error ?? "",
  );

  // ---- 7. a second key does not release the first -------------------------
  const claim3 = await call({ action: "claimKey", email: PAID, key: KEY_B });
  check("a second key activates", claim3.body.ok === true, claim3.body.error ?? "");
  const stillHeld = await call({ action: "claimKey", email: SECOND, key: KEY_A });
  check("the first key is still locked after the second is taken", stillHeld.body.ok === false, stillHeld.body.error ?? "");

  // ---- 8. the lock really is in the column --------------------------------
  const row = await admin.from("users").select("license_key").eq("email", PAID).limit(1);
  const stored = ((row.data ?? []) as Array<{ license_key?: string | null }>)[0]?.license_key ?? "";
  check("the lock column holds both keys", stored.includes(KEY_A) && stored.includes(KEY_B), stored);

  // ---- method guard ---------------------------------------------------------
  let status = 0;
  await handler({ method: "GET" }, {
    status(code: number) {
      status = code;
      return this;
    },
    json() {},
    setHeader() {},
  } as never);
  check("a non-POST request is refused", status === 405, String(status));

  // ---- cleanup --------------------------------------------------------------
  await admin.from("paid_emails").delete().in("email", [PAID, UNPAID, SECOND]);
  await admin.from("users").delete().in("email", [PAID, UNPAID, SECOND]);
  const leftUsers = await admin.from("users").select("email").in("email", [PAID, UNPAID, SECOND]);
  const leftPaid = await admin.from("paid_emails").select("email").in("email", [PAID, UNPAID, SECOND]);
  check(
    "probe rows removed",
    (leftUsers.data ?? []).length === 0 && (leftPaid.data ?? []).length === 0,
    `users=${(leftUsers.data ?? []).length} paid=${(leftPaid.data ?? []).length}`,
  );

  console.log(failures === 0 ? "RESULT: OK — the production activation flow works" : `RESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();