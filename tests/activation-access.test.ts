import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * "I ACTIVATE A KEY AND IT GOES BACK TO THE FIRST PAGE AND ASKS FOR MY EMAIL
 *  AND CODE AGAIN."
 *
 * That report is decided by ONE function — the gate every /app route guard
 * awaits, `requireVerifiedAccess` — so this test drives it directly against a
 * scripted /api/check-access and a scripted Supabase, with a session that has
 * just activated a licence key, and asserts the verdict the guard acts on.
 *
 * The two facts that must hold on the way into the app after an activation:
 *
 *   1. A LICENCE-KEY GRANT IS NOT A PAYMENT THE OWNER REVOKED. `activateKey`
 *      marks the email "paid" locally because the key proves the customer's
 *      entitlement to the mentor's EA. If the platform's ledger holds no
 *      subscription for that address it answers `unpaid` — and the gate used to
 *      read the local "paid" as evidence of a revoked payment, send the session
 *      to the DEACTIVATION notice and end it. The person then re-entered their
 *      email, waited for a fresh six-digit code, and only got in the second
 *      time round.
 *
 *   2. AN "UNPAID" ANSWER MUST NOT END THE SESSION EITHER. The plans screen is
 *      the honest answer for a ledger with no payment, and the email form is
 *      never the right screen for somebody who has already signed in — the
 *      session is what lets the app walk in by itself the moment the ledger
 *      agrees.
 *
 * A genuine revocation (`revoked`) still ends the session, and a device-binding
 * revocation still returns `signin`. Those two are asserted too, so the fix
 * cannot quietly become "the app stops locking anybody out".
 */

const DEVICE = "device-under-test";
const EMAIL = "client@example.com";

const supabase = vi.hoisted(() => ({
  rows: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    // The single-use licence lock reports "claimed" — the fallback writes below
    // it are not part of what this test is about.
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => supabase.rows[table] ?? { data: null, error: null },
          // The offline licence lock reads its row with `.limit(1)`. An
          // unscripted table answers "could not read" — the state every dead
          // store funnels into, which the tests below pin to the new wording.
          limit: async () => supabase.rows[table] ?? { data: null, error: { message: "connection failed" } },
        }),
      }),
    }),
  }),
}));

/**
 * Script every endpoint the activation path touches, by URL and action.
 *
 *   /api/mentor-status → no licence limit set   (the cap check must pass)
 *   /api/licenses      → the key, issued TO this email
 *   /api/activation    → the single-use claim succeeds
 *   /api/check-access  → whatever `access` says (the payment ledger)
 */
function scriptEndpoints(): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      seen.push(`${target} ${String(body["action"] ?? "")}`.trim());
      const reply = (payload: Record<string, unknown>, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => payload,
      });
      if (target.includes("/api/mentor-status")) return reply({ ok: true, found: false });
      if (target.includes("/api/licenses")) {
        if (body["action"] === "count") return reply({ ok: true, count: 0 });
        return reply({
          ok: true,
          found: true,
          license: {
            key: "EMP-AAAA-BBBB-CCCC",
            mentorEmail: "mentor@example.com",
            clientName: "Client",
            clientEmail: EMAIL,
            eaName: "Sniper Killer",
            eaId: "ea-1",
            expiry: "Lifetime",
            createdAt: "2026-01-01T00:00:00.000Z",
            claimedBy: null,
            claimedAt: null,
            symbols: ["AUDUSD"],
          },
        });
      }
      if (target.includes("/api/activation")) return reply({ ok: true });
      return reply(access.payload, access.status);
    }),
  );
  return seen;
}

/** What /api/check-access answers for this email. */
let access: { status: number; payload: Record<string, unknown> };

/** Fresh module graph per test, so the gate's in-memory cache never leaks. */
async function loadModules() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  const authStore = await import("../src/lib/auth-store");
  const appStore = await import("../src/lib/app-store");
  const gate = await import("../src/lib/payment-gate");
  return { authStore, appStore, gate };
}

