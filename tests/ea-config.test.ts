import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE APP READS THE EA'S CURRENT SYMBOLS FROM THE SERVER BY LICENCE KEY.
 *
 * The bug: a robot kept the symbol list that was saved locally at activation,
 * so a mentor adding/removing symbols only reached the client after a brand-new
 * key. `refreshRobotConfigs` now resolves every activated key through
 * /api/licenses → `ea-config` and replaces the snapshot.
 *
 * These tests drive the real store against a scripted endpoint.
 */

const STORE_KEY = "eamp.app.v3";
const EMAIL = "client@example.com";
const LICENSE = "EMP-AAAA-BBBB-CCCC";

function seed(symbols: string[], pairs: Array<{ symbol: string; lotSize: string; maxTrades: string }> = []) {
  // The store signs everyone out once when the access epoch advances; pin the
  // test session to the current epoch so the seeded robot survives load().
  window.localStorage.setItem("eamp.access-epoch.v1", "99");
  window.localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      email: EMAIL,
      activeRobotId: "r1",
      robots: [
        {
          id: "r1",
          name: "Snapshot EA",
          key: LICENSE,
          symbols,
          pairs,
          running: false,
          configUpdatedAt: "2024-01-01T00:00:00.000Z",
          configStale: true,
        },
      ],
    }),
  );
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("live EA config from the server", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the activation snapshot with the mentor's current symbols", async () => {
    seed(
      ["EURUSD", "GBPUSD"],
      [
        { symbol: "EURUSD", lotSize: "0.01", maxTrades: "1" },
        { symbol: "GBPUSD", lotSize: "0.02", maxTrades: "2" },
      ],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({
          ok: true,
          configs: [
            {
              key: LICENSE,
              eaId: "ea-1",
              eaName: "Mentor EA",
              symbols: ["XAUUSD", "US30"],
              updatedAt: "2025-01-02T03:04:05.000Z",
            },
          ],
        }),
      ),
    );

    const store = await import("@/lib/app-store");
    const result = await store.refreshRobotConfigs();
    const robot = store.getAppState().robots[0]!;

    expect(result.ok).toBe(true);
    expect(robot.name).toBe("Mentor EA");
    expect(robot.symbols).toEqual(["XAUUSD", "US30"]);
    // A configured pair whose symbol the mentor removed is dropped too — the
    // EA can no longer trade it, and leaving it would send orders for a symbol
    // this EA does not have.
    expect(robot.pairs?.map((pair) => pair.symbol)).toEqual([]);
    expect(robot.configUpdatedAt).toBe("2025-01-02T03:04:05.000Z");
    expect(robot.configStale).toBe(false);
  });

  it("asks the server by the licence key the robot already holds", async () => {
    seed(["EURUSD"]);
    const fetchMock = vi.fn(async () => reply({ ok: true, configs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = await import("@/lib/app-store");
    await store.refreshRobotConfigs();

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/licenses");
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    expect(body["action"]).toBe("ea-config");
    expect(body["keys"]).toEqual([LICENSE]);
  });

  it("accepts an EMPTY symbol list — the mentor removed every symbol", async () => {
    seed(["EURUSD", "GBPUSD"], [{ symbol: "EURUSD", lotSize: "0.01", maxTrades: "1" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ ok: true, configs: [{ key: LICENSE, symbols: [], updatedAt: "2025-02-02T00:00:00.000Z" }] }),
      ),
    );

    const store = await import("@/lib/app-store");
    await store.refreshRobotConfigs();
    const robot = store.getAppState().robots[0]!;
    expect(robot.symbols).toEqual([]);
    expect(robot.pairs).toEqual([]);
    expect(robot.configStale).toBe(false);
  });

  it("keeps the last known symbols and marks them stale when the server fails", async () => {
    seed(["EURUSD", "GBPUSD"], [{ symbol: "EURUSD", lotSize: "0.01", maxTrades: "1" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const store = await import("@/lib/app-store");
    const result = await store.refreshRobotConfigs();
    const robot = store.getAppState().robots[0]!;

    expect(result.ok).toBe(false);
    // Nothing is wiped — an unreachable server must never empty a trader's
    // Quotes — and the copy is labelled as offline.
    expect(robot.symbols).toEqual(["EURUSD", "GBPUSD"]);
    expect(robot.configStale).toBe(true);
    expect(robot.configUpdatedAt).toBe("2024-01-01T00:00:00.000Z");
  });
});
