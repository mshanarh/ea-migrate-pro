import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A CLAIMED LICENCE KEY IS PROOF OF ACCESS.
 *
 * `/api/check-access` used to answer "paid" only from the Upstash registration
 * record or the Supabase `paid_emails` ledger. A customer who had just entered
 * a working licence key was therefore answered "unpaid" — their money lives in
 * the key, not in the ledger — and the guard bounced them back to the email +
 * code form. These tests drive the real handler against a scripted store and
 * scripted database:
 *
 *   • no KV record, no ledger row, `users.license_key` set → paid;
 *   • KV unreachable (timeout/error) behaves the same — a failed read is NOT a
 *     verdict;
 *   • an explicit revoked record still wins, even with a key on the row;
 *   • a key holder bound to ANOTHER device is answered unpaid (activated on a
 *     different phone), exactly as before.
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
        limit: () => chain,
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

const EMAIL = "client@example.com";
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

async function callCheckAccess(deviceId: string | null = DEVICE) {
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
    { method: "POST", body: JSON.stringify({ email: EMAIL, deviceId }) },
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

describe("check-access — a claimed licence key is proof of access", () => {
  it("answers PAID for a licence key holder when KV has no record and no ledger row", async () => {
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["ok"]).toBe(true);
    expect(body["isPaid"]).toBe(true);
    expect(body["status"]).toBe("paid");
    // The binding still rides along exactly as before.
    expect(body["deviceBinding"]).toEqual({ deviceEmail: EMAIL, deviceId: DEVICE });
    expect(body["deviceMatches"]).toBe(true);
  });

  it("treats an UNREACHABLE KV store the same way — a failed read is not a verdict", async () => {
    kvDown = true;
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["status"]).toBe("paid");
    expect(body["isPaid"]).toBe(true);
  });

  it("ANY paid mark wins — one store's disagreement never downgrades another's", async () => {
    // The console record says unpaid, the `users` row holds a claimed key.
    // The owner's rule is explicit: if EVEN ONE authoritative store marks the
    // address paid, the account passes. A revocation therefore stands only
    // when nothing else marks the address paid.
    kvRecord = { email: EMAIL, isPaid: false, paidAt: null, status: "approved" };
    db.users = { license_key: "EMP-AAAA-BBBB-CCCC", device_id: DEVICE, device_email: EMAIL };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["status"]).toBe("paid");
    expect(body["isPaid"]).toBe(true);
  });

  it("keeps REVOKED when no store marks the address paid", async () => {
    kvRecord = { email: EMAIL, isPaid: false, paidAt: null, status: "approved" };
    db.users = { license_key: "", device_id: null, device_email: null };

    const { status, body } = await callCheckAccess();

    expect(status).toBe(200);
    expect(body["status"]).toBe("revoked");
    expect(body["isPaid"]).toBe(false);
  });

  it("answers UNPAID when the claimed key is bound to a DIFFERENT device", async () => {
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

  it("does not invent access from an empty license_key", async () => {
    db.users = { license_key: "", device_id: null, device_email: null };

    const { body } = await callCheckAccess();

    expect(body["status"]).toBe("unpaid");
    expect(body["isPaid"]).toBe(false);
  });
});
