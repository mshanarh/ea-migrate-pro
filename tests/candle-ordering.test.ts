import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fiveBarTrendSign,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";
import { BAR_SECONDS, BASE_TIME, bridgeSeries, type Candle } from "./breakout-fixtures";

/**
 * CANDLE ORDER — the bug that made auto-trading trade the opposite way.
 *
 * `bridge.py` serves `mt5.copy_rates_from_pos(...)`, which is OLDEST-FIRST.
 * The analysis used to read index 0 as "the latest close" and dropped index 0
 * as "the forming bar", so every slope/RSI/MA comparison ran backwards. These
 * tests pin the contract on the LIVE breakout engine: a rising broker series
 * breaks out UP, a falling one breaks out DOWN, whatever order the payload
 * arrives in, and "the last candle" is genuinely the most recent one.
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
  it("a rising broker series breaks out UP — never the inverse", async () => {
    stubBridge(candlesFromCloses(rising()));

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    expect(result.range).toBeTruthy();
    expect((result.direction as { entry: number }).entry).toBeGreaterThan(result.range!.high);
  });

  it("a falling broker series breaks out DOWN", async () => {
    stubBridge(candlesFromCloses(falling()));

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("SELL");
    expect((result.direction as { entry: number }).entry).toBeLessThan(result.range!.low);
  });

  it("the same series in reverse order yields the SAME direction (order is normalised)", async () => {
    const series = candlesFromCloses(rising());
    stubBridge(series);
    const oldestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    vi.unstubAllGlobals();

    stubBridge([...series].reverse());
    const newestFirst = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(newestFirst.direction.type).toBe(oldestFirst.direction.type);
    expect(newestFirst.range?.high).toBeCloseTo(oldestFirst.range?.high ?? 0, 10);
    expect(newestFirst.range?.low).toBeCloseTo(oldestFirst.range?.low ?? 0, 10);
  });

  it("the still-forming bar is dropped from the END, so candleTimestamp is the last CLOSED bar", async () => {
    const series = candlesFromCloses(rising());
    stubBridge(series);

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    // Last entry of `series` is the forming bar; the newest closed bar is the
    // one before it.
    expect(result.candleTimestamp).toBe(series[series.length - 2]!.time);
    // The forming bar's wild 50-point swing never reaches the range.
    expect(result.range!.high).toBeLessThan(series[series.length - 2]!.close + 50);
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

  it("refuses a live-price breakout that contradicts the last five closes, and prints them", async () => {
    // 15 alternating range bars, then six bars drifting DOWN inside the range.
    // The live ask pokes above the range (a live-price BUY trigger) while the
    // last five closes are falling — that mismatch must never reach MT5.
    const series = bridgeSeries({ low: 100, high: 110, breakoutClose: 101, bars: 20 });
    // Replace the last six completed bars with the drifting closes.
    const drifting = [109, 108, 107, 106, 105, 101];
    for (let i = 0; i < drifting.length; i += 1) {
      const index = series.length - 2 - drifting.length + i;
      series[index] = { ...series[index]!, close: drifting[i]! };
    }

    const completed = series.slice(0, -1);
    const lastClose = completed[completed.length - 1]!.close;
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
          // Ask clears the range by more than the buffer; bid stays inside.
          json: async () => ({
            success: true,
            bid: lastClose,
            ask: 111,
            digits: 2,
            point: 0.01,
            stops_level: 0,
          }),
        } as unknown as Response;
      }),
    );

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("NO_TRADE");
    const reason = result.direction.type === "NO_TRADE" ? result.direction.reason : "";
    expect(reason).toContain("Direction guard");
    expect(reason).toContain("Recent closes:");
    expect(result.executionReady).toBe(false);
  });
});
