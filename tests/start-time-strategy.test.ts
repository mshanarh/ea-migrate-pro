import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOMENTUM_LOOKBACK,
  STOP_LOOKBACK,
  classifyNoTrade,
  evaluateMomentum,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "../src/lib/auto-trade";

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

/** 11 completed bars climbing 100 → 105. */
const RISING = [100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104, 104.5, 105];
/** The mirror image, 110 → 105. */
const FALLING = [110, 109.5, 109, 108.5, 108, 107.5, 107, 106.5, 106, 105.5, 105];
/** Sideways chop that still ends 0.6 up — a range the old engine refused. */
const CHOP = [101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 100.6];

describe("evaluateMomentum — the market picture at start time", () => {
  it("BUYs when the last 5 closes net up, with the 10-bar stop and 1×/2× targets", () => {
    const candles = bars(RISING);
    const result = evaluateMomentum({ candles, ask: 105.2, bid: 105.1 });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("BUY");
    expect(plan.setup.basis).toBe("last 5 closes");
    expect(plan.setup.lastClose).toBe(105);
    expect(plan.setup.referenceClose).toBe(RISING[RISING.length - 1 - MOMENTUM_LOOKBACK]);
    expect(plan.setup.netMove).toBeCloseTo(2.5, 10);
    expect(plan.setup.stopBars).toBe(STOP_LOOKBACK);

    // SL sits BELOW the lowest low of the last 10 completed bars.
    const lowest = Math.min(...candles.slice(-STOP_LOOKBACK).map((candle) => candle.low));
    expect(plan.setup.stopExtreme).toBe(lowest);
    expect(plan.sl).toBeLessThan(lowest);

    // Entry is the ask a BUY pays; TP1 = 1× the SL distance, TP2 = 2×.
    expect(plan.entry).toBe(105.2);
    const risk = plan.entry - plan.sl;
    expect(plan.tp1 - plan.entry).toBeCloseTo(risk, 10);
    expect(plan.tp2 - plan.entry).toBeCloseTo(risk * 2, 10);
    expect(plan.reason).toContain("TP1");
    expect(plan.reason).toContain("TP2");
  });

  it("SELLs when the last 5 closes net down, SL above the 10-bar high", () => {
    const candles = bars(FALLING);
    const result = evaluateMomentum({ candles, ask: 105, bid: 104.9 });

    expect(result.kind).toBe("signal");
    if (result.kind !== "signal") return;
    const { plan } = result;

    expect(plan.signal).toBe("SELL");
    expect(plan.setup.netMove).toBeCloseTo(-2.5, 10);
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
    const flat = Array<number>(11).fill(100);
    const up = evaluateMomentum({ candles: bars(flat), ask: 100.3, bid: 100.2 });
    expect(up.kind).toBe("signal");
    if (up.kind !== "signal") return;
    expect(up.plan.signal).toBe("BUY");
    expect(up.plan.setup.basis).toBe("live quote");

    vi.restoreAllMocks();
    const down = evaluateMomentum({ candles: bars(flat), ask: 99.8, bid: 99.7 });
    expect(down.kind).toBe("signal");
    if (down.kind !== "signal") return;
    expect(down.plan.signal).toBe("SELL");
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
    const result = evaluateMomentum({ candles: bars(RISING), ask: 0, bid: 0 });

    expect(result.kind).toBe("no-trade");
    if (result.kind !== "no-trade") return;
    expect(result.reason).toContain("Invalid or zero price");
    expect(classifyNoTrade(result.reason)).toBe("no data");
  });
});

describe("resolveTradeDirection — live start-time decision", () => {
  it("returns the side, its setup and TP1/TP2 for the order", async () => {
    stubBridge([bridgeSeries(RISING)], { bid: 105.1, ask: 105.2 });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    if (result.direction.type === "NO_TRADE") return;
    expect(result.direction.entry).toBe(105.2);
    // The broker order carries TP1; TP2 rides alongside.
    expect(result.direction.tp).toBeCloseTo(result.direction.tp1!, 10);
    const risk = result.direction.entry - result.direction.sl;
    expect(result.direction.tp2! - result.direction.entry).toBeCloseTo(risk * 2, 10);
    expect(result.direction.rrRatio).toBeGreaterThan(0);
    expect(result.setup?.lastClose).toBe(105);
    expect(result.setup?.basis).toBe("last 5 closes");
    expect(result.strength).toBe("strong");
    expect(result.executionReady).toBe(true);
    expect(result.timeframe).toBe("15m");
  });

  it("SELLs a falling series", async () => {
    stubBridge([bridgeSeries(FALLING)], { bid: 104.9, ask: 105 });

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
    stubBridge([bridgeSeries(RISING)], { bid: 105.1, ask: 105.2 });

    await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    const decisionLines = logs.filter((line) => line.includes("START 15m:"));
    expect(decisionLines).toHaveLength(1);
    expect(decisionLines[0]).toContain("closes 102.5 → 105");
    expect(decisionLines[0]).toContain("net move +2.5");
    expect(decisionLines[0]).toContain("price 105.2");
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
    const captured = stubBridge([bridgeSeries(RISING), bridgeSeries(FALLING)], { bid: 105.1, ask: 105.2 });

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
