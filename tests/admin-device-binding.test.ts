/**
 * THE SOLE ADMIN IS SUBJECT TO THE DEVICE RULES — /api/account, for real.
 *
 * The admin's address lives on a fixed allowlist and has no KV record of its
 * own, so `bind-device` used to answer 404 for it: the one-device rule could
 * never bite, and no reactivation could ever release a device. These tests
 * drive the actual handler against a scripted store and pin the rule the owner
 * asked for:
 *
 *   • admin status exempts PAYMENT and nothing else,
 *   • the admin's first sign-in CLAIMS a device like anybody else's,
 *   • a second device is refused (409) until a reactivation clears it,
 *   • the admin's reactivation is not blocked by the paid record it does not
 *     need — while an unpaid non-admin is still refused,
 *   • the 🔒 reactivation flag is the record's flag for the admin too.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "biyasentobeko222@gmail.com";

const store = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../api/_handlers/_registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/_handlers/_registry")>();
  return {
    ...actual,
    storeConfigured: () => true,
    getRegistration: async (email: string) => store.records.get(email) ?? null,
    saveRegistration: async (record: Record<string, unknown> & { email: string }) => {
      store.records.set(record.email, record);
    },
    setDeviceIdForEmail: async (email: string, deviceId: string) => {
      const existing = store.records.get(email);
      if (existing) {
        store.records.set(email, { ...existing, deviceId });
        return;
      }
      store.records.set(email, {
        email,
        status: "pending",
        isPaid: false,
        paidAt: null,
        licenseLimit: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        deviceId,
      });
    },
    clearDeviceBinding: async (email: string) => {
      const existing = store.records.get(email);
      if (!existing) return { ok: false, error: "That email has no record" };
      const next = { ...existing, deviceId: null };
      store.records.set(email, next);
      return { ok: true, clearedAt: "2026-01-02T00:00:00.000Z", record: next };
    },
    setReactivationFlag: async (email: string, enabled: boolean) => {
      const existing = store.records.get(email);
      if (!existing) return { ok: false, error: "That email is not registered" };
      store.records.set(email, { ...existing, reactivationEnabled: enabled });
      return { ok: true };
    },
  };
});

vi.mock("../api/_handlers/licenses", () => ({
  claimLicenceKeyForEmail: async () => ({ ok: true }),
}));

const { default: handler } = await import("../api/_handlers/account");

type Reply = { status: number; body: Record<string, unknown> };

async function call(body: Record<string, unknown>, admin = ADMIN): Promise<Reply> {
  const reply: Reply = { status: 0, body: {} };
  const response = {
    status(code: number) {
      reply.status = code;
      return response;
    },
    json(payload: unknown) {
      reply.body = payload as Record<string, unknown>;
    },
    setHeader() {
      /* no-op */
    },
  };
  await handler(
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: admin ? { "x-admin-email": admin } : {},
    },
    response as never,
  );
  return reply;
}

function bind(email: string, deviceId: string) {
  return call({ action: "bind-device", email, deviceId });
}

describe("the admin's device binding", () => {
  beforeEach(() => {
    store.records.clear();
  });

  it("claims this device on the first sign-in, creating the record it never had", async () => {
    expect(store.records.get(ADMIN)).toBeUndefined();

    const reply = await bind(ADMIN, "device-web-1");

    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(store.records.get(ADMIN)).toMatchObject({ deviceId: "device-web-1" });
    // A binding never grants payment.
    expect(store.records.get(ADMIN)?.isPaid).toBe(false);
  });

  it("refuses a second device until a reactivation clears the binding", async () => {
    await bind(ADMIN, "device-web-1");

    const second = await bind(ADMIN, "device-phone-2");

    expect(second.status).toBe(409);
    expect(second.body.boundToOtherDevice).toBe(true);
    expect(store.records.get(ADMIN)?.deviceId).toBe("device-web-1");
  });

  it("still answers 404 for an unknown address that is not an admin", async () => {
    const reply = await bind("stranger@example.com", "device-x");

    expect(reply.status).toBe(404);
    expect(store.records.get("stranger@example.com")).toBeUndefined();
  });

  it("lets the admin's own device be released without a paid record, and keeps the record unpaid", async () => {
    await bind(ADMIN, "device-web-1");

    const reply = await call({ action: "reactivate", email: ADMIN });

    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(reply.body.stillPaid).toBe(false);
    expect(store.records.get(ADMIN)?.deviceId).toBeNull();
    // The released account can now claim a fresh device — the normal flow.
    expect((await bind(ADMIN, "device-phone-2")).status).toBe(200);
    expect(store.records.get(ADMIN)?.deviceId).toBe("device-phone-2");
  });

  it("still refuses to release an unpaid non-admin", async () => {
    store.records.set("client@example.com", {
      email: "client@example.com",
      isPaid: false,
      paidAt: null,
      deviceId: "device-old",
    });

    const reply = await call({ action: "reactivate", email: "client@example.com" });

    expect(reply.status).toBe(409);
    expect(store.records.get("client@example.com")?.deviceId).toBe("device-old");
  });

  it("does not force the reactivation flag on for the admin", async () => {
    await bind(ADMIN, "device-web-1");

    const locked = await call({ action: "reactivation-flag", email: ADMIN });
    expect(locked.status).toBe(200);
    expect(locked.body.enabled).toBe(false);

    await call({ action: "reactivation-flag", email: ADMIN, value: true });
    const unlocked = await call({ action: "reactivation-flag", email: ADMIN });
    expect(unlocked.body.enabled).toBe(true);
  });

  it("does not report the admin's profile as auto-unlocked", async () => {
    await bind(ADMIN, "device-web-1");

    const reply = await call({ action: "profile", email: ADMIN });

    expect(reply.status).toBe(200);
    expect((reply.body.profile as Record<string, unknown>).reactivationEnabled).toBe(false);
  });
});
