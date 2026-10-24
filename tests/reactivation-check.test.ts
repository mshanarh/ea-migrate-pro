import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE MENTOR PORTAL'S REACTIVATION GATE.
 *
 * These assertions drive `checkReactivationEmail` — the same resolver the
 * Re-activate Client page calls — with the stores mocked at their module
 * boundaries, so what is being proven is the DECISION, not the network:
 *
 *   • a client registered and paid in the KV store but with NO Supabase
 *     `users` row is accepted (the reported bug);
 *   • a registered email with no payment is refused with the specific
 *     "registered but not marked paid" message and a diagnostic naming every
 *     store that was asked;
 *   • an email no store knows is refused as unregistered;
 *   • a licence key issued to the email still counts (mentor client).
 */

type StoreState = {
  user: { id: string; email: string; is_paid: boolean; is_admin: boolean; created_at: string } | null;
  ledgerPaid: boolean;
  legacyKey: boolean;
  kvKeys: number;
  cloudStatus: "paid" | "admin" | "unpaid" | "revoked" | "rejected";
  kvRegistered: boolean;
  portalAccount: boolean;
};

const state: StoreState = {
  user: null,
  ledgerPaid: false,
  legacyKey: false,
  kvKeys: 0,
  cloudStatus: "unpaid",
  kvRegistered: false,
  portalAccount: false,
};

vi.mock("@/lib/auth-store", () => ({
  OWNER_EMAILS: ["biyasentobeko222@gmail.com"],
  isPaymentExemptEmail: (email: string) => email === "biyasentobeko222@gmail.com",
}));

vi.mock("@/lib/supabase-users", () => ({
  getUserByEmail: async () => state.user,
  emailPaidInLedger: async () => state.ledgerPaid,
  emailHasLicenseKey: async () => state.legacyKey,
  checkAccessServer: async () => ({
    ok: true,
    isPaid: state.cloudStatus === "paid" || state.cloudStatus === "admin",
    status: state.cloudStatus,
  }),
}));

/**
 * THE PORTAL PAYMENT RECORD LIVES IN UPSTASH NOW. It is mocked at the module
 * boundary so the decision — not the KV configuration of the test machine —
 * is what these assertions prove.
 */
vi.mock("@/lib/portal-paid", () => ({
  PORTAL_RETRY_DELAY_MS: 0,
  describeError: (error: unknown) => String(error),
  readPortalAccount: async () => ({
    state: state.portalAccount ? "account" : "no-account",
    paid: state.portalAccount,
    detail: state.portalAccount ? "account found" : "no account",
  }),
  readPortalPayment: async () => ({
    state: state.portalAccount ? "paid" : "not-paid",
    detail: state.portalAccount ? "paid" : "no account",
  }),
}));

vi.mock("@/lib/license-cloud", () => ({
  countLicensesInKv: async () => ({ enabled: true, ok: true, count: state.kvKeys }),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({
            data: state.portalAccount ? [{ email: "client@example.com" }] : [],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { checkReactivationEmail } from "../src/lib/reactivation-check";

/** /api/mentor-status — the KV registration record's existence. */
function stubMentorStatus(registered: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, found: registered, status: registered ? "approved" : undefined }),
      }) as unknown as Response,
    ),
  );
}

