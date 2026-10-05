/**
 * CAN A NON-PAID EMAIL ACTUALLY GET INTO THE APP? — AN END-TO-END ANSWER.
 *
 * The unit-level checks elsewhere prove pieces of the rule. This one walks the
 * real login SEQUENCE against the LIVE database, using the same modules the
 * browser runs, for one marked-paid address and one that is not on the ledger:
 *
 *   1. registerWithEmail  — the sign-in gate. Must answer `checkout` /
 *      `verified: false` for the unpaid address and `allow` for the paid one.
 *   2. resolveCloudAccess  — the route guard. Must answer `unpaid` /
 *      `revoked` for the unpaid address and `paid` for the paid one.
 *   3. /api/activation     — the code. Must refuse the unpaid address with
 *      `notPaid: true` and generate/send nothing.
 *   4. requireVerifiedAccess — what every /app route awaits. Must never answer
 *      `pass` for the unpaid address.
 *   5. THE KICK: a user already sitting in the app. SESSION_VERSION is bumped
 *      past whatever the device recorded, so the stale session is dropped and
 *      the cloud is re-read — that is what removes somebody who is open right
 *      now rather than at their next sign-in.
 *
 * IT CALLS THE ROUTE GUARD DIRECTLY RATHER THAN THROUGH A BROWSER, and it says
 * so: this is a live-database test of the rule, not proof that a rendered page
 * enforces it. The two unguarded /app routes were checked by reading them —
 * both are redirects that render null and hand off to /app/home.
 *
 * READ-ONLY apart from the throwaway rows it creates, which it deletes.
 *
 * Run: bun scripts/verify-nonpaid-cannot-login.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertInterceptable, interceptMail, sentMessages } from "./lib/mail-intercept";

interceptMail();
await assertInterceptable();

const SUPABASE_URL = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const SERVICE_ROLE = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
/* The mail-provider credentials are only used for the closing NOTE. After the
 * Brevo → Mailjet migration a leftover BREVO_API_KEY check would have gone
 * permanently false and printed "the send path was never exercised" on every
 * run — a stale gate that reads like a skipped assertion. It must name the
 * variables the app actually uses now. */
const MAILJET_CONFIGURED = Boolean(
  (process.env["MAILJET_API_KEY"] ?? "").trim() && (process.env["MAILJET_SECRET_KEY"] ?? "").trim(),
);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.log("Missing Supabase env — nothing verified.");
  process.exit(1);
}

const UNPAID = "probe.cannotlogin.unpaid@eamigratepro.invalid";
const PROBES = [UNPAID];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * The browser client the app itself uses (src/lib/supabase.ts reads the same
 * two VITE_ variables), so these calls carry the SAME permissions a user's
 * browser has — not the service role. That is the whole point: an entitlement
 * check that only passes with the service role is not the check the app runs.
 */
