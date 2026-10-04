/**
 * /api/portal, over a real socket — the two things the console could not do.
 *
 * Mounted exactly the way Vercel mounts `/api/*.ts` and driven with `fetch`,
 * the same thing the browser does.
 *
 * WHAT IT PROVES
 *   POST sendEmail     → exactly one Brevo call, to the right address, with
 *                        the right subject (this is the path that was dead in
 *                        production, so it is the one that matters)
 *   POST deleteMessage → the row is REALLY gone from `app_messages`
 *   ... non-admin      → refused, and the row survives
 *   ... missing admin  → refused
 *   GET                → 405
 *
 * HOW the send is observed: `globalThis.fetch` is wrapped so calls to
 * api.brevo.com are recorded and answered locally. **No email is ever really
 * sent.** Everything else (the Supabase client) passes straight through.
 *
 * READ/WRITE: it inserts and removes ONLY rows it created itself, on the
 * reserved `@eamigratepro.invalid` domain, and removes them at the end.
 *
 * Run: bun scripts/verify-portal-fn.ts
 */
import { createClient } from "@supabase/supabase-js";
import handler from "../api/portal";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const ADMIN = "probe.portal.admin@eamigratepro.invalid";
const NOTADMIN = "probe.portal.plain@eamigratepro.invalid";
const MSG_ID = "probe-portal-msg-001";
const PROBES = [ADMIN, NOTADMIN];

/** Every outbound Brevo call, captured live. */
const sent: Array<{ to: string; subject: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (target.includes("api.brevo.com")) {
    let to = "";
    let subject = "";
    try {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        to?: Array<{ email?: string }>;
        subject?: string;
      };
      to = parsed.to?.[0]?.email ?? "";
      subject = parsed.subject ?? "";
    } catch {
      /* recorded as unreadable */
    }
    sent.push({ to, subject });
    return new Response(JSON.stringify({ messageId: "<probe>" }), { status: 201 });
  }
  return realFetch(input, init);
}) as typeof fetch;

type Reply = { ok: boolean; error?: string };
type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(c: number): ApiResponse;
  json(b: unknown): void;
  setHeader(n: string, v: string): void;
};

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/api/portal") return new Response("not found", { status: 404 });
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
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  },
});

const base = `http://localhost:${server.port}/api/portal`;

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
  // Clean slate. The admin row needs is_admin=true; the other must NOT have it.
  await admin.from("app_messages").delete().eq("id", MSG_ID);
  await admin.from("users").delete().in("email", PROBES);
  await admin.from("users").insert([
    { email: ADMIN, is_admin: true },
    { email: NOTADMIN, is_admin: false },
  ]);
  await admin.from("app_messages").insert({
    id: MSG_ID,
    body: "probe message",
    sent_at: new Date().toISOString(),
    recipients: 1,
    sender: "probe",
  });

  /* ── sendEmail ─────────────────────────────────────────────────────── */
  const before = sent.length;
  const mailed = await post({
    action: "sendEmail",
    to: NOTADMIN,
    subject: "EA Migrate probe",
    html: "<p>probe</p>",
    text: "probe",
  });
  check("sendEmail is accepted", mailed.body.ok === true, mailed.body.error ?? "");
  check("exactly one Brevo call", sent.length === before + 1, `${sent.length - before}`);
  const last = sent[sent.length - 1];
  check("addressed to the recipient", last?.to === NOTADMIN, last?.to || "none");
  check("carries the subject", last?.subject === "EA Migrate probe", last?.subject || "none");

  const bad = await post({ action: "sendEmail", to: "not-an-email", subject: "x", html: "<p>x</p>" });
  check("a malformed address is refused", bad.body.ok === false, bad.body.error ?? "");

  /* ── deleteMessage ─────────────────────────────────────────────────── */
  const exists = async () => ((await admin.from("app_messages").select("id").eq("id", MSG_ID)).data ?? []).length;
  check("precondition: the row exists", (await exists()) === 1);

  const noAdmin = await post({ action: "deleteMessage", id: MSG_ID });
  check("no adminEmail is refused", noAdmin.status === 401 && noAdmin.body.ok === false, `${noAdmin.status} ${noAdmin.body.error ?? ""}`);
  check("  ...and the row survives", (await exists()) === 1);

  const plain = await post({ action: "deleteMessage", id: MSG_ID, adminEmail: NOTADMIN });
  check("a NON-admin is refused", plain.status === 403 && plain.body.ok === false, `${plain.status} ${plain.body.error ?? ""}`);
  check("  ...and the row survives", (await exists()) === 1);

  const removed = await post({ action: "deleteMessage", id: MSG_ID, adminEmail: ADMIN });
  check("an admin CAN delete it", removed.body.ok === true, removed.body.error ?? "");
  check("  ...the row is REALLY gone from the database", (await exists()) === 0);

  const again = await post({ action: "deleteMessage", id: MSG_ID, adminEmail: ADMIN });
  check("deleting it again is not reported as success", again.body.ok === false, again.body.error ?? "");

  const get = await fetch(base, { method: "GET" });
  check("GET is refused with 405", get.status === 405, String(get.status));

  // Clean up only what this probe created.
  await admin.from("app_messages").delete().eq("id", MSG_ID);
  await admin.from("users").delete().in("email", PROBES);
  check("probe rows removed", ((await admin.from("users").select("email").in("email", PROBES)).data ?? []).length === 0);

  globalThis.fetch = realFetch;
  server.stop();
  console.log(
    failures === 0
      ? "RESULT: OK — email sends and the admin can clear a message"
      : `RESULT: ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
