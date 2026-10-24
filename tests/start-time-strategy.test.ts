import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EXTENSION_ATR,
  MOMENTUM_LOOKBACK,
  STOP_LOOKBACK,
  classifyNoTrade,
  evaluateMomentum,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";
import { pullbackSeries } from "./breakout-fixtures";

/**
 * THE START-TIME STRATEGY — auto-trading's only decision engine on live data.
 *
 *   direction = last 5 completed 15m closes vs the earlier ones (net up → BUY,
 *               net down → SELL), the live quote only breaking a real tie;
 *   SL        = below the lowest low (buy) / above the highest high (sell) of
 *               the last 10 completed bars;
 *   TP1       = 1× the SL distance, TP2 = 2×;
 *   no trade  = only missing/stale candles, an invalid price, a proxy symbol
 *               or invalid SL/TP. No range, no breakout wait, no default side.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

const BASE_TIME = 1_700_000_000;
const BAR_SECONDS = 900;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Oldest-first completed bars; each bar's range is ±spread around open/close. */
function bars(closes: number[], spread = 0.5): Candle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      time: BASE_TIME + index * BAR_SECONDS,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 1000,
    };
  });
}

/** What the bridge serves: completed bars plus the still-forming bar at the END. */
function bridgeSeries(closes: number[]): Candle[] {
  const out = bars(closes);
  const last = closes[closes.length - 1]!;
  out.push({
    time: BASE_TIME + closes.length * BAR_SECONDS,
    open: last,
    high: last + 50,
    low: last - 50,
    close: last,
    volume: 10,
  });
  return out;
}

type Quote = { bid: number; ask: number };
type Captured = { url: string; body: Record<string, unknown> };

/**
 * Stub the bridge. `seriesList` answers one candle payload per candle request,
 * in order (the last entry repeats), so a batch can watch the market turn.
 */
function stubBridge(seriesList: Candle[][], quote: Quote): Captured[] {
  const captured: Captured[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url: target, body });
      if (target.endsWith("/symbol/candles")) {
        const series = seriesList[Math.min(call, seriesList.length - 1)]!;
        call += 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, candles: series }) } as unknown as Response;
      }
      if (target.endsWith("/symbol/price")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            bid: quote.bid,
            ask: quote.ask,
            digits: 2,
            point: 0.01,
            stops_level: 0,
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ retcode: 10009, order: 4242 }) } as unknown as Response;
    }),
  );
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A tradeable BUY / SELL: a gentle drift inside 2 ATR of the 20-candle
 * average, then a pullback bar and a completed candle closing with the trend.
 * A straight vertical ramp is now REFUSED by the overextension filter — see
 * the gate tests below.
 */
const BUY_FIXTURE = pullbackSeries({ direction: "BUY" });
const SELL_FIXTURE = pullbackSeries({ direction: "SELL" });
/** The same series with the still-forming bar a real bridge payload ends with. */
const BUY_SERIES = pullbackSeries({ direction: "BUY", forming: true });
const SELL_SERIES = pullbackSeries({ direction: "SELL", forming: true });
/** The same live price level as BUY_SERIES, reading SELL — for the flip test. */
const SELL_AT_BUY_PRICES = pullbackSeries({ direction: "SELL", base: 1.104, forming: true });
/** Sideways chop that still ends 0.6 up — a range the old engine refused. */
const CHOP = [101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 100.6];

