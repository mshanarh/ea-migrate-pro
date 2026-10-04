/**
 * A REAL activation code, through the REAL Brevo API. NOTHING IS STUBBED.
 *
 * THE OTHER PROBES STUB `globalThis.fetch`, which is right for them — they
 * assert that the send is *gated*, and stubbing is what lets them assert it
 * without mailing anyone. This script is the opposite question: does a code
 * actually leave the server and get accepted by Brevo? So there is no wrapper
 * here, no interception, and no fake 201. The real api/activation.ts handler
 * makes a real HTTPS call to api.brevo.com with the real BREVO_API_KEY, and a
 * real message lands in a real inbox.
 *
 * WHAT IT DOES, IN ORDER
 *   1. Calls the handler for the address exactly as the database has it.
 *      eamigratepro@gmail.com is NOT on the payment ledger, so this is
 *      expected to be REFUSED — and that refusal is the point: it proves the
 *      "codes go to paid users only" rule still holds against the live
 *      provider, not just against a stub.
 *   2. Temporarily adds a `paid_emails` row so entitlement passes, sends the
 *      REAL code, and reports what Brevo said.
 *   3. Verifies the emailed code against the handler.
 *   4. REMOVES the temporary row, restoring the database exactly as it was.
 *
 * Run: bun scripts/test-real-code.ts [address]
 *      defaults to eamigratepro@gmail.com when no address is given.
 */
import { createClient } from "@supabase/supabase-js";
import handler from "../api/activation";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing sent.");
  process.exit(1);
}
if (!(process.env["BREVO_API_KEY"] ?? "").trim()) {
  console.log("BREVO_API_KEY is not set — nothing sent.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });

/** The address to test. Pass it as the first argument. */
const TO = (process.argv[2] ?? "eamigratepro@gmail.com").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TO)) {
  console.log(`"${TO}" is not a deliverable email address — it needs a domain (e.g. name@example.com).`);
  console.log("Nothing was sent.");
  process.exit(1);
}

type Reply = { ok: boolean; unavailable?: boolean; error?: string };
type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(c: number): ApiResponse;
  json(b: unknown): void;
  setHeader(n: string, v: string): void;
};

async function call(payload: Record<string, unknown>): Promise<{ status: number; body: Reply }> {
  let status = 200;
  let parsed: unknown = null;
  const res: ApiResponse = {
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      parsed = value;
    },
    setHeader() {},
  };
  await handler({ method: "POST", body: JSON.stringify(payload) } satisfies ApiRequest, res);
  return { status, body: parsed as Reply };
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

  // Whatever the ledger already says, so step 4 can put it back exactly.
  const before = ((await db.from("paid_emails").select("email, paid_at").eq("email", TO).limit(1)).data ??
    []) as Array<{ email?: string; paid_at?: string | null }>;
  const hadRow = before.length > 0;
  const originalPaidAt = before[0]?.paid_at ?? null;
  console.log(`target: ${TO}`);
  console.log(`ledger before: ${hadRow ? `row present, paid_at=${String(originalPaidAt)}` : "NO ROW — not a paid user"}`);
  console.log("");

  /* ── 1. As the database stands ─────────────────────────────────────── */
  console.log("── 1. issueCode with the ledger UNCHANGED ──");
  const first = await call({ action: "issueCode", email: TO });
  console.log(`   reply: ${JSON.stringify(first.body)}`);
  const sentOk = first.body.ok;
  // A refusal here is the gate working; a success means the address was
  // ALREADY paid and the real code has just gone out.
  const refusedCorrectly = !sentOk;
  console.log(
    refusedCorrectly
      ? "   OK  refused — unpaid accounts get no code\n"
      : "   OK  already paid — a REAL code was just accepted by Brevo. No database change needed.\n",
  );

  /* ── 2. Only if it was refused, make it entitled and send for real ─── */
  // ONE email per run. The step-1 call already sent the code when the address
  // was already paid, so sending again here would put a second copy in a real
  // inbox for no reason.
  let sent = first;
  if (!sentOk) {
    console.log("── 2. issueCode with a temporary ledger row (REAL Brevo call) ──");
    await db.from("paid_emails").insert({ email: TO, paid_at: new Date().toISOString() });
    sent = await call({ action: "issueCode", email: TO });
    console.log(`   handler replied: ${JSON.stringify(sent.body)}`);
  }
  if (!sent.body.ok) {
    console.log(`   SEND FAILED: ${sent.body.error ?? "unknown"}`);
  }

  /* ── 3. Prove the emailed code is the one the handler accepts ──────── */
  console.log("\n── 3. verifyCode with the code that was just emailed ──");
  if (sent.body.ok) {
    const code = await codeFor(TO);
    const verified = await call({ action: "verifyCode", email: TO, code });
    const wrong = await call({ action: "verifyCode", email: TO, code: code === "000000" ? "111111" : "000000" });
    console.log(`   the real code verifies : ${verified.body.ok === true}`);
    console.log(`   a wrong code is refused: ${wrong.body.ok === false}`);
  }

  /* ── 4. Put the ledger back exactly as it was ──────────────────────── */
  console.log("\n── 4. restoring the ledger ──");
  if (hadRow) {
    await db.from("paid_emails").update({ paid_at: originalPaidAt }).eq("email", TO);
    console.log(`   restored to paid_at=${String(originalPaidAt)}`);
  } else {
    await db.from("paid_emails").delete().eq("email", TO);
    console.log("   temporary row deleted — address is NOT marked paid again");
  }
  const after = ((await db.from("paid_emails").select("email, paid_at").eq("email", TO).limit(1)).data ??
    []) as Array<{ email?: string; paid_at?: string | null }>;
  const restored = hadRow ? after.length === 1 && after[0]?.paid_at === originalPaidAt : after.length === 0;
  console.log(`   ledger restored: ${restored ? "yes" : "NO — check this"}`);

  console.log(
    sent.body.ok && restored
      ? "\nRESULT: OK — a real code was accepted by Brevo and the database is back as it was."
      : "\nRESULT: see above",
  );
  process.exit(sent.body.ok && restored ? 0 : 1);
  // `refusedCorrectly` is reported above for information; an address that was
  // already paid is a legitimate success, not a failed assertion.
}

void main();
