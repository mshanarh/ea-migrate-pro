import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fiveBarTrendSign,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";
import { BAR_SECONDS, BASE_TIME, bridgeSeries, pullbackSeries, type Candle } from "./breakout-fixtures";

/**
 * CANDLE ORDER — the bug that made auto-trading trade the opposite way.
 *
 * `bridge.py` serves `mt5.copy_rates_from_pos(...)`, which is OLDEST-FIRST.
 * The analysis used to read index 0 as "the latest close" and dropped index 0
 * as "the forming bar", so every slope/RSI/MA comparison ran backwards. These
 * tests pin the contract on the LIVE start-time engine: a rising broker series
 * reads BUY, a falling one reads SELL, whatever order the payload arrives in,
 * and "the last candle" is genuinely the most recent one.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

/** Build oldest-first candles from a close series; a forming bar is appended. */
function candlesFromCloses(closes: number[]): Candle[] {
  const candles = closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      time: BASE_TIME + index * BAR_SECONDS,
      open,
      high: Math.max(open, close) + 0.4,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1000,
    };
  });
  candles.push({
    time: BASE_TIME + closes.length * BAR_SECONDS,
    open: closes[closes.length - 1]!,
    high: closes[closes.length - 1]! + 50,
    low: closes[closes.length - 1]! - 50,
    close: closes[closes.length - 1]!,
    volume: 10,
  });
  return candles;
}

/**
 * Stub the bridge: `/symbol/candles` answers the 15m series and
 * `/symbol/price` answers a quote pinned just above the newest completed close
 * (so the live quote agrees with the series' own direction). `reverse` sends
 * the payload newest-first, which the normaliser must not care about.
 */
function stubBridge(candles15m: Candle[]) {
  const requests: Array<{ timeframe: string; symbol: string }> = [];
  // The quote follows the CHRONOLOGICAL last completed bar, whatever order the
  // payload was sent in.
  const ascending = [...candles15m].sort((a, b) => a.time - b.time);
  const completed = ascending.slice(0, -1);
  const lastClose = completed[completed.length - 1]!.close;
  const bid = lastClose * 0.99999;
  const ask = lastClose * 1.00001;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (target.endsWith("/symbol/candles")) {
        requests.push({ timeframe: String(body["timeframe"]), symbol: String(body["symbol"]) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, candles: candles15m }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, bid, ask, digits: 2, point: 0.01, stops_level: 0 }),
      } as unknown as Response;
    }),
  );
  return requests;
}

function rising(start = 100, bars = 40, step = 0.01): number[] {
  const closes = [start];
  for (let i = 1; i < bars; i += 1) closes.push(closes[i - 1]! * (1 + step));
  return closes;
}

function falling(start = 300, bars = 40, step = 0.01): number[] {
  const closes = [start];
  for (let i = 1; i < bars; i += 1) closes.push(closes[i - 1]! * (1 - step));
  return closes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bridge candles are read oldest→newest", () => {
  it("a rising broker series BUYs — never the inverse", async () => {
    // A tradeable rise (pullback + confirming candle): a vertical ramp is
    // refused by the overextension filter, so it cannot prove the direction.
    stubBridge(pullbackSeries({ direction: "BUY", forming: true }).candles);

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    expect(result.setup?.basis).toBe("last 5 closes");
    expect(result.setup!.netMove).toBeGreaterThan(0);
  });

  it("a falling broker series SELLs", async () => {
    stubBridge(pullbackSeries({ direction: "SELL", forming: true }).candles);

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("SELL");
    expect(result.setup!.netMove).toBeLessThan(0);
  });

  it("the same series in reverse order yields the SAME direction (order is normalised)", async () => {
    const series = candlesFromCloses(rising());
    stubBridge(series);
    const oldestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    vi.unstubAllGlobals();

    stubBridge([...series].reverse());
    const newestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(newestFirst.direction.type).toBe(oldestFirst.direction.type);
    expect(newestFirst.setup?.lastClose).toBeCloseTo(oldestFirst.setup?.lastClose ?? 0, 10);
    expect(newestFirst.setup?.referenceClose).toBeCloseTo(oldestFirst.setup?.referenceClose ?? 0, 10);
    expect(newestFirst.setup?.stopExtreme).toBeCloseTo(oldestFirst.setup?.stopExtreme ?? 0, 10);
  });

  it("the still-forming bar is dropped from the END, so candleTimestamp is the last CLOSED bar", async () => {
    const series = candlesFromCloses(rising());
    stubBridge(series);

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    // Last entry of `series` is the forming bar; the newest closed bar is the
    // one before it.
    expect(result.candleTimestamp).toBe(series[series.length - 2]!.time);
    // The decision read the last CLOSED close, never the forming bar.
    expect(result.setup!.lastClose).toBe(series[series.length - 2]!.close);
    // The forming bar's wild 50-point swing never reaches the stop window.
    expect(result.setup!.stopExtreme).toBeGreaterThan(series[series.length - 2]!.close - 50);
  });

  it("requests the trading timeframe with the caller's credentials", async () => {
    const requests = stubBridge(candlesFromCloses(rising()));

    await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(requests.map((request) => request.timeframe)).toEqual(["15m"]);
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

  it("takes the side from the CLOSES, not from where the live quote happens to sit", async () => {
    // Six bars drifting DOWN, while the live ask prints above them. The closes
    // decide (SELL); the quote is only a tiebreaker for flat closes, so it can
    // never flip a falling series into a buy.
    const series = bridgeSeries({ low: 100, high: 110, breakoutClose: 101, bars: 20 });
    const drifting = [109, 108, 107, 106, 105, 101];
    for (let i = 0; i < drifting.length; i += 1) {
      const index = series.length - 2 - drifting.length + i;
      series[index] = { ...series[index]!, close: drifting[i]! };
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const target = String(url);
        if (target.endsWith("/symbol/candles")) {
          return { ok: true, status: 200, json: async () => ({ ok: true, candles: series }) } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            bid: 111,
            ask: 111.1,
            digits: 2,
            point: 0.01,
            stops_level: 0,
          }),
        } as unknown as Response;
      }),
    );

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.setup?.netMove).toBeLessThan(0);
    expect(result.setup?.basis).toBe("last 5 closes");
    // The falling closes win even though the quote sits above them — and the
    // live price is above the 10-bar high, so the SELL levels are refused
    // rather than inverted (invalid SL/TP is the only honest outcome).
    expect(result.direction.type).toBe("NO_TRADE");
    const reason = result.direction.type === "NO_TRADE" ? result.direction.reason : "";
    expect(reason).toContain("Invalid SL/TP levels");
    expect(result.executionReady).toBe(false);
  });
});