/** A signed-in session with one activated robot — the state after activating. */
function seedSession(
  appStore: { getAppState: () => { email: string | null; robots: unknown[] } },
  sessionEmail: string = EMAIL,
) {
  window.localStorage.setItem(
    "eamp.app.v3",
    JSON.stringify({
      email: sessionEmail,
      activeRobotId: "r-1",
      robots: [
        { id: "r-1", key: "EMP-OLD1-OLD2-OLD3", name: "Older Robot", symbols: [], pairs: [], running: false },
      ],
    }),
  );
  window.localStorage.setItem("eamp.device.id", DEVICE);
  // Nothing else may kick this session on the way through the gate.
  window.localStorage.setItem("eamp.access-epoch.v1", "99");
  window.localStorage.setItem("eamp_session_v4", "99");
  expect(appStore.getAppState().email).toBe(sessionEmail);
}

beforeEach(() => {
  window.localStorage.clear();
  supabase.rows = {};
  // The cloud knows this device, so no binding revocation is in play.
  supabase.rows["users"] = { data: { device_email: EMAIL, device_id: DEVICE }, error: null };
  access = { status: 200, payload: { ok: true, isPaid: false, status: "unpaid" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: access.status < 400,
      status: access.status,
      json: async () => access.payload,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("the gate after a key activation", () => {
  it("answers `pay` — not `deactivate` — and keeps the session when the ledger has no payment", async () => {
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);
    // What `activateKey` writes: a LICENCE grant, not a platform payment.
    authStore.markEmailPaid(EMAIL, "license");
    expect(authStore.paymentStatusForEmail(EMAIL)).toBe("paid");

    const verdict = await gate.requireVerifiedAccess(EMAIL);

    expect(verdict.action, "a key activation must not read as a revoked payment").toBe("pay");
    expect(
      appStore.getAppState().email,
      "the session must survive, or the app asks for the email and code all over again",
    ).toBe(EMAIL);
  });

  it("still ends the session for a payment the owner actually revoked", async () => {
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);
    // A LEDGER payment (Whop / the console's Mark paid), then the ledger says
    // unpaid — that IS "Mark unpaid", and the notice must be shown.
    authStore.markEmailPaid(EMAIL);

    const verdict = await gate.requireVerifiedAccess(EMAIL);

    expect(verdict.action).toBe("deactivate");
    expect(appStore.getAppState().email).toBeNull();
  });

  it("answers `deactivate` and ends the session when the cloud revokes the account", async () => {
    access = { status: 200, payload: { ok: true, isPaid: false, status: "revoked" } };
    const { appStore, gate } = await loadModules();
    seedSession(appStore);

    const verdict = await gate.requireVerifiedAccess(EMAIL);

    expect(verdict.action).toBe("deactivate");
    expect(appStore.getAppState().email).toBeNull();
  });

  it("opens the app for a paid account", async () => {
    access = { status: 200, payload: { ok: true, isPaid: true, status: "paid", paidAt: "2026-01-01T00:00:00.000Z" } };
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);

    const verdict = await gate.requireVerifiedAccess(EMAIL);

    expect(verdict.action).toBe("pass");
    expect(appStore.getAppState().email).toBe(EMAIL);
    expect(authStore.paymentStatusForEmail(EMAIL)).toBe("paid");
  });

  it("keeps the session when the access check cannot answer at all (fail closed, no re-sign-in)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);
    authStore.markEmailPaid(EMAIL, "license");

    const verdict = await gate.requireVerifiedAccess(EMAIL);

    // A store that could not be read is not "unpaid": the answer is `retry`
    // with the plain message, so a paying customer is never sent to the plan
    // chooser because a read failed. It is still never a pass.
    expect(verdict.action, "an undecided cloud is a refusal, never a pass").toBe("retry");
    expect(verdict.message).toBe(gate.VERIFY_RETRY_MESSAGE);
    expect(appStore.getAppState().email).toBe(EMAIL);
  });

  it("remembers WHERE the local paid record came from across a page load", async () => {
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);
    authStore.markEmailPaid(EMAIL, "license");

    // A reload: fresh modules, same localStorage.
    vi.resetModules();
    const reloaded = await import("../src/lib/auth-store");
    const reloadedGate = await import("../src/lib/payment-gate");

    expect(reloaded.paymentSourceForEmail(EMAIL)).toBe("license");
    expect(reloadedGate.remembersLedgerPayment(EMAIL)).toBe(false);
    await expect(reloadedGate.requireVerifiedAccess(EMAIL)).resolves.toMatchObject({ action: "pay" });
  });

  it("does not read a payment-EXEMPT address as a revoked payment", async () => {
    // `paymentStatusForEmail` answers "admin" for the exempt list whatever the
    // ledger says. That is not a receipt — the old code was explicit about it —
    // and it must not become the deactivation notice either.
    const exempt = "biyasenteko222@gmail.com";
    supabase.rows["users"] = { data: { device_email: exempt, device_id: DEVICE }, error: null };
    const { appStore, gate } = await loadModules();
    seedSession(appStore, exempt);

    const verdict = await gate.requireVerifiedAccess(exempt);

    expect(verdict.action).toBe("pay");
    expect(gate.remembersLedgerPayment(exempt)).toBe(false);
  });

  it("does not let a later licence grant downgrade a recorded payment", async () => {
    const { authStore } = await loadModules();

    authStore.markEmailPaid(EMAIL);
    authStore.markEmailPaid(EMAIL, "license");

    expect(authStore.paymentSourceForEmail(EMAIL)).toBe("ledger");
  });
});

