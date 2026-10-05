/**
 * THE ACTIVATION ENDPOINT, OVER REAL HTTP.
 *
 * The earlier probe called the handler as a function. This one puts it behind an
 * HTTP server that mounts it exactly the way Vercel mounts `/api/*.ts`, and
 * drives the whole flow with `fetch` — the same thing the browser does. It is
 * the closest thing to the production request that can be run without your
 * Vercel account: real sockets, real status codes, real JSON, real method
 * guard.
 *
 * WHAT IT PROVES, end to end:
 *   POST -> 200            the happy path is not blocked by CORS/method/routing
 *   unpaid   -> refused    the plans screen, not the app
 *   paid     -> emailed    Brevo actually accepted a 6-digit code
 *   code     -> verifies   the emailed digits are accepted
 *   key      -> activates  the first and only activation
 *   same key again        -> "License key already in use"   (requirement 3)
 *   other user, same key  -> "License key already in use"   (requirement 2)
 *   GET     -> 405         the method guard is live
 *
 * Every row it creates is deleted afterwards.
 *
 * Run: bun scripts/probe-activation-http.ts
 */
import { createClient } from "@supabase/supabase-js";
import handler from "../api/activation";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const PAID = "probe.http.owner@eamigratepro.invalid";
const SECOND = "probe.http.second@eamigratepro.invalid";
const UNPAID = "probe.http.unpaid@eamigratepro.invalid";
const KEY = "EMP-PROBE-HTTPA-001";

type Reply = { ok: boolean; unavailable?: boolean; alreadyInUse?: boolean; error?: string };
type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status(c: number): ApiResponse; json(b: unknown): void; setHeader(n: string, v: string): void };

/** The Vercel-shaped mount, over a real socket. */
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== "/api/activation") return new Response("not found", { status: 404 });
    const body = request.method === "POST" ? await request.text() : undefined;
    let status = 200;
    let payload: unknown = null;
    const res: ApiResponse = {
      status(code: number) {
        status = code;
        return res;
      },
      json(value: unknown) {
        payload = value;
      },
      setHeader() {},
    };
    await handler({ method: request.method, body } satisfies ApiRequest, res);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  },
});

const base = `http://localhost:${server.port}/api/activation`;

async function post(payload: Record<string, unknown>): Promise<{ status: number; body: Reply }> {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Reply };
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
    // MUST match api/activation.ts: 5-minute windows, current only.
    const window = Math.floor(Date.now() / (5 * 60 * 1000));
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`eamp-activation-v1|${email}|${window}`));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return String(100_000 + (Number.parseInt(hex.slice(0, 12), 16) % 900_000));
  };

  await admin.from("paid_emails").delete().in("email", [PAID, SECOND, UNPAID]);
  await admin.from("users").delete().in("email", [PAID, SECOND, UNPAID]);
  await admin.from("users").insert([{ email: PAID }, { email: SECOND }, { email: UNPAID }]);
  await admin.from("paid_emails").insert([
    { email: PAID, paid_at: new Date().toISOString() },
    { email: SECOND, paid_at: new Date().toISOString() },
  ]);

  const unpaid = await post({ action: "issueCode", email: UNPAID });
  check("POST reaches the handler (200, not blocked)", unpaid.status === 200, String(unpaid.status));
  check("unpaid is refused — they see the plan page", unpaid.body.ok === false && !unpaid.body.unavailable, unpaid.body.error ?? "");

  const issued = await post({ action: "issueCode", email: PAID });
  check("paid account: a 6-digit code is emailed via Brevo", issued.body.ok === true, issued.body.error ?? "");

  const good = await codeFor(PAID);
  check("the emailed code verifies", (await post({ action: "verifyCode", email: PAID, code: good })).body.ok === true);
  check("a wrong code is refused", (await post({ action: "verifyCode", email: PAID, code: good === "000000" ? "111111" : "000000" })).body.ok === false);

  const first = await post({ action: "claimKey", email: PAID, key: KEY });
  check("the first activation succeeds", first.body.ok === true, first.body.error ?? "");

  const again = await post({ action: "claimKey", email: PAID, key: KEY });
  check("the SAME user activating it again is refused", again.body.ok === false && again.body.alreadyInUse === true);
  check('  ...with exactly "License key already in use"', again.body.error === "License key already in use", again.body.error ?? "");

  const other = await post({ action: "claimKey", email: SECOND, key: KEY });
  check("a DIFFERENT user activating it is refused", other.body.ok === false && other.body.alreadyInUse === true);
  check('  ...with the same message', other.body.error === "License key already in use", other.body.error ?? "");

  const get = await fetch(base, { method: "GET" });
  check("GET is refused with 405", get.status === 405, String(get.status));

  // The lock is a DATABASE record, not app state — assert it directly.
  const row = await admin.from("users").select("license_key").eq("email", PAID).limit(1);
  const stored = ((row.data ?? []) as Array<{ license_key?: string | null }>)[0]?.license_key ?? "";
  check("the database itself holds the lock", stored.includes(KEY), stored);

  await admin.from("paid_emails").delete().in("email", [PAID, SECOND, UNPAID]);
  await admin.from("users").delete().in("email", [PAID, SECOND, UNPAID]);
  const left = await admin.from("users").select("email").in("email", [PAID, SECOND, UNPAID]);
  check("probe rows removed", (left.data ?? []).length === 0);

  server.stop();
  console.log(failures === 0 ? "RESULT: OK — the activation endpoint works over HTTP" : `RESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();