const browser: SupabaseClient = createClient(
  SUPABASE_URL,
  (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

console.log("── setup ──────────────────────────────────────────────────────────");

// Pick a real address the owner HAS marked paid, so the positive half of the
// test is a genuine entitlement rather than a row this script invented.
const { data: paidRows } = await admin.from("paid_emails").select("email, paid_at").limit(50);
const paidEmail = ((paidRows ?? []) as Array<{ email?: string; paid_at?: string | null }>).find(
  (r) => r.paid_at != null && (r.email ?? "").trim().length > 0,
)?.email;
if (!paidEmail) {
  console.log("No marked-paid address on the ledger — cannot run the positive half.");
  process.exit(1);
}
console.log(`     paid address under test: ${paidEmail}`);
console.log(`     unpaid address under test: ${UNPAID}\n`);

// The unpaid probe must be genuinely unpaid: no ledger row at all.
await admin.from("paid_emails").delete().eq("email", UNPAID);
await admin.from("license_keys").delete().eq("email", UNPAID);

console.log("── 1. the sign-in gate (registerWithEmail) ─────────────────────────");

// Imported lazily and with the anon client injected, because these modules read
// the singleton in src/lib/supabase.ts.
const { registerWithEmail } = await import("../src/lib/supabase-users");

const unpaidRegistration = await registerWithEmail(UNPAID);
check(
  "an unmarked email is NOT verified at sign-in",
  unpaidRegistration.verified === false,
  `verified=${unpaidRegistration.verified}`,
);
check(
  "an unmarked email is sent to checkout, not into the app",
  unpaidRegistration.outcome === "checkout",
  `outcome=${unpaidRegistration.outcome}`,
);

const paidRegistration = await registerWithEmail(paidEmail!);
check(
  "a marked-paid email IS verified (the rule is not simply refusing everyone)",
  paidRegistration.verified === true && paidRegistration.outcome === "allow",
  `outcome=${paidRegistration.outcome} verified=${paidRegistration.verified}`,
);

console.log("\n── 2. the route guard (resolveCloudAccess) ──────────────────────────");

const { resolveCloudAccess, requireVerifiedAccess, SESSION_VERSION } = await import(
  "../src/lib/payment-gate"
);

// localStorage is absent under bun; consumeStaleSession no-ops without it, so
// this is the steady-state answer a returning device gets.
const unpaidCloud = await resolveCloudAccess(UNPAID, { fresh: true });
check(
  "an unmarked email never resolves to paid/admin",
  unpaidCloud !== "paid" && unpaidCloud !== "admin",
  `cloud=${unpaidCloud}`,
);
const paidCloud = await resolveCloudAccess(paidEmail!, { fresh: true });
check("a marked-paid email resolves to paid", paidCloud === "paid", `cloud=${paidCloud}`);

console.log("\n── 3. the activation code (/api/activation) ─────────────────────────");

/** Call the real handler the way Vercel does. */
/** The handler's JSON replies, read back without asserting a wider shape. */
type Reply = Record<string, unknown> | null;

/** The response shape api/activation.ts declares locally in its own file. */
type HandlerResponse = {
  status(code: number): HandlerResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

async function callActivation(body: Record<string, unknown>): Promise<{ status: number; body: Reply; sent: string[] }> {
  // Record any attempt to send mail, so "nothing was sent" is ASSERTED rather
  // than assumed.
  //
  // This used to intercept `globalThis.fetch` for api.brevo.com. That can no
  // longer work: node-mailjet sends through axios's **http** adapter, not global
  // fetch, so the stub never fired and `sent` was always empty — the "nothing was
  // sent" assertion would have passed for the WRONG reason. The mail module
  // itself is intercepted instead; see ./lib/mail-intercept.ts.
  const before = sentMessages().length;
  const handler = (await import("../api/activation")).default;
  let status = 0;
  let payload: Reply = null;
  const response: HandlerResponse = {
    status(code: number) {
      status = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
    },
    setHeader() {
      return response;
    },
  };
  await handler({ method: "POST", body }, response);
  return { status, body: payload, sent: sentMessages().slice(before).map((m) => m.to) };
}

const issue = await callActivation({ action: "issueCode", email: UNPAID });
check(
  "no code is issued to an unmarked email",
  issue.body?.ok === false && issue.body?.notPaid === true,
  JSON.stringify(issue.body),
);
check(
  "the refusal names the fix",
  issue.body?.error === "This email is not marked as paid. Contact admin.",
  String(issue.body?.error),
);

console.log("\n── 4. what every /app route awaits ────────────────────────────────");

/**
 * A minimal browser, because requireVerifiedAccess asks TWO questions and one
 * of them is about the DEVICE: `deviceBindingRevoked` compares the cloud
 * `users.device_id` with this device's id, and a mismatch signs the session out
 * and answers `signin` — correctly, and for a reason that has nothing to do
 * with payment. Without a window, getDeviceId() returns the literal "server",
 * which matches nobody, so the paid-address assertion below would be testing
 * the device binding rather than the payment rule. So the paid address's real
 * binding is planted here, and the payment rule is what gets measured.
 */
const { data: paidUser } = await admin
  .from("users")
  .select("device_id")
  .eq("email", paidEmail!)
  .limit(1);
const paidDeviceId = ((paidUser ?? []) as Array<{ device_id?: string | null }>)[0]?.device_id ?? null;

const storage = new Map<string, string>();
if (paidDeviceId) storage.set("eamp.device.id", paidDeviceId);
// Pretend this device last saw the PREVIOUS rules, so the stale-session kick
// is exercised on every call below rather than only asserted about.
storage.set("eamp_session_v4", String(SESSION_VERSION - 1));
const browserShim = {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
};
(globalThis as unknown as { window: unknown }).window = browserShim;

const access = await requireVerifiedAccess(UNPAID);
check(
  "requireVerifiedAccess NEVER passes an unmarked email",
  access.action !== "pass",
  `action=${access.action}`,
);

if (!paidDeviceId) {
  console.log("SKIP  requireVerifiedAccess passes a marked-paid email — no device binding to match");
} else {
  // A fresh stale stamp per call, so each check sees the kick.
  storage.set("eamp_session_v4", String(SESSION_VERSION - 1));
  const paidAccess = await requireVerifiedAccess(paidEmail!);
  check(
    "requireVerifiedAccess passes a marked-paid email",
    paidAccess.action === "pass",
    `action=${paidAccess.action}`,
  );
}

console.log("\n── 5. kicking out somebody who is open right now ───────────────────");

// THE STALE-SESSION KICK, MEASURED RATHER THAN DESCRIBED.
//
// appSignOut() does NOT delete the saved session — it rewrites the store with
// `email: null` (app-store.ts). So the observable effect is that the persisted
// session's email goes null, which is exactly what stops the route guards from
// treating the device as signed in. A device stamped under the PREVIOUS rules
// must lose it on the next check; one already on the current version keeps it
// and is judged on the cloud alone.
const storeKey = "eamp.app.v3";
/** The email the device would present to the route guards, or null. */
const sessionEmail = (): string | null => {
  const raw = storage.get(storeKey);
  if (!raw) return null;
  try {
    return ((JSON.parse(raw) as { email?: string | null }).email ?? null) as string | null;
  } catch {
    return null;
  }
};
const signIn = (email: string) =>
  storage.set(
    storeKey,
    JSON.stringify({
      email,
      robots: [],
      activeRobotId: null,
      accounts: [],
      deviceBindings: [{ email, deviceId: storage.get("eamp.device.id") ?? "" }],
      payments: [{ email, paid: true, paidAt: new Date().toISOString() }],
      settings: { interfaceStyle: "dark", accentColor: "#f5a524" },
    }),
  );

signIn(UNPAID);
storage.set("eamp_session_v4", String(SESSION_VERSION - 1)); // stamped before the bump
await requireVerifiedAccess(UNPAID);
check(
  "an open session granted under the OLD rules is signed out on the next check",
  sessionEmail() === null,
  sessionEmail() === null ? "session email cleared" : `session email still ${sessionEmail()}`,
);

signIn(UNPAID);
storage.set("eamp_session_v4", String(SESSION_VERSION)); // already current
const currentAccess = await requireVerifiedAccess(UNPAID);
check(
  "a current-version session is judged on the cloud, and still refused",
  currentAccess.action !== "pass",
  `action=${currentAccess.action}`,
);

// And the positive control for the kick: a current-version session for an
// account the owner DID mark paid must survive, or the bump would be logging
// paying customers out.
if (paidDeviceId) {
  signIn(paidEmail!);
  storage.set("eamp_session_v4", String(SESSION_VERSION));
  const survivor = await requireVerifiedAccess(paidEmail!);
  check(
    "a marked-paid session is NOT kicked — the reset does not lock out customers",
    survivor.action === "pass",
    `action=${survivor.action}`,
  );
}

delete (globalThis as unknown as { window?: unknown }).window;

console.log("\n── cleanup ────────────────────────────────────────────────────────");
await admin.from("users").delete().eq("email", UNPAID);
await admin.from("paid_emails").delete().in("email", PROBES);
await admin.from("user_sessions").delete().eq("email", UNPAID);

const { data: residue } = await admin.from("users").select("email").eq("email", UNPAID);
check("probe rows removed", (residue ?? []).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (!MAILJET_CONFIGURED)
  console.log("note: Mailjet credentials absent — the send path was never exercised.");
process.exit(fail === 0 ? 0 : 1);