/**
 * THE END-TO-END VERSION OF THE REPORT: activate a real key, then walk into the
 * app. `activateKey` is the app's own activation path (KV lookup, single-use
 * claim, robot creation) — NOT a hand-written local record — so this is what
 * pins the fix at its source: the activation must record a LICENCE grant, and
 * the very next gate check must therefore read an unpaid ledger as "pay", keep
 * the session, and never ask for the email and the six-digit code again.
 */
describe("activating a key, then walking into the app", () => {
  it("records a licence grant, so the next check does not call the account deactivated", async () => {
    const calls = scriptEndpoints();
    const { authStore, appStore, gate } = await loadModules();
    seedSession(appStore);

    const result = await appStore.activateKey("EMP-AAAA-BBBB-CCCC");

    expect(result.error, `activation refused: ${result.error ?? ""}`).toBeUndefined();
    expect(result.robot?.name).toBe("Sniper Killer");
    expect(calls).toContain("/api/activation claimKey");
    expect(
      authStore.paymentSourceForEmail(EMAIL),
      "the activation must be recorded as a LICENCE grant, not a platform payment",
    ).toBe("license");

    // The ledger has no subscription for this mentor's client.
    access = { status: 200, payload: { ok: true, isPaid: false, status: "unpaid" } };
    const verdict = await gate.requireVerifiedAccess(EMAIL);

    expect(verdict.action, "a key activation must not read as a revoked payment").toBe("pay");
    expect(appStore.getAppState().email, "the session must survive the walk-in").toBe(EMAIL);
    expect(
      appStore.getAppState().robots.some((robot) => robot.key === "EMP-AAAA-BBBB-CCCC"),
      "the activated robot must be on the device after the walk-in",
    ).toBe(true);
  });
});

/**
 * THE REPORT ITSELF — "We could not check that licence key. Please try again."
 * on the Activate screen.
 *
 * That sentence was written only by store-FAILURE paths, never by anything
 * wrong with the key: a dropped answer from /api/activation sent the customer
 * into a fallback that read a database which no longer answers, and every
 * retry landed in the same place. These cases drive `activateKey` — the call
 * the Activate screen actually makes — through those failure modes and pin
 * what the customer sees instead.
 */
