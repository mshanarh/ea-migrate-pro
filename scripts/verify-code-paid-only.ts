/**
 * "A code is sent to PAID users only" — proved at the SEND, not at the reply.
 *
 * `scripts/probe-activation-http.ts` shows that an unpaid address is told "not
 * activated yet". That is weaker than what is being claimed: a refusal is only
 * evidence if the mail could not have been sent anyway. This probe therefore
 * watches the actual outbound call to Brevo.
 *
 * WHAT IT ASSERTS
 *   1. Unpaid  -> refused AND zero Brevo calls. Nothing leaves the server.
 *   2. Unpaid  -> the code is refused even when it is the CORRECT code, so the
 *                 gate is on the account, not on guessing well.
 *   3. Paid    -> exactly one Brevo call, addressed to that exact address.
 *   4. Forging `users.is_paid` buys nothing. That column is writable by the
 *                 ANON key (verified live), so if it were the entitlement
 *                 signal, anyone could mark themselves paid and mail a code to
 *                 an arbitrary inbox. Entitlement must come from the ledger.
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
import handler from "../api/activation";

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
  const key = await crypto.subtle.importKey("raw", enc.encode(serviceRole), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const codeFor = async (email: string) => {
    const window = Math.floor(Date.now() / (30 * 60 * 1000));
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`eamp-activation-v1|${email}|${window}`));
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
    !(ledger.data ?? []).some((r) => r.email === UNPAID) && !(keys.data ?? []).some((r) => r.email === UNPAID),
  );

  // 1 — unpaid, nothing sent.
  const before = sent.length;
  const unpaid = await call({ action: "issueCode", email: UNPAID });
  check("unpaid is refused", unpaid.body.ok === false, unpaid.body.error ?? "");
  check(
    "unpaid: Brevo was NOT called (nothing was sent)",
    sent.length === before,
    `${sent.length - before} call(s) to api.brevo.com`,
  );

  // 2 — the gate is on the ACCOUNT, not on the code being wrong.
  const rightCode = await codeFor(UNPAID);
  const verifyUnpaid = await call({ action: "verifyCode", email: UNPAID, code: rightCode });
  check("unpaid is refused even holding the CORRECT code", verifyUnpaid.body.ok === false, verifyUnpaid.body.error ?? "");
  check("unpaid verifyCode sent nothing either", sent.length === before);

  // 3 — paid, exactly one send, to exactly that address.
  const paid = await call({ action: "issueCode", email: PAID });
  check("paid is emailed a code", paid.body.ok === true, paid.body.error ?? "");
  check("paid: exactly one Brevo call", sent.length === before + 1, `${sent.length - before} call(s)`);
  const recipients = sent
    .slice(before)
    .flatMap((entry) => (Array.isArray(entry.to) ? entry.to : []))
    .map((entry) => (entry as { email?: string }).email ?? "")
    .filter(Boolean);
  check("the code went to the paid address and nowhere else", recipients.length === 1 && recipients[0] === PAID, recipients.join(", ") || "none");

  // 4 — forging the anon-writable flag must not buy a code.
  const forged = await anon.from("users").update({ is_paid: true }).eq("email", UNPAID).select("is_paid");
  if (forged.error) {
    console.log(`SKIP  could not set users.is_paid (${forged.error.code ?? forged.error.message}) — check 4 not run`);
  } else {
    const nowPaid = ((forged.data ?? []) as Array<{ is_paid?: boolean }>)[0]?.is_paid === true;
    const afterForge = sent.length;
    const forgeCall = await call({ action: "issueCode", email: UNPAID });
    check(`users.is_paid is ${nowPaid ? "now forged to true" : "not set"}`, true);
    check("a forged is_paid does NOT buy a code", forgeCall.body.ok === false, forgeCall.body.error ?? "");
    check("  ...and nothing was sent", sent.length === afterForge, `${sent.length - afterForge} call(s)`);
  }

  // Clean up. Only the probe rows this script created.
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
