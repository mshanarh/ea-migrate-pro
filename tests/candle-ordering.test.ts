import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyNoTrade,
  fiveBarTrendSign,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";

/**
 * CANDLE ORDER — the bug that made auto-trading trade the opposite way.
 *
 * `bridge.py` serves `mt5.copy_rates_from_pos(...)`, which is OLDEST-FIRST.
 * The analysis used to read index 0 as "the latest close" and dropped index 0
 * as "the forming bar", so every slope/RSI/MA comparison ran backwards. These
 * tests pin the contract: a bridge series produces the direction the market is
 * actually moving, whatever order the payload arrives in, and a chosen side
 * that contradicts the last five bars is refused instead of executed.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const BASE_TIME = 1_700_000_000;

/** Build oldest-first candles from a close series; the last bar is forming. */
function candlesFromCloses(closes: number[], reverse = false): Candle[] {
  const candles = closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      time: BASE_TIME + index * 3600,
      open,
      high: Math.max(open, close) + 0.4,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1000,
    };
  });
  // The bridge also sends the still-forming bar; it must be dropped from the
  // END (newest), never from the start.
  candles.push({
    time: BASE_TIME + closes.length * 3600,
    open: closes[closes.length - 1]!,
    high: closes[closes.length - 1]! + 5,
    low: closes[closes.length - 1]! - 5,
    close: closes[closes.length - 1]!,
    volume: 10,
  });
  return reverse ? [...candles].reverse() : candles;
}

/**
 * Stub the bridge: `/symbol/candles` answers per timeframe and `/symbol/price`
 * answers a live quote. `bridgeCandles` may arrive in either order — the
 * normaliser must not care.
 */
function stubCandles(series: { "15m": Candle[]; "1h": Candle[] }) {
  const candleRequests: Array<{ timeframe: string; symbol: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (target.endsWith("/symbol/candles")) {
        const timeframe = String(body["timeframe"]);
        candleRequests.push({ timeframe, symbol: String(body["symbol"]) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, candles: series[timeframe as "15m" | "1h"] ?? [] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, bid: 2649.7, ask: 2650.0, digits: 2, point: 0.01, stops_level: 0 }),
      } as unknown as Response;
    }),
  );
  return candleRequests;
}

function rising(start = 100, bars = 40, step = 0.01): number[] {
  const closes = [start];
  for (let i = 1; i < bars; i += 1) closes.push(closes[i - 1]! * (1 + step));
  return closes;
}

function falling(start = 100, bars = 40, step = 0.01): number[] {
  const closes = [start];
  for (let i = 1; i < bars; i += 1) closes.push(closes[i - 1]! * (1 - step));
  return closes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bridge candles are read oldest→newest", () => {
  it("a rising broker series produces BUY — not the inverse", async () => {
    stubCandles({ "15m": candlesFromCloses(rising()), "1h": candlesFromCloses(rising()) });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    expect(result.momentum15m).toBeGreaterThan(0);
    expect(result.momentum1h).toBeGreaterThan(0);
  });

  it("a falling broker series produces SELL", async () => {
    stubCandles({ "15m": candlesFromCloses(falling()), "1h": candlesFromCloses(falling()) });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("SELL");
    expect(result.momentum15m).toBeLessThan(0);
    expect(result.momentum1h).toBeLessThan(0);
  });

  it("the same series in reverse order yields the SAME direction (order is normalised)", async () => {
    stubCandles({ "15m": candlesFromCloses(rising()), "1h": candlesFromCloses(rising()) });
    const oldestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    vi.unstubAllGlobals();

    stubCandles({
      "15m": candlesFromCloses(rising(), true),
      "1h": candlesFromCloses(rising(), true),
    });
    const newestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(newestFirst.direction.type).toBe(oldestFirst.direction.type);
    expect(newestFirst.momentum1h).toBeCloseTo(oldestFirst.momentum1h ?? 0, 10);
  });

  it("the still-forming bar is dropped from the END, so candleTimestamp is the last CLOSED bar", async () => {
    const closes = rising();
    const series = candlesFromCloses(closes);
    stubCandles({ "15m": candlesFromCloses(closes), "1h": series });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    // Last entry of `series` is the forming bar; the newest closed bar is the
    // one before it.
    expect(result.candleTimestamp).toBe(series[series.length - 2]!.time);
  });

  it("live candles are actually requested from the bridge with the caller's credentials", async () => {
    const requests = stubCandles({
      "15m": candlesFromCloses(rising()),
      "1h": candlesFromCloses(rising()),
    });

    await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(requests.map((request) => request.timeframe).sort()).toEqual(["15m", "1h"]);
    expect(requests.every((request) => request.symbol === "XAUUSD")).toBe(true);
  });
});

describe("Direction guard", () => {
  it("classifies a five-bar trend from the newest close", () => {
    const up = rising(100, 8).map((close) => ({ close }));
    const down = falling(100, 8).map((close) => ({ close }));
    expect(fiveBarTrendSign(up)).toBe(1);
    expect(fiveBarTrendSign(down)).toBe(-1);
    expect(fiveBarTrendSign([{ close: 1 }, { close: 2 }])).toBeNull();
  });

  it("refuses a SELL into a rising market and reports the actual closes", async () => {
    // Strongly rising series with a final down bar: RSI is overbought and the
    // last candle is bearish, so the engine's own bias resolves to SELL while
    // the market has been RISING for the last five candles. That mismatch must
    // never reach MT5.
    const closes = rising(100, 40, 0.012);
    const previous = closes[closes.length - 1]!;
    closes.push(previous * 0.995);

    stubCandles({ "15m": candlesFromCloses(closes), "1h": candlesFromCloses(closes) });

    const trend = fiveBarTrendSign(candlesFromCloses(closes).slice(0, -1).slice(-6));
    expect(trend, "the last six closed bars must be a rising trend for this case").toBe(1);

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("NO_TRADE");
    const reason = result.direction.type === "NO_TRADE" ? result.direction.reason : "";
    expect(reason).toContain("Direction guard");
    expect(reason).toContain("Recent closes:");
    expect(result.executionReady).toBe(false);
    expect(classifyNoTrade(reason)).toBe("direction mismatch");
  });
});
