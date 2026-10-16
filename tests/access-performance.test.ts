import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * "THE APP IS SLOW EVERYWHERE" — THE GUARD WAS THE REASON.
 *
 * Every `/app` route awaits `requireVerifiedAccess`, and until now one
 * navigation could stack three or four sequential serverless round trips
 * before a screen rendered:
 *
 *   1. /app/home's own `resolveCloudAccess(fresh)` — a cache-bypassing POST,
 *   2. `getDeviceBinding`   — a Supabase READ for the device binding,
 *   3. `resolveCloudAccess` inside the gate — a second POST for the ledger,
 *   4. `bindDeviceToEmail`  — a Supabase READ + WRITE on EVERY navigation.
 *
 * These tests pin the fix at the level the user actually experiences it —
 * counting the network calls the gate makes — and re-assert the security
 * rules that must survive it: unpaid still refuses, revoked still ends the
 * session, an undecided cloud still fails closed, and a device the cloud does
 * not recognise still gets signed out.
 *
 * The endpoint under test answers the way /api/check-access answers after the
 * change: the payment verdict AND the device binding arrive in one response.
 */
const DEVICE = "device-under-test";
const EMAIL = "client@example.com";

type BindingPayload = { deviceEmail: string | null; deviceId: string | null } | null;

const supabase = vi.hoisted(() => ({
  rows: {} as Record<string, { data: unknown; error: unknown }>,
  reads: 0,
  writes: 0,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            supabase.reads += 1;
            return supabase.rows[table] ?? { data: null, error: null };
          },
        }),
      }),
      update: (_payload: Record<string, unknown>) => ({
        eq: async () => {
          supabase.writes += 1;
          return { error: null };
        },
      }),
    }),
  }),
}));

/** What /api/check-access answers — payment verdict plus device binding. */
let access: {
  status: number;
  payload: Record<string, unknown>;
};

/** Every request the gate (or the store behind it) sends. */
let calls: string[];

/** Script the endpoints, and record every call so the count can be asserted. */
function scriptEndpoints(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push(`${target} ${String(body["action"] ?? "")}`.trim());
      const reply = (payload: Record<string, unknown>, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => payload,
      });
      return reply(access.payload, access.status);
    }),
  );
}

const checkAccessCalls = () => calls.filter((entry) => entry.includes("/api/check-access")).length;

/** A paid cloud answer, bound to THIS device (the state after a sign-in). */
function paidAnswer(binding: BindingPayload): void {
  access = {
    status: 200,
    payload: {
      ok: true,
      isPaid: true,
      status: "paid",
      paidAt: "2026-01-01T00:00:00.000Z",
      deviceBinding: binding,
    },
  };
}

/** Fresh module graph per test, so the gate's in-memory caches never leak. */
async function loadGate() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  const appStore = await import("../src/lib/app-store");
  const gate = await import("../src/lib/payment-gate");
  return { appStore, gate };
}

/** A signed-in session — the state of somebody already inside the app. */
function seedSession(appStore: { getAppState: () => { email: string | null } }): void {
  window.localStorage.setItem(
    "eamp.app.v3",
    JSON.stringify({
      email: EMAIL,
      activeRobotId: "r-1",
      robots: [{ id: "r-1", key: "EMP-AAAA-BBBB-CCCC", name: "Robot", symbols: [], pairs: [], running: false }],
    }),
  );
  window.localStorage.setItem("eamp.device.id", DEVICE);
  // Nothing else may kick this session on the way through the gate.
  window.localStorage.setItem("eamp.access-epoch.v1", "99");
  window.localStorage.setItem("eamp_session_v4", "99");
  expect(appStore.getAppState().email).toBe(EMAIL);
}

