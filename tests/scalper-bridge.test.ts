import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setBridgeUrl } from "../src/lib/bridge-client";
import {
  fetchScalperStatus,
  planFromAllowedQuotes,
  startScalperOnBridge,
  stopScalperOnBridge,
} from "../src/lib/scalper-bridge";

/**
 * SCALPER START MUST GO TO THE BRIDGE — AND NOWHERE ELSE.
 *
 * The VPS daemon owns scalper trading, so the only request a scalper start may
 * make is POST /scalper/start. These tests drive the real client with a stubbed
 * fetch and assert the URL, the body the bridge's FastAPI model requires, and
 * the absence of any /trade/execute call.
 */

const BRIDGE = "https://bridge.example.test";

type Captured = { url: string; method: string; body: unknown; headers: Record<string, string> };

function stubBridge(
  reply: (target: string) => { status?: number; payload: Record<string, unknown> },
): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const capturedInit = init ?? {};
      captured.push({
        url: target,
        method: (capturedInit.method ?? "GET").toUpperCase(),
        body: capturedInit.body ? JSON.parse(String(capturedInit.body)) : undefined,
        headers: (capturedInit.headers ?? {}) as Record<string, string>,
      });
      const { status = 200, payload } = reply(target);
      return {
        ok: status < 400,
        status,
        json: async () => payload,
      } as unknown as Response;
    }),
  );
  return captured;
}

beforeEach(() => {
  window.localStorage.clear();
  setBridgeUrl(BRIDGE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scalper start", () => {
  it("posts the Allowed Quotes to /scalper/start only", async () => {
    const calls = stubBridge(() => ({ payload: { ok: true, running: true, message: "started" } }));

    const result = await startScalperOnBridge([
      { symbol: "XAUUSDm", lot: 0.01, trades: 4 },
      { symbol: "BTCUSDm", lot: 0.02, trades: 10 },
    ]);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BRIDGE}/scalper/start`);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ symbol: "XAUUSDm,BTCUSDm", lot: 0.01, trade_count: 4 });
    expect(calls[0]?.headers["x-bridge-key"]).toBeTruthy();
    // NOTHING may execute a trade from the app in scalper mode.
    expect(calls.some((call) => call.url.includes("/trade/execute"))).toBe(false);
  });

  it("reports the bridge's own error on a non-200 and never claims it started", async () => {
    stubBridge(() => ({ status: 401, payload: { detail: "Invalid bridge key" } }));

    const result = await startScalperOnBridge([{ symbol: "XAUUSDm", lot: 0.01, trades: 1 }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
      expect(result.error).toContain("Invalid bridge key");
    }
  });

  it("refuses a 200 that does not report the daemon as running", async () => {
    stubBridge(() => ({ payload: { ok: true, running: false } }));

    const result = await startScalperOnBridge([{ symbol: "XAUUSDm", lot: 0.01, trades: 1 }]);

    expect(result.ok).toBe(false);
  });

  it("will not start on a quote whose trade count is zero", async () => {
    const calls = stubBridge(() => ({ payload: { ok: true, running: true } }));

    const result = await startScalperOnBridge([]);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("scalper stop", () => {
  it("posts an empty body to /scalper/stop", async () => {
    const calls = stubBridge(() => ({ payload: { ok: true, running: false, message: "stopped" } }));

    const result = await stopScalperOnBridge();

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BRIDGE}/scalper/stop`);
    expect(calls[0]?.body).toEqual({});
  });

  it("keeps the failure when the bridge does not confirm the stop", async () => {
    stubBridge(() => ({ payload: { ok: true, running: true } }));

    const result = await stopScalperOnBridge();

    expect(result.ok).toBe(false);
  });
});

describe("scalper status", () => {
  it("reads the daemon's real state, version and symbols", async () => {
    const calls = stubBridge(() => ({
      payload: {
        ok: true,
        running: true,
        symbol: "XAUUSDm,BTCUSDm",
        lot: 0.01,
        trade_count: 4,
        started_at: "2026-10-28T10:00:00+00:00",
        stopped_at: null,
        positions_managed: 3,
        log: [
          "POST /scalper/start -> daemon STARTED (symbol=XAUUSDm,BTCUSDm, lot=0.01, trade_count=4)",
          "DAEMON v3.1 idle — waiting for /scalper/start",
          "BATCH 1 OPENED — BUY XAUUSDm",
        ],
      },
    }));

    const result = await fetchScalperStatus();

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(`${BRIDGE}/scalper/status`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.running).toBe(true);
      expect(result.status.version).toBe("3.1");
      expect(result.status.symbols).toEqual(["XAUUSDm", "BTCUSDm"]);
      expect(result.status.trades).toBe(4);
      expect(result.status.positions).toBe(3);
      expect(result.status.message).toBe("BATCH 1 OPENED — BUY XAUUSDm");
    }
  });

  it("reports an unreachable bridge instead of a fake idle state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );

    const result = await fetchScalperStatus();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(BRIDGE);
  });
});

describe("allowed quotes → daemon plan", () => {
  it("keeps symbols with a trade count above zero and defaults the lot", () => {
    expect(
      planFromAllowedQuotes([
        { symbol: " XAUUSDm ", lotSize: "0.01", maxTrades: "4" },
        { symbol: "BTCUSDm", lotSize: "", maxTrades: "0" },
        { symbol: "", lotSize: "0.01", maxTrades: "2" },
        { symbol: "EURUSD", lotSize: "abc", maxTrades: "3" },
      ]),
    ).toEqual([
      { symbol: "XAUUSDm", lot: 0.01, trades: 4 },
      { symbol: "EURUSD", lot: 0.01, trades: 3 },
    ]);
  });
});
