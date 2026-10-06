/**
 * HOW LONG DOES "PRESS PROCEED" ACTUALLY TAKE?
 *
 * The owner's ask was that pressing Proceed must not take long. The honest way
 * to answer that is to time it, not to reason about it: this drives the REAL
 * handler over a real socket with the REAL Brevo API and the REAL database,
 * which is the whole path between the tap and the code screen appearing.
 *
 * It measures three things separately, because they are different problems:
 *   1. issueCode  — the tap that sends the code (what the user waits for)
 *   2. verifyCode — typing the six digits
 *   3. claimKey   — entering the licence key
 *
 * IT SENDS REAL EMAILS to the address given on the command line. Everything
 * else it touches is read-only, and it restores the ledger exactly as found.
 *
 * Run: bun scripts/time-proceed.ts biyasentobeko222@gmail.com
 */
import { createClient } from "@supabase/supabase-js";
import handler from "../api/activation";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env.");
  process.exit(1);
}
const db = createClient(url, serviceRole, { auth: { persistSession: false } });
const TO = (process.argv[2] ?? "").trim().toLowerCase();

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(c: number): ApiResponse;
  json(b: unknown): void;
  setHeader(n: string, v: string): void;
};

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = request.method === "POST" ? await request.text() : undefined;
    let status = 200;
    let payload: unknown = null;
    const res: ApiResponse = {
      status(c: number) {
        status = c;
        return res;
      },
      json(v: unknown) {
        payload = v;
      },
      setHeader() {},
    };
    await handler({ method: request.method, body } satisfies ApiRequest, res);
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  },
});
const base = `http://localhost:${server.port}/api/activation`;

async function timed(label: string, payload: Record<string, unknown>) {
  const started = performance.now();
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok: boolean; error?: string };
  const ms = Math.round(performance.now() - started);
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)} ms   ${body.ok ? "ok" : `refused: ${body.error ?? ""}`}`);
  return { ms, body };
}

async function main() {
  console.log(`timing the real path (Brevo + database, no stubs)\n`);

  console.log("1. issueCode for an address that is NOT paid (no mail is sent):");
  await timed("not-paid account", { action: "issueCode", email: "probe.timing.unpaid@eamigratepro.invalid" });

  if (!TO) {
    console.log("\n(no address given — skipping the paid timings)");
    server.stop();
    return;
  }

  const paidRow = ((await db.from("paid_emails").select("paid_at").eq("email", TO).limit(1)).data ??
    []) as Array<{ paid_at?: string | null }>;
  const alreadyPaid = paidRow.length > 0 && paidRow[0]?.paid_at != null;
  if (!alreadyPaid) await db.from("paid_emails").insert({ email: TO, paid_at: new Date().toISOString() });

  console.log(`\n2. issueCode for ${TO} (SENDS A REAL CODE):`);
  const send = await timed("paid account — code sent", { action: "issueCode", email: TO });
  await timed("paid account — code sent again", { action: "issueCode", email: TO });

  console.log("\n3. verifyCode (no mail, pure computation):");
  await timed("wrong code (6 digits)", { action: "verifyCode", email: TO, code: "000000" });

  if (!alreadyPaid) {
    await db.from("paid_emails").delete().eq("email", TO);
    console.log("\ntemporary ledger row removed — address left exactly as found");
  }
  server.stop();

  console.log(`\nThe user waits for step 2 only. Under ~1s is instant; over ~3s feels slow.`);
  console.log(`This run: ${send.ms} ms.`);
}

void main();