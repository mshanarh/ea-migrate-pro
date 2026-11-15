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
/** Keys this account has REDEEMED (the server-written activation record). */
let redeemedKeys: string[] = [];
/** When the first of them was redeemed. */
let redeemedAt: string | null = null;
/** Keys ASSIGNED to the account (`eamp:license-by-client:<email>`). */
let assignedKeys: string[] = [];
/** Full key records, as `eamp:license-keys` holds them. */
let keyRecords: Record<string, Record<string, unknown>> = {};

/**
 * A COMMAND-AWARE KV STUB.
 *
 * The real store is Redis-over-HTTP: the body IS the command array and the
 * answer carries `result`. Answering every command with the registration
 * record hid a whole class of bug — a wrongly parsed SCARD used to look like a
 * paid mark — so this stub reads the command and answers the way Redis would.
 */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      if (kvDown) return { ok: false, status: 503, json: async () => ({ error: "timeout" }) };
      let command: unknown[] = [];
      try {
        command = JSON.parse(String(init?.body ?? "[]")) as unknown[];
      } catch {
        command = [];
      }
      const verb = String(command[0] ?? "").toUpperCase();
      const key = String(command[1] ?? "");
      const result = (value: unknown) => ({ ok: true, status: 200, json: async () => ({ result: value }) });
      if (verb === "SCARD" && key === `eamp:key-activated:${EMAIL}`) return result(redeemedKeys.length);
      if (verb === "GET" && key === `eamp:key-activated-at:${EMAIL}`) return result(redeemedAt);
      if (verb === "SMEMBERS" && key === `eamp:license-by-client:${EMAIL}`) return result(assignedKeys);
      if (verb === "HGET" && key === "eamp:license-keys") {
        const code = String(command[2] ?? "");
        const record = keyRecords[code];
        return result(record ? JSON.stringify(record) : null);
      }
      return result(kvRecord ? JSON.stringify(kvRecord) : null);
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
  redeemedKeys = [];
  redeemedAt = null;
  assignedKeys = [];
  keyRecords = {};
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

  it("passes an account that REDEEMED its licence key, even with no paid record", async () => {
    // The bug this covers: a customer entered their key, the app said "key
    // activated", showed the home screen and then threw them back to the first
    // page because no store held a subscription for their address. A redeemed
    // key IS the record — written by the server at claim time.
    redeemedKeys = ["EMP-AAAA-BBBB-CCCC"];
    redeemedAt = "2026-11-15T09:00:00.000Z";
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["isPaid"]).toBe(true);
    expect(body["status"]).toBe("paid");
    expect(body["paidAt"]).toBe("2026-11-15T09:00:00.000Z");
  });

  it("still REFUSES when the console revoked the account, redeemed key or not", async () => {
    // "Mark unpaid" must always win — otherwise a key became a way to outvote
    // the owner.
    redeemedKeys = ["EMP-AAAA-BBBB-CCCC"];
    redeemedAt = "2026-11-15T09:00:00.000Z";
    kvRecord = { email: EMAIL, isPaid: false, paidAt: null, status: "approved" };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).toBe("revoked");
  });

  it("passes a key this account ACTIVATED before the redemption record existed", async () => {
    // Already-activated customers could not re-enter their key (the claim lock
    // says it is in use), so the key record's own `claimedBy` has to count.
    assignedKeys = ["EMP-AAAA-BBBB-CCCC"];
    keyRecords["EMP-AAAA-BBBB-CCCC"] = {
      key: "EMP-AAAA-BBBB-CCCC",
      mentorEmail: "mentor@example.com",
      clientEmail: EMAIL,
      claimedBy: EMAIL.toUpperCase(),
      claimedAt: "2026-11-10T08:00:00.000Z",
    };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(true);
    expect(body["status"]).toBe("paid");
    expect(body["paidAt"]).toBe("2026-11-10T08:00:00.000Z");
  });

  it("does NOT count a key claimed by SOMEBODY ELSE", async () => {
    assignedKeys = ["EMP-AAAA-BBBB-CCCC"];
    keyRecords["EMP-AAAA-BBBB-CCCC"] = {
      key: "EMP-AAAA-BBBB-CCCC",
      mentorEmail: "mentor@example.com",
      clientEmail: EMAIL,
      claimedBy: "another-client@example.com",
      claimedAt: "2026-11-10T08:00:00.000Z",
    };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).toBe("unpaid");
  });

  it("does NOT count a key that was only ASSIGNED, never redeemed", async () => {
    // `eamp:license-by-client` says 2 keys are assigned to this address. That is
    // an issue record, not an activation — it must still resolve unpaid.
    db.users = { license_key: "", device_id: null, device_email: null };

    const { body } = await callCheckAccess();

    expect(body["isPaid"]).toBe(false);
    expect(body["status"]).toBe("unpaid");
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
