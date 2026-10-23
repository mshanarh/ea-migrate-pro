import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BREAKOUT_LOOKBACK,
  classifyNoTrade,
  evaluateBreakout,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";
import { bridgeSeries, type Candle } from "./breakout-fixtures";

/**
 * THE BREAKOUT STRATEGY — auto-trading's only decision engine on live data.
 *
 *   range = highest high / lowest low of the 20 completed bars BEFORE the
 *           newest completed bar;
 *   BUY   = that bar closes above the range high, or the live ask clears it by
 *           the 0.05%-of-range buffer;
 *   SELL  = mirrored;
 *   inside the range → NO TRADE (no RSI vote, no momentum vote, no default);
 *   SL    = just outside the range, TP1 = 1× range, TP2 = 2× range.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

type Captured = { url: string; body: Record<string, unknown> };

function stubBridge(series: Candle[], quote: { bid: number; ask: number }): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      captured.push({
        url: target,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      if (target.endsWith("/symbol/candles")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, candles: series }) } as unknown as Response;
      }
      if (target.endsWith("/symbol/price")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, ...quote, digits: 2, point: 0.01, stops_level: 0 }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ retcode: 10009, order: 4242 }) } as unknown as Response;
    }),
  );
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const RANGE = { low: 100, high: 110 };

describe("evaluateBreakout — range and signals", () => {
  it("BUYs a completed candle closing above the 20-bar range, with the spec levels", () => {
    const series = bridgeSeries({ ...RANGE, breakoutClose: 112 });
    const completed = series.slice(0, -1);

    const result = evaluateBreakout({ candles: completed, ask: 112.5, bid: 112.4 });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("BUY");
    expect(plan.trigger).toBe("candle close");
    // The range is the 20 completed bars PRECEDING the breakout bar — the
    // breakout bar's own high (112) must not lift the level it cleared.
    expect(plan.range.bars).toBe(BREAKOUT_LOOKBACK);
    expect(plan.range.high).toBe(110);
    expect(plan.range.low).toBe(100);
    expect(plan.range.height).toBe(10);
    // Buffer = 0.05% of the range height.
    expect(plan.range.buffer).toBeCloseTo(0.005, 10);

    expect(plan.entry).toBe(112.5);
    // SL just BELOW the range low.
    expect(plan.sl).toBeCloseTo(100 - 0.005, 10);
    expect(plan.sl).toBeLessThan(100);
    // TP1 = 1× range from entry, TP2 = 2× range.
    expect(plan.tp1).toBeCloseTo(112.5 + 10, 10);
    expect(plan.tp2).toBeCloseTo(112.5 + 20, 10);
    expect(plan.reason).toContain("TP1");
    expect(plan.reason).toContain("TP2");
  });

  it("SELLs a completed candle closing below the range, SL just above the range high", () => {
    const series = bridgeSeries({ ...RANGE, breakoutClose: 98 });
    const completed = series.slice(0, -1);

    const result = evaluateBreakout({ candles: completed, ask: 97.6, bid: 97.5 });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("SELL");
    expect(plan.trigger).toBe("candle close");
    expect(plan.entry).toBe(97.5);
    expect(plan.sl).toBeCloseTo(110 + 0.005, 10);
    expect(plan.sl).toBeGreaterThan(110);
    expect(plan.tp1).toBeCloseTo(97.5 - 10, 10);
    expect(plan.tp2).toBeCloseTo(97.5 - 20, 10);
  });

  it("does NOT trade while price is inside the range", () => {
    const series = bridgeSeries({ ...RANGE, breakoutClose: 105 });
    const completed = series.slice(0, -1);

    const result = evaluateBreakout({ candles: completed, ask: 105.1, bid: 105 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.reason).toContain("inside the 15m range 100–110");
    expect(result.reason).toContain("105.05");
    expect(result.range?.high).toBe(110);
    expect(result.range?.low).toBe(100);
  });

  it("accepts a LIVE break only with the 0.05% buffer, never a hair above the level", () => {
    const series = bridgeSeries({ ...RANGE, breakoutClose: 105 });
    const completed = series.slice(0, -1);
    const buffer = 10 * 0.0005;

    const atLevel = evaluateBreakout({ candles: completed, ask: 110 + buffer, bid: 109.9 });
    expect(atLevel.kind, "exactly at the buffer is not a breakout").toBe("no-trade");

    const through = evaluateBreakout({ candles: completed, ask: 110 + buffer * 2, bid: 109.9 });
    expect(through.kind).toBe("signal");
    if (through.kind !== "signal") return;
    expect(through.plan.signal).toBe("BUY");
    expect(through.plan.trigger).toBe("live price");
  });

  it("refuses to guess when there are not enough completed candles", () => {
    const series = bridgeSeries({ ...RANGE, breakoutClose: 112, bars: 10 });
    const result = evaluateBreakout({ candles: series.slice(0, -1), ask: 112.5, bid: 112.4 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.range).toBeNull();
    expect(result.reason).toContain("Breakout skipped");
  });
});

describe("resolveTradeDirection — live breakout", () => {
  it("returns the breakout plan with TP1 as the order target and TP2 alongside", async () => {
    stubBridge(bridgeSeries({ ...RANGE, breakoutClose: 112 }), { bid: 112.4, ask: 112.5 });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    if (result.direction.type === "NO_TRADE") return;
    expect(result.direction.entry).toBe(112.5);
    expect(result.direction.sl).toBeCloseTo(99.995, 10);
    expect(result.direction.tp).toBeCloseTo(122.5, 10);
    expect(result.direction.tp1).toBeCloseTo(122.5, 10);
    expect(result.direction.tp2).toBeCloseTo(132.5, 10);
    // TP1 sits exactly one range height above the entry.
    expect(result.direction.tp! - result.direction.entry).toBeCloseTo(10, 10);
    expect(result.direction.rrRatio).toBeGreaterThan(0);
    expect(result.strength).toBe("strong");
    expect(result.executionReady).toBe(true);
    expect(result.range?.high).toBe(110);
    expect(result.range?.low).toBe(100);
  });

  it("logs ONE decision line with the range high, the range low, the price and the verdict", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    stubBridge(bridgeSeries({ ...RANGE, breakoutClose: 105 }), { bid: 105, ask: 105.1 });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });
    spy.mockRestore();

    expect(result.direction.type).toBe("NO_TRADE");
    const decisionLines = logs.filter((line) => line.includes("BREAKOUT 15m:"));
    expect(decisionLines).toHaveLength(1);
    expect(decisionLines[0]).toContain("range high 110");
    expect(decisionLines[0]).toContain("range low 100");
    expect(decisionLines[0]).toContain("price 105.05");
    expect(decisionLines[0]).toContain("NO TRADE");
    expect(classifyNoTrade(result.reason)).toBe("weak setup");
  });
});

describe("executeAutoTrade — the pre-order breakout re-check", () => {
  it("skips the order when price has moved back inside the range since the signal", async () => {
    // The completed candle broke above 110, but every live quote sits at 105 —
    // inside the range. The breakout did not hold: nothing may reach MT5.
    const captured = stubBridge(bridgeSeries({ ...RANGE, breakoutClose: 112 }), { bid: 105, ask: 105.1 });

    const results = await executeAutoTrade({
      symbol: "XAUUSD",
      lotSize: 0.1,
      maxTrades: 1,
      eaName: "breakout bot",
      credentials: CREDENTIALS,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("blocked");
    expect(results[0]!.message).toContain("breakout faded");
    expect(results[0]!.message).toContain("range high 110");
    expect(results[0]!.message).toContain("range low 100");
    expect(results[0]!.message).toContain("price now 105.1");
    expect(captured.some((request) => request.url.endsWith("/trade/execute"))).toBe(false);
  });

  it("places the order when the breakout still holds at the live quote", async () => {
    const captured = stubBridge(bridgeSeries({ ...RANGE, breakoutClose: 112 }), { bid: 112.4, ask: 112.5 });

    const results = await executeAutoTrade({
      symbol: "XAUUSD",
      lotSize: 0.1,
      maxTrades: 1,
      eaName: "breakout bot",
      credentials: CREDENTIALS,
    });

    expect(results[0]!.status).toBe("executed");
    expect(results[0]!.side).toBe("BUY");
    const order = captured.find((request) => request.url.endsWith("/trade/execute"))!;
    expect(order.body["action"]).toBe("BUY");
    const entry = Number(order.body["price"] ?? 112.5);
    expect(Number(order.body["stop_loss"])).toBeLessThan(entry);
    expect(Number(order.body["take_profit"])).toBeGreaterThan(entry);
  });
});