beforeEach(() => {
  state.user = null;
  state.ledgerPaid = false;
  state.legacyKey = false;
  state.kvKeys = 0;
  state.cloudStatus = "unpaid";
  state.kvRegistered = false;
  state.portalAccount = false;
  stubMentorStatus(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkReactivationEmail — the authoritative stores", () => {
  it("accepts a KV-registered PAID client with no Supabase users row", async () => {
    // The bug: registration + payment live in KV, so `users` is empty.
    state.kvRegistered = true;
    state.cloudStatus = "paid";
    stubMentorStatus(true);

    const check = await checkReactivationEmail("Client@Example.com ");

    expect(check.email).toBe("client@example.com");
    expect(check.registered).toBe(true);
    expect(check.paid).toBe(true);
    expect(check.error).toBeUndefined();
    expect(check.diagnostic).toContain("KV registrations: registered (approved)");
    expect(check.diagnostic).toContain("cloud access gate: paid");
  });

  it("accepts a KV-registered client whose proof is a claimed licence key", async () => {
    state.kvRegistered = true;
    state.cloudStatus = "paid";
    stubMentorStatus(true);

    const check = await checkReactivationEmail("client@example.com");
    expect(check.paid).toBe(true);
  });

  it("accepts a mentor client holding a KV licence key", async () => {
    state.kvKeys = 2;
    stubMentorStatus(true);

    const check = await checkReactivationEmail("client@example.com");
    expect(check.registered).toBe(true);
    expect(check.paid).toBe(true);
    expect(check.diagnostic).toContain("mentor licence keys: 2 keys");
  });

  it("accepts an email marked paid on the ledger even when the users row is absent", async () => {
    state.ledgerPaid = true;

    const check = await checkReactivationEmail("client@example.com");
    expect(check.paid).toBe(true);
    expect(check.diagnostic).toContain("paid ledger: paid");
  });

  it("refuses a REGISTERED but UNPAID email with the specific message", async () => {
    state.kvRegistered = true;
    state.cloudStatus = "unpaid";
    stubMentorStatus(true);

    const check = await checkReactivationEmail("client@example.com");

    expect(check.registered).toBe(true);
    expect(check.paid).toBe(false);
    expect(check.error).toContain("registered but not marked paid");
    expect(check.error).not.toContain("not your client's registered email");
    // The diagnostic names every store that was asked, so the missing one is
    // identifiable without guessing.
    expect(check.diagnostic).toContain("users table: no row");
    expect(check.diagnostic).toContain("KV registrations: registered");
    expect(check.diagnostic).toContain("paid ledger: not paid");
    expect(check.diagnostic).toContain("mentor licence keys: no keys issued");
    expect(check.diagnostic).toContain("portal accounts: no account");
  });

  it("refuses an email no store knows as unregistered", async () => {
    const check = await checkReactivationEmail("stranger@example.com");

    expect(check.registered).toBe(false);
    expect(check.paid).toBe(false);
    expect(check.error).toContain("is not registered in any store");
    expect(check.diagnostic).toContain("users table: no row");
    expect(check.diagnostic).toContain("KV registrations: no registration");
  });

  it("keeps owner/admin emails releasable", async () => {
    const check = await checkReactivationEmail("biyasentobeko222@gmail.com");
    expect(check.paid).toBe(true);
  });

  it("reports an unreachable KV store instead of pretending it answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response),
    );

    const check = await checkReactivationEmail("client@example.com");
    // "unavailable" — never "no registration": a read that failed is not a
    // verdict, and the line carries the URL and HTTP status that failed.
    expect(check.diagnostic).toContain("KV registrations: unavailable");
    expect(check.diagnostic).toContain("/api/mentor-status");
    expect(check.diagnostic).toContain("HTTP 503");
  });

  it("never surfaces a raw TypeError for an unreachable source", async () => {
    // The reported bug: the portal-accounts read threw `TypeError: Failed to
    // fetch` and that aborted the whole reactivation.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const check = await checkReactivationEmail("client@example.com");

    expect(check.error ?? "").not.toContain("TypeError");
    expect(check.error ?? "").not.toContain("Failed to fetch");
    // Every store was still asked, and the diagnostic keeps the technical detail.
    expect(check.stores.map((store) => store.store)).toEqual([
      "users",
      "kvRegistered",
      "paidLedger",
      "cloudAccess",
      "mentorKeys",
      "portalAccounts",
    ]);
    expect(check.diagnostic).toContain("KV registrations: unavailable");
  });
});
