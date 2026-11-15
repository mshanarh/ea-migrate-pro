import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A LICENCE KEY IS NOT A RECEIPT.
 *
 * `/api/check-access` used to answer "paid" for a `users` row that merely held
 * a `license_key` (or a `license_keys` row, or mentor approval), with no
 * payment record anywhere. That is the paywall bypass: an email that never
 * paid — olwammakoki70@gmail.com was the report — got into the app because a
 * key had been issued or claimed for it.
 *
 * The only authoritative sources of payment are now the paid ledger
 * (`paid_emails`), the KV paid record, the portal payment table and Whop
 * verification with a `paid_at`, plus the sole admin. These tests drive the
 * real handler against a scripted store and database:
 *
 *   • no KV record, no ledger row, `users.license_key` set → UNPAID;
 *   • an explicit revoked record still wins;
 *   • a key holder bound to ANOTHER device is answered unpaid, with the
 *     binding riding along;
 *   • a real paid ledger row still passes;
 *   • the sole admin still passes.
 */

const db = vi.hoisted(() => ({
  users: null as Record<string, unknown> | null,
  paid: null as Record<string, unknown> | null,
  userError: null as { message: string } | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        // The gate matches the exact address case-insensitively when it is
        // safe to (no LIKE wildcards in it) — see check-access.ts.
        ilike: () => chain,
        neq: () => chain,
        order: () => chain,
        /**
         * `limit()` ends up AWAITED directly in the ledger read, and also feeds
         * `.maybeSingle()` in the licence-key read — so the stub is both
         * thenable and chainable.
         */
        limit: () => ({
          maybeSingle: async () => ({
            data: table === "users" ? db.users : null,
            error: table === "users" ? db.userError : null,
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: table === "paid_emails" && db.paid ? [db.paid] : [],
              error: null,
            }).then(resolve),
        }),
        maybeSingle: async () => ({
          data: table === "users" ? db.users : null,
          error: table === "users" ? db.userError : null,
        }),
        single: async () => ({ data: table === "paid_emails" ? db.paid : null, error: null }),
      };
      return chain;
    },
  }),
}));

const EMAIL = "olwammakoki70@gmail.com";
const ADMIN_EMAIL = "biyasentobeko222@gmail.com";
const DEVICE = "this-phone";
const OTHER_DEVICE = "someone-elses-phone";

/** The KV answer for the registration record: `undefined` = no record. */
let kvRecord: Record<string, unknown> | null = null;
/** TRUE makes the KV call fail the way a timeout does. */
let kvDown = false;

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (kvDown) return { ok: false, status: 503, json: async () => ({ error: "timeout" }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: kvRecord ? JSON.stringify(kvRecord) : null }),
      };
    }),
  );
}

async function callCheckAccess(deviceId: string | null = DEVICE, email = EMAIL) {
  vi.resetModules();
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const { default: handler } = await import("../api/_handlers/check-access");
  let status = 0;
  let body: Record<string, unknown> = {};
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: unknown) {
      body = value as Record<string, unknown>;
    },
    setHeader() {
      /* no-op */
    },
  };
  await handler(
    { method: "POST", body: JSON.stringify({ email, deviceId }) },
    response,
  );
  return { status, body };
}

beforeEach(() => {
  db.users = null;
  db.paid = null;
  db.userError = null;
  kvRecord = null;
  kvDown = false;
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("check-access — payment comes from a paid record, never a licence key", () => {
  it("answers UNPAID for a licence key holder with no ledger row and no KV paid record", async () => {
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["ok"]).toBe(true);
    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).toBe("unpaid");
    // The binding still rides along, so the device rule is unchanged.
    expect(body["deviceBinding"]).toEqual({ deviceEmail: EMAIL, deviceId: DEVICE });
    expect(body["deviceMatches"]).toBe(true);
  });

  it("answers UNPAID even when KV is unreachable — a key still is not a payment", async () => {
    kvDown = true;
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    // KV could not be read, so the answer is undecided (never paid, never a
    // plan chooser) — a failed read is not a verdict.
    expect(status).toBe(200);
    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).not.toBe("paid");
  });

  it("does not let a users row's is_paid flag or bare mentorship stand in for the ledger", async () => {
    db.users = {
      license_key: "",
      is_paid: true,
      is_admin: false,
      device_id: null,
      device_email: null,
    };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).toBe("unpaid");
  });

  it("keeps REVOKED when no store marks the address paid", async () => {
    kvRecord = { email: EMAIL, isPaid: false, paidAt: null, status: "approved" };
    db.users = { license_key: "", device_id: null, device_email: null };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["status"]).toBe("revoked");
    expect(body["isPaid"]).toBe(false);
  });

  it("answers UNPAID when the key is bound to a DIFFERENT device", async () => {
    db.users = {
      license_key: "EMP-AAAA-BBBB-CCCC",
      device_id: OTHER_DEVICE,
      device_email: EMAIL,
    };

    const { status, body } = await callCheckAccess(DEVICE);

    expect(status).toBe(200);
    expect(body["status"]).toBe("unpaid");
    expect(body["isPaid"]).toBe(false);
    expect(body["deviceMatches"]).toBe(false);
  });

  it("still passes a real PAID LEDGER row", async () => {
    db.paid = { paid_at: "2026-11-01T10:00:00.000Z" };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(true);
    expect(body["status"]).toBe("paid");
  });

  it("still passes the sole ADMIN", async () => {
    const { body } = await callCheckAccess(DEVICE, ADMIN_EMAIL);

    expect(body["isPaid"]).toBe(true);
    expect(body["status"]).toBe("admin");
  });

  it("does not invent access from an empty license_key", async () => {
    db.users = { license_key: "", device_id: null, device_email: null };

    const { body } = await callCheckAccess();

    expect(body["status"]).toBe("unpaid");
    expect(body["isPaid"]).toBe(false);
  });
});
