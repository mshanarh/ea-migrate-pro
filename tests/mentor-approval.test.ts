import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE MENTOR'S OWN PORTAL MUST SHOW THE ADMIN'S DECISION.
 *
 * Reported symptom: "I am approving a user and it says pending on that user
 * but I approved it — it shows the pending card as it shows after the user is
 * done to register." The decision is written to Upstash KV by the admin
 * console; the portal's dashboard poll (`portalGetAccount`) is what carries it
 * onto the mentor's screen. These tests drive that poll against a scripted
 * Supabase + a scripted /api/mentor-status answer and assert the status the
 * mentor actually sees.
 */

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  replies: {} as Record<string, Reply>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => state.replies[table] ?? { data: null, error: null },
        }),
      }),
    }),
  }),
}));

/** The KV answer /api/mentor-status gives for this email. */
let kv: { status: number; payload: Record<string, unknown> };

/** The stored account blob — the copy the portal signed up with. */
function storedAccount(status: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "m-1",
    email: "mentor@example.com",
    firstName: "Biyu",
    displayName: "Biyu",
    username: "biyu",
    whatsapp: "",
    password: "secret",
    role: "mentor",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    licenseLimit: 0,
    licenses: [],
    eas: [],
    ...extra,
  });
}

async function loadPortal() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  return import("../src/lib/portal-cloud");
}

beforeEach(() => {
  state.replies = {};
  kv = { status: 200, payload: { ok: true, found: false } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: kv.status < 400,
      status: kv.status,
      json: async () => kv.payload,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mentor portal — the admin's approval reaches the dashboard", () => {
  it("answers APPROVED when the account row cannot be read but KV approved the mentor", async () => {
    // The console's Approve wrote `approved` to KV. The Supabase read then
    // fails (this project hits `exceed_egress_quota` regularly) — the poll must
    // not throw the decision away and leave the mentor on the pending card.
    kv = { status: 200, payload: { ok: true, found: true, status: "approved", licenseLimit: 2000, username: "biyu" } };
    state.replies["portal_accounts"] = { data: null, error: { message: "exceed_egress_quota" } };

    const { portalGetAccount } = await loadPortal();
    const result = await portalGetAccount("mentor@example.com");

    expect(result.enabled).toBe(true);
    expect(result.account, "an approved mentor must get an account back").not.toBeNull();
    expect(result.account?.status).toBe("approved");
    expect(result.account?.licenseLimit).toBe(2000);
  });

  it("answers APPROVED when KV is unreachable but the mirrored approval row says so", async () => {
    // /api/admin-approve mirrors every decision into mentor_approvals, so the
    // portal's fallback table can never keep answering "pending" for an
    // approved mentor when the KV endpoint is down.
    kv = { status: 503, payload: { ok: false, error: "Registration storage is unavailable" } };
    state.replies["mentor_approvals"] = { data: { status: "approved" }, error: null };
    state.replies["portal_accounts"] = { data: { data: storedAccount("pending") }, error: null };

    const { portalGetAccount } = await loadPortal();
    const result = await portalGetAccount("mentor@example.com");

    expect(result.account?.status).toBe("approved");
  });

  it("still shows PENDING for a mentor nobody has decided on yet", async () => {
    kv = { status: 200, payload: { ok: true, found: true, status: "pending" } };
    state.replies["portal_accounts"] = { data: { data: storedAccount("pending") }, error: null };

    const { portalGetAccount } = await loadPortal();
    const result = await portalGetAccount("mentor@example.com");

    expect(result.account?.status).toBe("pending");
  });

  it("invents nothing: no approval and an unreadable row means no account", async () => {
    kv = { status: 200, payload: { ok: true, found: false } };
    state.replies["portal_accounts"] = { data: null, error: { message: "exceed_egress_quota" } };

    const { portalGetAccount } = await loadPortal();
    const result = await portalGetAccount("stranger@example.com");

    expect(result.enabled).toBe(true);
    expect(result.account).toBeNull();
  });

  it("the KV approval wins over a status frozen inside the stored account", async () => {
    // The account blob is only ever written at signup, so it says pending
    // forever; the console's KV record is the decision.
    kv = { status: 200, payload: { ok: true, found: true, status: "approved", licenseLimit: 2000 } };
    state.replies["portal_accounts"] = { data: { data: storedAccount("pending") }, error: null };

    const { portalGetAccount } = await loadPortal();
    const result = await portalGetAccount("mentor@example.com");

    expect(result.account?.status).toBe("approved");
  });
});
