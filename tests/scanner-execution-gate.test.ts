import { describe, it, expect, afterEach, vi } from "vitest";
import { analyzeMarket, executionGate, isSymbolSupported } from "../src/lib/market-scanner-core";
import {
  classifyNoTrade,
  executeAutoTrade,
  hasVerifiedMarketData,
  resolveTradeDirection,
} from "../src/lib/auto-trade";
import type { BridgeCredentials } from "../src/lib/auto-trade";

/**
 * WHY THESE TESTS EXIST — "AUTO-TRADING GIVES AN ERROR ON EVERY SYMBOL".
 *
 * The execution path failed at three named points:
 *
 *  1. `fetchBrokerRSI/Momentum/Quote` in auto-trade.ts keyed their fixtures by
 *     EXACT symbol, covering only EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD,
 *     HW_100 and NQ=F. XAUUSD/US30/… answered "Missing or unavailable broker
 *     data" → `analyzeMarket` returned `ok:false` → ChartScanner rendered a
 *     generic ERROR before any order was attempted.
 *  2. `executeAutoTrade` compared the ANALYSIS price against the BROKER'S
 *     live quote in ABSOLUTE terms (0.0005 / 0.05), refusing valid orders as
 *     "Market moved against setup" whenever the two books differed.
 *  3. NO_TRADE verdicts (WEAK/WAIT) surfaced as errors instead of
 *     "NO TRADE (weak setup|no data|stale quote)" with the engine's reason,
 *     and MODERATE-graded plans could not exist for executable setups.
 *
 * These tests pin the fixed behaviour at the level the trader experiences it:
 * the gate verdict, the refusal wording, the error wording, and the direction
 * safety that must survive all of it.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

type Captured = { url: string; body: Record<string, unknown> };

type BridgeScript = {
  quote?: Record<string, unknown>;
  trade?: Record<string, unknown>;
  reject?: Error;
};

/** Stub the bridge: /symbol/price answers with `quote`, /trade/execute with `trade`. */
function stubBridge(script: BridgeScript): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url: target, body });
      if (script.reject) throw script.reject;
      const isQuote = target.endsWith("/symbol/price");
      const payload = isQuote ? (script.quote ?? {}) : (script.trade ?? { retcode: 10009, order: 777 });
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as unknown as Response;
    }),
  );
  return captured;
}