describe("evaluateMomentum — the market picture at start time", () => {
  it("BUYs when the last 5 closes net up, with the 10-bar stop and 1×/2× targets", () => {
    const { candles, closes, ask, bid } = BUY_FIXTURE;
    const result = evaluateMomentum({ candles, ask, bid });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("BUY");
    expect(plan.setup.basis).toBe("last 5 closes");
    expect(plan.setup.lastClose).toBe(closes[closes.length - 1]);
    expect(plan.setup.referenceClose).toBe(closes[closes.length - 1 - MOMENTUM_LOOKBACK]);
    expect(plan.setup.netMove).toBeCloseTo(
      closes[closes.length - 1]! - closes[closes.length - 1 - MOMENTUM_LOOKBACK]!,
      10,
    );
    expect(plan.setup.stopBars).toBe(STOP_LOOKBACK);

    // SL sits BELOW the lowest low of the last 10 completed bars.
    const lowest = Math.min(...candles.slice(-STOP_LOOKBACK).map((candle) => candle.low));
    expect(plan.setup.stopExtreme).toBe(lowest);
    expect(plan.sl).toBeLessThan(lowest);

    // Entry is the ask a BUY pays; TP1 = 1× the SL distance, TP2 = 2×.
    expect(plan.entry).toBe(ask);
    const risk = plan.entry - plan.sl;
    expect(plan.tp1 - plan.entry).toBeCloseTo(risk, 10);
    expect(plan.tp2 - plan.entry).toBeCloseTo(risk * 2, 10);
    expect(plan.reason).toContain("TP1");
    expect(plan.reason).toContain("TP2");
    // The card's measurement travels with the plan.
    expect(plan.gate.direction).toBe("BUY");
    expect(plan.gate.extensionAtr).toBeLessThanOrEqual(MAX_EXTENSION_ATR);
    expect(plan.reason).toContain("Entry filter");
  });

  it("SELLs when the last 5 closes net down, SL above the 10-bar high", () => {
    const { candles, closes, ask, bid } = SELL_FIXTURE;
    const result = evaluateMomentum({ candles, ask, bid });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("SELL");
    expect(plan.setup.netMove).toBeCloseTo(
      closes[closes.length - 1]! - closes[closes.length - 1 - MOMENTUM_LOOKBACK]!,
      10,
    );
    const highest = Math.max(...candles.slice(-STOP_LOOKBACK).map((candle) => candle.high));
    expect(plan.setup.stopExtreme).toBe(highest);
    expect(plan.sl).toBeGreaterThan(highest);

    const risk = plan.sl - plan.entry;
    expect(plan.tp1).toBeLessThan(plan.entry);
    expect(plan.entry - plan.tp1).toBeCloseTo(risk, 10);
    expect(plan.entry - plan.tp2).toBeCloseTo(risk * 2, 10);
  });

  it("trades a market that is still INSIDE its recent range — there is no breakout condition", () => {
    const result = evaluateMomentum({ candles: bars(CHOP), ask: 100.8, bid: 100.7 });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    // 100.6 is well inside the 99.5–101.5 range of the last ten bars.
    expect(result.plan.signal).toBe("BUY");
    expect(result.plan.setup.netMove).toBeCloseTo(0.6, 10);
    expect(result.plan.reason).not.toMatch(/breakout|inside the .* range|weak setup/i);
  });

  it("hands flat closes to the live quote instead of defaulting a side", () => {
    // The quote still decides the side (no default), and that side is what the
    // filter measures. A zero-body candle cannot CONFIRM it, so the entry waits
    // — the derivation itself is unchanged.
    const flat = Array<number>(11).fill(100);

    const up = evaluateMomentum({ candles: bars(flat), ask: 100.3, bid: 100.2 });
    expect(up.kind).toBe("no-trade");
    if (up.kind !== "no-trade") return;
    expect(up.setup?.basis).toBe("live quote");
    expect(up.gate?.direction).toBe("BUY");
    expect(up.gate?.verdict).toBe("waiting-confirmation");

    vi.restoreAllMocks();
    const down = evaluateMomentum({ candles: bars(flat), ask: 99.8, bid: 99.7 });
    expect(down.kind).toBe("no-trade");
    if (down.kind !== "no-trade") return;
    expect(down.setup?.basis).toBe("live quote");
    expect(down.gate?.direction).toBe("SELL");
  });

  it("skips a genuinely zero-flat market with \"market flat\"", () => {
    const flat = Array<number>(11).fill(100);
    const result = evaluateMomentum({ candles: bars(flat), ask: 100, bid: 100 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.reason).toContain("Market flat");
    expect(result.setup).toBeNull();
    expect(classifyNoTrade(result.reason)).toBe("flat market");
  });

  it("refuses when there are not enough completed candles", () => {
    const result = evaluateMomentum({ candles: bars([100, 101, 102]), ask: 102.2, bid: 102.1 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.reason).toContain("Missing or unavailable broker data");
    expect(result.reason).toContain(String(STOP_LOOKBACK));
    expect(result.setup).toBeNull();
  });

  it("refuses an invalid or zero price", () => {
    const result = evaluateMomentum({ candles: BUY_FIXTURE.candles, ask: 0, bid: 0 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.reason).toContain("Invalid or zero price");
    expect(classifyNoTrade(result.reason)).toBe("no data");
  });
});

describe("overextension filter — when an entry is allowed", () => {
  it("skips a SELL into a completed drop that is more than 2 ATR below the average", () => {
    // A vertical slide: 3.00 per bar, so the live price ends ~8 ATR below the
    // 20-candle average. Selling here is selling the bottom of the move.
    const dropCloses = Array.from({ length: 21 }, (_, index) => 130 - index * 3);
    const result = evaluateMomentum({ candles: bars(dropCloses, 0.5), ask: 69.9, bid: 69.8 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.gate?.direction).toBe("SELL");
    expect(result.gate?.verdict).toBe("too-extended");
    expect(result.gate!.extensionAtr).toBeGreaterThan(MAX_EXTENSION_ATR);
    expect(result.reason).toContain("move too extended, waiting for pullback");
    expect(result.reason).toContain("trend SELL");
    expect(result.reason).toContain("extension");
    expect(result.reason).toContain("ATR");
    expect(classifyNoTrade(result.reason)).toBe("waiting for pullback");
  });

  it("skips a BUY at the top of a completed rally the same way", () => {
    const rallyCloses = Array.from({ length: 21 }, (_, index) => 70 + index * 3);
    const result = evaluateMomentum({ candles: bars(rallyCloses, 0.5), ask: 130.2, bid: 130.1 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.gate?.direction).toBe("BUY");
    expect(result.gate?.verdict).toBe("too-extended");
    expect(result.gate!.extensionAtr).toBeGreaterThan(MAX_EXTENSION_ATR);
  });

  it("waits for a pullback when price is still at the recent extreme", () => {
    // Gentle drift (well inside 2 ATR) but the live price sits on the high —
    // there is no pullback to enter on yet.
    const closes = Array.from({ length: 21 }, (_, index) => 1.1 + index * 0.00008);
    const result = evaluateMomentum({ candles: bars(closes, 0.0004), ask: 1.10205, bid: 1.10195 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.gate?.direction).toBe("BUY");
    expect(result.gate!.extensionAtr).toBeLessThanOrEqual(MAX_EXTENSION_ATR);
    expect(result.gate?.verdict).toBe("waiting-pullback");
    expect(result.reason).toContain("waiting for pullback");
  });

  it("waits for a completed candle that confirms the side", () => {
    // A pullback is there, but the newest COMPLETED candle closed UP while the
    // signal is SELL — the entry waits for a finished bearish candle.
    const closes = [
      1.102, 1.1018, 1.1016, 1.1014, 1.1012, 1.101, 1.1008, 1.1006, 1.1004, 1.1002,
      1.1, 1.0998, 1.0996, 1.0994, 1.0992, 1.099, 1.0988, 1.0986, 1.0984, 1.0982, 1.0986,
    ];
    const result = evaluateMomentum({ candles: bars(closes, 0.0004), ask: 1.0987, bid: 1.0986 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.gate?.direction).toBe("SELL");
    expect(result.gate?.confirmed).toBe(false);
    expect(result.gate?.verdict).toBe("waiting-confirmation");
    expect(result.reason).toContain("waiting for confirmation");
  });
});

describe("resolveTradeDirection — live start-time decision", () => {
  it("returns the side, its setup and TP1/TP2 for the order", async () => {
    stubBridge([BUY_SERIES.candles], { bid: BUY_SERIES.bid, ask: BUY_SERIES.ask });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    if (result.direction.type === "NO_TRADE") return;
    expect(result.direction.entry).toBe(BUY_SERIES.ask);
    // The broker order carries TP1; TP2 rides alongside.
    expect(result.direction.tp).toBeCloseTo(result.direction.tp1!, 10);
    const risk = result.direction.entry - result.direction.sl;
    expect(result.direction.tp2! - result.direction.entry).toBeCloseTo(risk * 2, 10);
    expect(result.direction.rrRatio).toBeGreaterThan(0);
    expect(result.setup?.lastClose).toBe(BUY_SERIES.closes[BUY_SERIES.closes.length - 1]);
    expect(result.setup?.basis).toBe("last 5 closes");
    expect(result.strength).toBe("strong");
    expect(result.executionReady).toBe(true);
    expect(result.timeframe).toBe("15m");
    // What the popup shows: trend and extension in ATR.
    expect(result.gate?.direction).toBe("BUY");
    expect(result.gate?.verdict).toBe("enter");
    expect(result.gate?.extensionAtr).toBeLessThanOrEqual(MAX_EXTENSION_ATR);
  });

  it("SELLs a falling series", async () => {
    stubBridge([SELL_SERIES.candles], { bid: SELL_SERIES.bid, ask: SELL_SERIES.ask });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("SELL");
    if (result.direction.type === "NO_TRADE") return;
    expect(result.direction.sl).toBeGreaterThan(result.direction.entry);
    expect(result.setup?.netMove).toBeLessThan(0);
  });

  it("logs ONE decision line with the closes, net move, price and verdict", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    stubBridge([BUY_SERIES.candles], { bid: BUY_SERIES.bid, ask: BUY_SERIES.ask });

    await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    const closes = BUY_SERIES.closes;
    const reference = closes[closes.length - 1 - MOMENTUM_LOOKBACK]!;
    const newest = closes[closes.length - 1]!;
    const decisionLines = logs.filter((line) => line.includes("START 15m:"));
    expect(decisionLines).toHaveLength(1);
    expect(decisionLines[0]).toContain(`closes ${reference} → ${newest}`);
    expect(decisionLines[0]).toContain(`price ${BUY_SERIES.ask}`);
    // The measurement is on the same line — extension in ATR(14).
    expect(decisionLines[0]).toContain("extension");
    expect(decisionLines[0]).toContain("ATR");
    expect(decisionLines[0]).toContain("BUY");
  });
});

describe("executeAutoTrade — start-time entry and the batch direction re-check", () => {
  it("places the order immediately, without waiting for any breakout", async () => {
    const captured = stubBridge([bridgeSeries(CHOP)], { bid: 100.7, ask: 100.8 });

    const results = await executeAutoTrade({
      symbol: "XAUUSD",
      lotSize: 0.1,
      maxTrades: 1,
      eaName: "start-time bot",
      credentials: CREDENTIALS,
    });

    expect(results[0]!.status).toBe("executed");
    expect(results[0]!.side).toBe("BUY");
    const order = captured.find((request) => request.url.endsWith("/trade/execute"))!;
    expect(order.body["action"]).toBe("BUY");
    expect(order.body["comment"]).toBe("start-time bot");
    // The bridge fills at the live ask; the order carries the levels around it.
    const entry = 100.8;
    expect(Number(order.body["stop_loss"])).toBeLessThan(entry);
    expect(Number(order.body["take_profit"])).toBeGreaterThan(entry);
  });

  it("stops the remaining orders when the direction flips between them", async () => {
    // Order 1 reads a rising series (BUY); by order 2 the broker serves a
    // falling one (SELL) — the batch must stop, not fire the other way.
    const captured = stubBridge(
      [BUY_SERIES.candles, SELL_AT_BUY_PRICES.candles],
      { bid: BUY_SERIES.bid, ask: BUY_SERIES.ask },
    );

    const results = await executeAutoTrade({
      symbol: "XAUUSD",
      lotSize: 0.1,
      maxTrades: 2,
      eaName: "start-time bot",
      credentials: CREDENTIALS,
    });

    const orders = captured.filter((request) => request.url.endsWith("/trade/execute"));
    expect(orders).toHaveLength(1);
    expect(orders[0]!.body["action"]).toBe("BUY");
    expect(results[1]!.status).toBe("blocked");
    expect(results[1]!.message).toContain("direction changed, stopped remaining trades");
  });
});