beforeEach(() => {
  window.localStorage.clear();
  supabase.rows = {};
  supabase.reads = 0;
  supabase.writes = 0;
  paidAnswer({ deviceEmail: EMAIL, deviceId: DEVICE });
  scriptEndpoints();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("one navigation, one round trip", () => {
  it("answers the guard and the home screen's own re-check from a single call", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);

    // 1. the route's beforeLoad …
    const first = await gate.requireVerifiedAccess(EMAIL);
    // 2. … then the /app/home component, which re-checks the moment it mounts.
    const second = await gate.requireVerifiedAccess(EMAIL);

    expect(first.action).toBe("pass");
    expect(second.action).toBe("pass");
    expect(checkAccessCalls(), "a navigation must make ONE access round trip").toBe(1);
    expect(supabase.reads, "the binding came back on the same call — no second read").toBe(0);
    expect(supabase.writes, "already bound to this device — no bind write").toBe(0);
  });

  it("answers a warm navigation with NO network call at all", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    vi.useFakeTimers({ toFake: ["Date"] });

    await gate.requireVerifiedAccess(EMAIL); // cold: one round trip
    expect(checkAccessCalls()).toBe(1);

    // Past the navigation window (so the window is NOT what answers), still
    // well inside the five minutes a confirmed-paid answer is held for.
    vi.setSystemTime(Date.now() + 120_000);
    const later = await gate.requireVerifiedAccess(EMAIL);

    expect(later.action).toBe("pass");
    expect(checkAccessCalls(), "the cached path must not touch the network").toBe(1);
    expect(supabase.reads).toBe(0);
  });

  it("still asks the cloud when a caller passes `fresh` (sign-in, checkout return)", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);

    await gate.requireVerifiedAccess(EMAIL); // fills the navigation window
    const fresh = await gate.requireVerifiedAccess(EMAIL, { fresh: true });

    expect(fresh.action).toBe("pass");
    expect(checkAccessCalls(), "`fresh` must bypass the window and re-verify").toBe(2);
  });

  it("drops the cached verdict the moment payment access is invalidated", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    vi.useFakeTimers({ toFake: ["Date"] });

    await gate.requireVerifiedAccess(EMAIL);
    vi.setSystemTime(Date.now() + 120_000);
    await gate.requireVerifiedAccess(EMAIL);
    expect(checkAccessCalls()).toBe(1);

    gate.invalidateAccessCache(EMAIL); // a payment landing, a revocation, …
    await gate.requireVerifiedAccess(EMAIL);
    expect(checkAccessCalls(), "after invalidation the cloud is asked again").toBe(2);
  });
});

describe("the device-binding write", () => {
  it("runs once for a genuinely new device and never again while it is bound", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    vi.useFakeTimers({ toFake: ["Date"] });

    // The cloud has a registration row for this email but no device bound yet
    // — which is exactly the state `bindDeviceToEmail` needs to bind.
    supabase.rows["users"] = { data: { device_email: null, device_id: null }, error: null };
    paidAnswer(null);
    const first = await gate.requireVerifiedAccess(EMAIL);
    expect(first.action).toBe("pass");
    expect(supabase.reads, "the bind does its own read before writing").toBeGreaterThan(0);
    expect(supabase.writes, "an unbound email is bound — exactly once").toBe(1);

    // From now on the cloud reports THIS device, as a real deployment does
    // after that write landed.
    paidAnswer({ deviceEmail: EMAIL, deviceId: DEVICE });
    supabase.reads = 0;
    supabase.writes = 0;
    vi.setSystemTime(Date.now() + 60_000);
    const second = await gate.requireVerifiedAccess(EMAIL);

    expect(second.action).toBe("pass");
    expect(supabase.writes, "a bound device is never re-bound on navigation").toBe(0);
    expect(supabase.reads, "the binding arrives with the payment answer").toBe(0);
  });
});

describe("the security rules, unchanged by any of this", () => {
  it("unpaid → `pay` (checkout), and the session survives", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    access = {
      status: 200,
      payload: {
        ok: true,
        isPaid: false,
        status: "unpaid",
        deviceBinding: { deviceEmail: EMAIL, deviceId: DEVICE },
      },
    };

    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action).toBe("pay");
    expect(appStore.getAppState().email).toBe(EMAIL);
  });

  it("revoked → `deactivate`, and the session ends", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    access = {
      status: 200,
      payload: {
        ok: true,
        isPaid: false,
        status: "revoked",
        deviceBinding: { deviceEmail: EMAIL, deviceId: DEVICE },
      },
    };

    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action).toBe("deactivate");
    expect(appStore.getAppState().email).toBeNull();
  });

  it("the cloud cannot answer → fail closed (`pay`), never a pass", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action, "an undecided cloud is a refusal, never a pass").toBe("pay");
    expect(appStore.getAppState().email).toBe(EMAIL);
  });

  it("a binding that belongs to ANOTHER device still ends the session", async () => {
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    paidAnswer({ deviceEmail: EMAIL, deviceId: "someone-elses-phone" });

    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action, "a session on an unrecognised device is dead").toBe("signin");
    expect(appStore.getAppState().email).toBeNull();
  });

  it("falls back to this device's own binding read when the server omits it", async () => {
    // An older /api/check-access build (or an unreadable column) answers the
    // ledger WITHOUT `deviceBinding`. The gate must not invent a binding — it
    // reads this device's copy, exactly as it did before, and a mismatch still
    // signs the session out.
    const { appStore, gate } = await loadGate();
    seedSession(appStore);
    supabase.rows["users"] = { data: { device_email: EMAIL, device_id: "old-phone" }, error: null };
    // The server answers the ledger WITHOUT the binding key at all.
    access = {
      status: 200,
      payload: { ok: true, isPaid: true, status: "paid", paidAt: "2026-01-01T00:00:00.000Z" },
    };

    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action).toBe("signin");
    expect(appStore.getAppState().email).toBeNull();
    expect(supabase.reads, "the fallback read is the old behaviour, not a new one").toBeGreaterThan(0);
  });
});