describe("an activation whose stores fail", () => {
  /**
   * Script every endpoint, with two overrides: `activation: "drop"` loses the
   * server's answer on the way back (the common mobile-network failure), and
   * `claim` decides what /api/licenses answers the fallback lock — a payload,
   * or "drop" to lose that answer too.
   */
  function stubEndpoints(overrides: {
    activation?: "drop";
    claim: Record<string, unknown> | "drop";
  }) {
    const seen: string[] = [];
    const reply = (payload: Record<string, unknown>, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => payload,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        seen.push(`${target} ${String(body["action"] ?? "")}`.trim());
        if (target.includes("/api/activation") && overrides.activation === "drop") {
          throw new Error("connection dropped mid-request");
        }
        if (target.includes("/api/activation")) return reply({ ok: true });
        if (target.includes("/api/mentor-status")) return reply({ ok: true, found: false });
        if (target.includes("/api/licenses")) {
          if (body["action"] === "count") return reply({ ok: true, count: 0 });
          if (body["action"] === "claim") {
            if (overrides.claim === "drop") throw new Error("connection dropped mid-request");
            return reply(overrides.claim);
          }
          return reply({
            ok: true,
            found: true,
            license: {
              key: "EMP-AAAA-BBBB-CCCC",
              mentorEmail: "mentor@example.com",
              clientName: "Client",
              clientEmail: EMAIL,
              eaName: "Sniper Killer",
              eaId: "ea-1",
              expiry: "Lifetime",
              createdAt: "2026-01-01T00:00:00.000Z",
              claimedBy: null,
              claimedAt: null,
              symbols: ["AUDUSD"],
            },
          });
        }
        return reply(access.payload, access.status);
      }),
    );
    return seen;
  }

  it("gets the customer in when the server's answer is lost and nobody holds the key yet", async () => {
    const seen = stubEndpoints({ activation: "drop", claim: { ok: true } });
    const { appStore } = await loadModules();
    seedSession(appStore);

    const result = await appStore.activateKey("EMP-AAAA-BBBB-CCCC");

    expect(result.error, `activation refused: ${result.error ?? ""}`).toBeUndefined();
    expect(result.robot?.name).toBe("Sniper Killer");
    // The claim is NEVER re-asked at the strong endpoint — its recovery path
    // is the fallback lock, so a re-ask could never find the lock already
    // written and refuse its own customer.
    expect(seen.filter((call) => call.startsWith("/api/activation"))).toHaveLength(1);
    expect(seen).toContain("/api/licenses claim");
  });

  it("accepts the customer's OWN lock when the lost answer was this account's own claim", async () => {
    // The first attempt DID land server-side; only its response was dropped.
    // The lock now names this very account — the case that used to strand the
    // customer on a key they hold, refused by their own lock on every retry.
    stubEndpoints({
      activation: "drop",
      claim: { ok: false, alreadyInUse: true, heldBy: EMAIL, error: "License key already in use" },
    });
    const { appStore } = await loadModules();
    seedSession(appStore);

    const result = await appStore.activateKey("EMP-AAAA-BBBB-CCCC");

    expect(
      result.error,
      `the holder's own account must not be refused its own lock: ${result.error ?? ""}`,
    ).toBeUndefined();
    expect(result.robot?.name).toBe("Sniper Killer");
  });

  it("says the store is busy — never 'could not check that licence key' — when every store is down", async () => {
    stubEndpoints({ activation: "drop", claim: "drop" });
    const { appStore } = await loadModules();
    seedSession(appStore);

    const result = await appStore.activateKey("EMP-AAAA-BBBB-CCCC");

    expect(result.error, "two dead stores must still answer the customer").toBeTruthy();
    expect(result.error).toContain("Licence storage is busy right now");
    expect(
      result.error,
      "the reported sentence must be gone from every failure path",
    ).not.toContain("could not check that licence key");
    expect(result.robot, "nothing may be created when no lock could be taken").toBeUndefined();
  });
});