/** Live quotes pinned to the engine's analysed levels for the symbol. */
function pinnedQuote(symbol: string): Record<string, unknown> {
  const fixtures: Record<string, { bid: number; ask: number; digits: number; point: number }> = {
    AUDUSD: { bid: 0.6547, ask: 0.655, digits: 5, point: 0.00001 },
    XAUUSD: { bid: 2649.7, ask: 2650.0, digits: 2, point: 0.01 },
    US30: { bid: 42148.0, ask: 42150.0, digits: 1, point: 0.1 },
  };
  const fixture = fixtures[symbol] ?? fixtures["AUDUSD"]!;
  return { success: true, ...fixture, stops_level: 0 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// 1. MODERATE-or-better + verified data → EXECUTES
// ============================================================================

describe("Execution gate: MODERATE or better on verified data EXECUTES", () => {
  it("XAUUSD — a normal symbol — scans to an executable BUY", async () => {
    const result = await analyzeMarket({ symbol: "XAUUSD", timeframe: "1h" });
    expect(result.ok, "a symbol with verified data must not error").toBe(true);
    const analysis = result.analysis!;
    expect(analysis.signal).toBe("BUY");
    expect(analysis.executionReady).toBe(true);
    expect(["STRONG", "MODERATE"]).toContain(analysis.strength);

    const gate = executionGate(analysis);
    expect(gate.allowed, `gate must allow XAUUSD, got ${gate.headline} — ${gate.reason}`).toBe(true);
  });

  it("a MODERATE setup (trend-driven GBPJPY) EXECUTES — STRONG is not required", async () => {
    const result = await analyzeMarket({ symbol: "GBPJPY", timeframe: "1h" });
    expect(result.ok).toBe(true);
    const analysis = result.analysis!;
    expect(analysis.signal).toBe("BUY");
    expect(analysis.strength).toBe("MODERATE");
    expect(analysis.executionReady).toBe(true);

    const gate = executionGate(analysis);
    expect(gate.allowed, "MODERATE must pass the gate — the design says MODERATE is enough").toBe(true);
    expect(gate.headline).toContain("EXECUTE");
  });

  it("branded broker spellings resolve to their verified symbol (US30Cash → US30)", async () => {
    const result = await analyzeMarket({ symbol: "US30Cash", timeframe: "1h" });
    expect(result.ok, "US30Cash must not error — it resolves to the verified US30 data").toBe(true);
    expect(result.analysis!.signal).toBe("SELL");
    expect(executionGate(result.analysis!).allowed).toBe(true);
  });

  it("the support check is data-driven: XAUUSD/US30 supported, proxies and unknowns not", () => {
    expect(isSymbolSupported("EURUSD").supported).toBe(true);
    expect(isSymbolSupported("XAUUSD").supported, "XAUUSD was the reported broken symbol").toBe(true);
    expect(isSymbolSupported("US30").supported).toBe(true);
    expect(isSymbolSupported("HW_100").supported).toBe(true);
    expect(isSymbolSupported("NQ=F").supported).toBe(false);
    expect(isSymbolSupported("ES=F").supported).toBe(false);
    expect(isSymbolSupported("UNKNOWN_SYMBOL_XYZ").supported).toBe(false);
    expect(hasVerifiedMarketData("XAUUSD")).toBe(true);
    expect(hasVerifiedMarketData("FAKE_SYMBOL")).toBe(false);
  });
});

// ============================================================================
// 2. WEAK / WAIT → NO TRADE with a reason, NOT an error
// ============================================================================

describe("Refusals are NO TRADE verdicts with their reason, never errors", () => {
  it("a symbol with no verified data returns ok:true — NO TRADE (no data), not an error", async () => {
    const result = await analyzeMarket({ symbol: "UNKNOWN_SYMBOL_XYZ", timeframe: "1h" });
    // The OLD behaviour returned { ok:false } here, which the scanner
    // rendered as a red "Configuration / data error" banner.
    expect(result.ok, "a data refusal must not be reported as an application error").toBe(true);
    expect(result.message).toBeUndefined();

    const analysis = result.analysis!;
    expect(analysis.signal).toBe("NO TRADE");
    expect(analysis.strength).toBe("WAIT");
    expect(analysis.executionReady).toBe(false);
    expect(analysis.reasons.join(" ")).toContain("NO TRADE (no data)");

    const gate = executionGate(analysis);
    expect(gate.allowed).toBe(false);
    expect(gate.headline).toBe("NO TRADE (no data)");
    expect(gate.hint).toContain("cannot be verified");
    expect(gate.reason, "the refusal must say WHY").toContain("Missing or unavailable broker data");
  });

  it("a weak setup returns NO TRADE (weak setup) carrying the engine's reason", async () => {
    // GBPUSD's fixture sits mid-range with no confirming structure → neutral.
    const result = await analyzeMarket({ symbol: "GBPUSD", timeframe: "1h" });
    expect(result.ok).toBe(true);

    const analysis = result.analysis!;
    expect(analysis.signal).toBe("NO TRADE");
    expect(analysis.strength).toBe("WEAK");

    const gate = executionGate(analysis);
    expect(gate.allowed).toBe(false);
    expect(gate.headline).toBe("NO TRADE (weak setup)");
    expect(gate.reason).toMatch(/No clear direction|neutral/i);
  });

  it("classifyNoTrade names the cause: weak setup / no data / stale quote", () => {
    expect(classifyNoTrade("Weak bearish signal: RSI=65 requires both indicators to confirm.")).toBe("weak setup");
    expect(classifyNoTrade("No clear direction: RSI=56 (neutral), Momentum=0.06 (neutral).")).toBe("weak setup");
    expect(classifyNoTrade("Conflicting signals: RSI gives both a BUY and a SELL bias.")).toBe("weak setup");
    expect(classifyNoTrade("Missing or unavailable broker data: 15m RSI, live quote.")).toBe("no data");
    expect(classifyNoTrade("Symbol X is a synthetic/proxy ticker. Trading with proxy data is blocked.")).toBe("no data");
    expect(classifyNoTrade("Execution conditions not met: stale quote, excessive spread, or invalid price.")).toBe(
      "stale quote",
    );
  });

  it("direction safety: missing data still refuses — never a default BUY", async () => {
    const result = await resolveTradeDirection("NONEXISTENT");
    expect(result.direction.type).toBe("NO_TRADE");
    expect(result.direction.blocked).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.source).toBe("unavailable");
  });
});

// ============================================================================
// 3. Broken bridge / stale quote → a clear ERROR naming the cause
// ============================================================================

describe("Real failures are ERRORs that name the cause", () => {
  it("an unreachable bridge fails the run with the transport error verbatim", async () => {
    stubBridge({ reject: new Error("connect ETIMEDOUT bridge.internal:8000") });

    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test ea",
      credentials: CREDENTIALS,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status, "a transport failure is an ERROR, not a NO TRADE block").toBe("failed");
    expect(results[0]!.message).toContain("ETIMEDOUT");
    expect(results[0]!.message).toContain("AUDUSD");
  });

  it("a stale quote refused by the bridge fails with the cause in the message", async () => {
    stubBridge({ quote: { success: false, message: "quote is stale for XAUUSD" } });

    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test ea",
      credentials: CREDENTIALS,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.message.toLowerCase()).toContain("stale");
    expect(results[0]!.message).toContain("AUDUSD");
  });

  it("a weak/missing-data symbol is refused as NO TRADE, distinct from an error", async () => {
    const results = await executeAutoTrade({
      symbol: "UNKNOWN_SYMBOL_XYZ",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test ea",
      credentials: CREDENTIALS,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("blocked");
    expect(results[0]!.message).toContain("NO TRADE (no data)");
    // No bridge request was even attempted for an unverifiable symbol.
  });
});

// ============================================================================
// 4. Direction safety + SL/TP sides + the old absolute-drift blocker
// ============================================================================

describe("Direction safety and order shape", () => {
  it("bearish data resolves to SELL and the SELL is what reaches MT5", async () => {
    const analysis = await resolveTradeDirection("US30");
    expect(analysis.direction.type).toBe("SELL");
    expect(analysis.executionReady).toBe(true);

    const scan = await analyzeMarket({ symbol: "US30", timeframe: "1h" });
    expect(scan.analysis!.signal).toBe("SELL");

    const captured = stubBridge({ quote: pinnedQuote("US30") });
    const results = await executeAutoTrade({
      symbol: "US30",
      lotSize: 0.1,
      maxTrades: 1,
      eaName: "bearish bot",
      credentials: CREDENTIALS,
    });

    expect(results[0]!.status).toBe("executed");
    expect(results[0]!.side).toBe("SELL");
    const order = captured.find((request) => request.url.endsWith("/trade/execute"))!;
    expect(order.body["action"], "the detected direction must be what MT5 receives").toBe("SELL");
    // SELL: stop-loss ABOVE the live price, take-profit BELOW it.
    const liveBid = 42148.0;
    expect(Number(order.body["stop_loss"])).toBeGreaterThan(liveBid);
    expect(Number(order.body["take_profit"])).toBeLessThan(liveBid);
  });

  it("bullish data resolves to BUY and the BUY is what reaches MT5", async () => {
    const analysis = await resolveTradeDirection("XAUUSD");
    expect(analysis.direction.type).toBe("BUY");
    expect(analysis.executionReady).toBe(true);

    const captured = stubBridge({ quote: pinnedQuote("XAUUSD") });
    const results = await executeAutoTrade({
      symbol: "XAUUSD",
      lotSize: 0.1,
      maxTrades: 1,
      eaName: "bullish bot",
      credentials: CREDENTIALS,
    });

    expect(results[0]!.status).toBe("executed");
    expect(results[0]!.side).toBe("BUY");
    const order = captured.find((request) => request.url.endsWith("/trade/execute"))!;
    expect(order.body["action"]).toBe("BUY");
    // BUY: stop-loss BELOW the live price, take-profit ABOVE it.
    const liveAsk = 2650.0;
    expect(Number(order.body["stop_loss"])).toBeLessThan(liveAsk);
    expect(Number(order.body["take_profit"])).toBeGreaterThan(liveAsk);
  });

  it("a live quote far from the analysis price still executes (the old absolute-drift blocker)", async () => {
    // The old guard compared the analysis price with the broker quote using an
    // ABSOLUTE tolerance of 0.0005 — a live AUDUSD seven big-hands away was
    // refused as "Market moved against setup" on every attempt.
    stubBridge({ quote: { success: true, bid: 0.7012, ask: 0.7015, digits: 5, point: 0.00001, stops_level: 0 } });

    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test ea",
      credentials: CREDENTIALS,
    });

    expect(results, JSON.stringify(results)).toHaveLength(1);
    expect(
      results[0]!.status,
      `a valid setup with verified data must execute — got: ${results[0]!.message}`,
    ).toBe("executed");
    expect(results[0]!.side).toBe("BUY");
  });
});
