import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE ACCESS GATE'S THREE PROMISES.
 *
 *  1. THE SOLE ADMIN PASSES FIRST — before any store is consulted, so nothing a
 *     store says (or fails to say) can send that address to the plan chooser.
 *  2. ANY PAID MARK WINS — one store marking the address paid is never
 *     downgraded by another store's "no", absence, or disagreement.
 *  3. A STORE WE COULD NOT READ IS NOT "NOT PAID" — the answer is `undecided`
 *     (the client's "Checking your subscription… Retry" screen), and `unpaid`
 *     is only ever returned when EVERY store answered and none marks it paid.
 *
 * Every answer also carries the per-store breakdown the redirect line logs.
 */

const store = vi.hoisted(() => ({
  /** Raw JSON for the KV registration record, or null when there is none. */
  kv: null as string | null,
  /** TRUE makes every KV call fail the way a timeout does. */
  kvDown: false,
  users: null as Record<string, unknown> | null,
  usersDown: false,
  ledger: null as Record<string, unknown> | null,
  ledgerDown: false,
  portal: null as Record<string, unknown> | null,
  portalDown: false,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = () => {
        if (table === "users") {
          return store.usersDown
            ? { data: null, error: { code: "500", message: "users table unreachable" } }
            : { data: store.users, error: null };
        }
        if (table === "paid_emails") {
          return store.ledgerDown
            ? { data: null, error: { code: "500", message: "ledger unreachable" } }
            : { data: store.ledger ? [store.ledger] : [], error: null };
        }
        if (table === "portal_payments") {
          return store.portalDown
            ? { data: null, error: { code: "500", message: "portal payments unreachable" } }
            : { data: store.portal ? [store.portal] : [], error: null };
        }
        // license_keys — `.maybeSingle()` answers null when no key is held.
        return { data: null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => result(),
        single: async () => result(),
        // Awaiting the builder itself (`.limit(1)`) resolves the same answer.
        then: (resolve: (value: unknown) => unknown) => resolve(result()),
      };
      return chain;
    },
  }),
}));

const ADMIN = "biyasentobeko222@gmail.com";
const CLIENT = "client@example.com";

async function ask(email: string) {
  vi.resetModules();
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      if (store.kvDown) return { ok: false, status: 503, json: async () => ({ error: "timeout" }) };
      const command = JSON.parse(init?.body ?? "[]") as string[];
      if (command[0] === "SCARD") {
        return { ok: true, status: 200, json: async () => ({ result: 0 }) };
      }
      return { ok: true, status: 200, json: async () => ({ result: store.kv }) };
    }),
  );
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
  await handler({ method: "POST", body: JSON.stringify({ email }) }, response);
  return { status, body };
}

beforeEach(() => {
  store.kv = null;
  store.kvDown = false;
  store.users = null;
  store.usersDown = false;
  store.ledger = null;
  store.ledgerDown = false;
  store.portal = null;
  store.portalDown = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("check-access — the gate's decision rules", () => {
  it("passes the SOLE ADMIN first, even with every store down", async () => {
    store.kvDown = true;
    store.usersDown = true;
    store.ledgerDown = true;
    store.portalDown = true;

    const { status, body } = await ask(ADMIN);

    expect(status).toBe(200);
    expect(body["status"]).toBe("admin");
    expect(body["isPaid"]).toBe(true);
    expect((body["stores"] as Record<string, string>)["cloud access gate"]).toBe("admin");
  });

  it("lets ONE paid mark win while other stores are unreachable", async () => {
    store.ledgerDown = true;
    store.portalDown = true;
    store.usersDown = true;
    store.kv = JSON.stringify({ email: CLIENT, isPaid: true, paidAt: "2026-10-24T10:00:00.000Z", status: "approved" });

    const { body } = await ask(CLIENT);

    expect(body["ok"]).toBe(true);
    expect(body["status"]).toBe("paid");
    expect(body["isPaid"]).toBe(true);
  });

  it("does NOT downgrade a users-table paid flag because KV says unpaid", async () => {
    store.kv = JSON.stringify({ email: CLIENT, isPaid: false, paidAt: null, status: "approved" });
    store.users = { is_paid: true, is_admin: false, license_key: null, device_id: null };

    const { body } = await ask(CLIENT);

    expect(body["status"]).toBe("paid");
  });

  it("answers UNPAID only when every store answered and none is paid", async () => {
    const { body } = await ask(CLIENT);

    expect(body["ok"]).toBe(true);
    expect(body["status"]).toBe("unpaid");
    expect(body["isPaid"]).toBe(false);
  });

  it("answers UNDECIDED (not unpaid) when a store could not be read", async () => {
    store.kvDown = true;

    const { body } = await ask(CLIENT);

    expect(body["ok"]).toBe(false);
    expect(body["status"]).toBe("undecided");
    expect(Array.isArray(body["unreadable"])).toBe(true);
    expect((body["unreadable"] as string[]).join(" ")).toMatch(/KV registrations/);
  });

  it("decides a CONSOLE admin by its paid records instead of labelling it admin", async () => {
    // The user's rule: only biyasentobeko222@gmail.com short-circuits the
    // stores. This address is paid in portal accounts KV, so it must be
    // reported as PAID (not "admin"), and it must pass.
    store.kv = JSON.stringify({
      email: "ntobekotraders.official@gmail.com",
      isPaid: true,
      paidAt: "2026-10-24T10:53:38.023Z",
      status: "approved",
    });

    const { body } = await ask("ntobekotraders.official@gmail.com");

    expect(body["status"]).toBe("paid");
    expect(body["isPaid"]).toBe(true);
    expect((body["stores"] as Record<string, string>)["cloud access gate"]).toBe(
      "paid via KV registrations",
    );
  });

  it("sends a console admin WITHOUT a paid record to the plans like anybody else", async () => {
    const { body } = await ask("admin@eamigrate.pro");

    expect(body["status"]).toBe("unpaid");
    expect(body["isPaid"]).toBe(false);
  });

  it("reports every store in the answer, for the redirect diagnostic", async () => {
    const { body } = await ask(CLIENT);
    const stores = body["stores"] as Record<string, string>;

    for (const name of [
      "users table",
      "KV registrations",
      "paid ledger",
      "portal accounts",
      "licence keys",
      "cloud access gate",
    ]) {
      expect(typeof stores[name]).toBe("string");
    }
  });
});
