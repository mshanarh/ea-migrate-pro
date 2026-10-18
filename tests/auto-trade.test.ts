import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveTradeDirection,
  executeAutoTrade,
  safeTradeCount,
  preserveEaName,
  validateCommentPreservation,
  type AnalysisResult,
} from "../src/lib/auto-trade";
import {
  resolveSymbol,
  validateAnalysisForExecution,
  getSharedAnalysis,
  isSymbolSupported,
  setSharedAnalysis,
} from "../src/lib/market-scanner-core";

// Helper functions
function assertNoTrade(result: AnalysisResult) {
  expect(result.direction.type).toBe("NO_TRADE");
  expect(result.direction.blocked).toBe(true);
  expect(result.executionReady).toBe(false);
}

function assertTrade(result: AnalysisResult, expectedType: "BUY" | "SELL") {
  expect(result.direction.type).toBe(expectedType);
  const blocked = (result.direction as any).blocked;
  if (blocked !== undefined) {
    expect(blocked).toBeUndefined();
  }
  expect(result.executionReady).toBe(true);
  expect(result.strength).toBe("strong");
}

// ============================================================================
// Tests: Analysis Timeout & Missing Data
// ============================================================================

describe("Auto-Trade Safety: Analysis Timeout & Missing Data", () => {
  it("should return NO_TRADE when RSI data is unavailable", async () => {
    const result = await resolveTradeDirection("UNKNOWN_SYMBOL_XYZ");
    assertNoTrade(result);
    expect(result.reason).toContain("Missing or unavailable broker data");
  });

  it("should return NO_TRADE when momentum data is missing", async () => {
    const result = await resolveTradeDirection("UNKNOWN_SYMBOL_XYZ");
    assertNoTrade(result);
    expect(result.reason).toContain("Missing or unavailable broker data");
  });

  it("should return NO_TRADE when live quote is unavailable", async () => {
    const result = await resolveTradeDirection("UNKNOWN_SYMBOL_XYZ");
    assertNoTrade(result);
  });

  it("should block when ANY required data is missing", async () => {
    const result = await resolveTradeDirection("NONEXISTENT");
    expect(result.direction.type).toBe("NO_TRADE");
    expect(result.source).toBe("unavailable");
  });
});

// ============================================================================
// Tests: Unsupported & Stale Data
// ============================================================================

describe("Auto-Trade Safety: Unsupported & Stale Data", () => {
  it("should block unsupported symbols", async () => {
    const result = await resolveTradeDirection("FAKE_SYMBOL");
    assertNoTrade(result);
    expect(result.reason).toContain("Missing or unavailable broker data");
  });

  it("should return valid analysis for supported symbols", async () => {
    const result = await resolveTradeDirection("EURUSD");
    expect(result.direction.type).toBe("BUY");
    expect(result.strength).toBe("strong");
  });
});

// ============================================================================
// Tests: Synthetic & Proxy Symbols
// ============================================================================

describe("Auto-Trade Safety: Synthetic & Proxy Symbols", () => {
  it("should block NQ=F (NASDAQ futures proxy)", async () => {
    const result = await resolveTradeDirection("NQ=F");
    assertNoTrade(result);
    // NQ=F is both in PROXY_SYMBOLS and has data, so source should be proxy
    expect(["proxy", "unavailable"]).toContain(result.source);
    expect(result.reason).toContain("synthetic/proxy ticker");
  });

  it("should block other proxy symbols (ES=F, DXY, VIX)", async () => {
    // These symbols have no broker data, so they'll be blocked as unavailable
    // But the key is they never produce a BUY/SELL
    const proxySymbols = ["ES=F", "DXY", "VIX"];
    for (const symbol of proxySymbols) {
      const result = await resolveTradeDirection(symbol);
      expect(result.direction.type).toBe("NO_TRADE");
      // Should never be BUY or SELL
      expect(["BUY", "SELL"]).not.toContain(result.direction.type);
    }
  });

  it("should block SYNTHETIC_PROXY_SYMBOLS via symbol resolution", () => {
    const resolution = resolveSymbol("NQ=F");
    expect(resolution.verified).toBe(false);
    expect(resolution.source).toBe("proxy_blocked");
  });
});

// ============================================================================
// Tests: weak/neutral signals now EXECUTE — FORCE_WEAK_EXECUTION
// ============================================================================

describe("Weak signals execute (FORCE_WEAK_EXECUTION)", () => {
  it("a one-indicator signal resolves to a direction, never NO_TRADE", async () => {
    const result = await resolveTradeDirection("USDCAD");
    expect(["BUY", "SELL"]).toContain(result.direction.type);
    // Confirmed fixtures stay strong; forced ones declare the force in-line.
    expect(["strong", "weak"]).toContain(result.strength);
    if (result.strength === "weak") expect(result.reason).toContain("FORCE_WEAK_EXECUTION");
  });

  it("every supported weak/neutral fixture produces a direction", async () => {
    const symbols = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"];
    for (const symbol of symbols) {
      const result = await resolveTradeDirection(symbol);
      expect(["BUY", "SELL"], `${symbol} must resolve to a direction`).toContain(result.direction.type);
      if (result.strength === "weak") {
        expect(result.reason, `${symbol} forced plan must declare the force`).toContain(
          "FORCE_WEAK_EXECUTION",
        );
      }
    }
  });
});

// ============================================================================
// Tests: Bearish Data with BOTH Mode (HW_100 Regression)
// ============================================================================

describe("Auto-Trade Safety: Bearish Data with BOTH Mode", () => {
  it("should SELL when data is bearish (HW_100 scenario)", async () => {
    const result = await resolveTradeDirection("HW_100");
    assertTrade(result, "SELL");
    expect(result.reason).toContain("Strong bearish confirmation");
    expect(result.rsi15m).toBe(68);
    expect(result.rsi1h).toBe(72);
    expect(result.momentum15m).toBe(-0.12);
    expect(result.momentum1h).toBe(-0.18);
  });

  it("HW_100 REGRESSION: should NEVER produce BUY from bearish verified broker data", async () => {
    const result = await resolveTradeDirection("HW_100");
    expect(result.direction.type).not.toBe("BUY");
    expect(result.direction.type).toBe("SELL");
    expect(result.source).toBe("mt5_broker");
    expect(result.executionReady).toBe(true);
  });

  it("weak bearish data executes as a forced SELL (FORCE_WEAK_EXECUTION)", async () => {
    // This fixture actually carries momentum confirmation, so it lands on the
    // STRONG SELL path — either way bearish data must resolve SELL, never BUY.
    const result = await resolveTradeDirection("USDJPY");
    expect(result.direction.type).toBe("SELL");
    expect(["strong", "weak"]).toContain(result.strength);
    if (result.strength === "weak") expect(result.reason).toContain("FORCE_WEAK_EXECUTION");
  });
});

// ============================================================================
// Tests: Bullish Data with BOTH Mode
// ============================================================================

describe("Auto-Trade Safety: Bullish Data with BOTH Mode", () => {
  it("should BUY when both RSI and momentum confirm bullish", async () => {
    const result = await resolveTradeDirection("AUDUSD");
    assertTrade(result, "BUY");
    expect(result.reason).toContain("Strong bullish confirmation");
  });

  it("weak bullish data still resolves to a direction (FORCE_WEAK_EXECUTION)", async () => {
    const result = await resolveTradeDirection("GBPUSD");
    expect(result.direction.type).toBe("BUY");
    expect(result.strength).toBe("weak");
    expect(result.reason).toContain("FORCE_WEAK_EXECUTION");
  });

  it("STRONG trades keep the RSI+momentum bar; forced trades declare the force", async () => {
    const symbols = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "HW_100"];
    for (const symbol of symbols) {
      const result = await resolveTradeDirection(symbol);
      if (result.direction.type === "NO_TRADE") continue; // safety blocks only
      if (result.strength !== "strong") {
        // A forced plan trades BELOW the old confirmation bar on purpose —
        // accuracy is no longer the blocker (FORCE_WEAK_EXECUTION).
        expect(result.reason, `${symbol} weak plan must declare the force`).toContain(
          "FORCE_WEAK_EXECUTION",
        );
        continue;
      }
      const avgRSI = ((result.rsi15m || 50) + (result.rsi1h || 50)) / 2;
      const avgMomentum = ((result.momentum15m || 0) + (result.momentum1h || 0)) / 2;

      if (result.direction.type === "BUY") {
        expect(avgRSI).toBeLessThan(45);
        expect(avgMomentum).toBeGreaterThan(0.05);
      } else if (result.direction.type === "SELL") {
        expect(avgRSI).toBeGreaterThan(55);
        expect(avgMomentum).toBeLessThan(-0.05);
      }
    }
  });
});

// ============================================================================
// Tests: Explicitly Selected Directions
// ============================================================================

describe("Auto-Trade Safety: Explicitly Selected Directions", () => {
  it("should respect strong BUY signal when explicitly confirmed", async () => {
    const result = await resolveTradeDirection("AUDUSD");
    expect(result.direction.type).toBe("BUY");
    expect(result.executionReady).toBe(true);
  });

  it("should respect strong SELL signal when explicitly confirmed", async () => {
    const result = await resolveTradeDirection("HW_100");
    expect(result.direction.type).toBe("SELL");
    expect(result.executionReady).toBe(true);
  });

  it("should block when there's no clear direction", async () => {
    const result = await resolveTradeDirection("NONEXISTENT_SYMBOL");
    expect(result.direction.type).toBe("NO_TRADE");
    expect(result.executionReady).toBe(false);
  });
});

// ============================================================================
// Tests: Symbol Suffixes & Prefixes
// ============================================================================

describe("Auto-Trade Safety: Symbol Suffixes & Prefixes", () => {
  it("should handle symbols with suffixes correctly", async () => {
    const result = await resolveTradeDirection("EURUSD.pro");
    expect(["BUY", "SELL", "NO_TRADE"]).toContain(result.direction.type);
  });

  it("should normalize symbol casing", async () => {
    const upper = await resolveTradeDirection("EURUSD");
    const lower = await resolveTradeDirection("eurusd");
    const mixed = await resolveTradeDirection("EuRuSd");

    expect(upper.direction.type).toBe(mixed.direction.type);
    expect(lower.direction.type).toBe(mixed.direction.type);
  });

  it("should handle symbol with whitespace", async () => {
    const trimmed = await resolveTradeDirection("  EURUSD  ");
    const normal = await resolveTradeDirection("EURUSD");
    expect(trimmed.direction.type).toBe(normal.direction.type);
  });
});

// ============================================================================
// Tests: Order Stop Direction Validations
// ============================================================================

describe("Auto-Trade Safety: Order Stop Direction Validations", () => {
  it("should validate SL/TP for BUY orders (SL < entry, TP > entry)", async () => {
    const result = await resolveTradeDirection("AUDUSD");
    if (result.direction.type === "BUY") {
      const d = result.direction as any;
      expect(d.sl).toBeLessThan(d.entry);
      expect(d.tp).toBeGreaterThan(d.entry);
    }
  });

  it("should validate SL/TP for SELL orders (SL > entry, TP < entry)", async () => {
    const result = await resolveTradeDirection("HW_100");
    if (result.direction.type === "SELL") {
      const d = result.direction as any;
      expect(d.sl).toBeGreaterThan(d.entry);
      expect(d.tp).toBeLessThan(d.entry);
    }
  });

  it("should calculate approximately 1:2 risk/reward ratio for BUY", async () => {
    const result = await resolveTradeDirection("AUDUSD");
    if (result.direction.type === "BUY") {
      const d = result.direction as any;
      const risk = d.entry - d.sl;
      const reward = d.tp - d.entry;
      expect(d.rrRatio).toBe(2);
      // Allow for floating point variance - should be close to 2:1
      const ratio = reward / risk;
      expect(ratio).toBeGreaterThanOrEqual(1.8);
      expect(ratio).toBeLessThanOrEqual(2.2);
    }
  });

  it("should calculate approximately 1:2 risk/reward ratio for SELL", async () => {
    const result = await resolveTradeDirection("HW_100");
    if (result.direction.type === "SELL") {
      const d = result.direction as any;
      const risk = d.sl - d.entry;
      const reward = d.entry - d.tp;
      expect(d.rrRatio).toBe(2);
      const ratio = reward / risk;
      expect(ratio).toBeGreaterThanOrEqual(1.8);
      expect(ratio).toBeLessThanOrEqual(2.2);
    }
  });
});

// ============================================================================
// Tests: EA Name Preservation (sniper killer ea v2+)
// ============================================================================

describe("Trade Comment Preservation", () => {
  it("should preserve exact EA name including spaces", () => {
    const original = "sniper killer ea v2+";
    const preserved = preserveEaName(original);
    expect(preserved).toBe(original);
  });

  it("should preserve plus signs in EA name", () => {
    const original = "sniper killer ea v2+";
    const preserved = preserveEaName(original);
    expect(preserved).toContain("+");
    expect(preserved).toBe(original);
  });

  it("should preserve special characters", () => {
    const names = [
      "sniper killer ea v2+",
      "EA Cloud Pro v3.0",
      "robot+magic v2",
      "test ea (ver 1)",
    ];
    for (const name of names) {
      const preserved = preserveEaName(name);
      expect(preserved).toBe(name);
    }
  });

  it("should validate comment preservation returns correct result", () => {
    const requested = "sniper killer ea v2+";
    const actual = "sniper killer ea v2+";

    const result = validateCommentPreservation(requested, actual);
    expect(result.preserved).toBe(true);
    expect(result.mismatch).toBeUndefined();
  });

  it("should detect comment mismatch", () => {
    const requested = "sniper killer ea v2+";
    const actual = "sniper killer ea v2";

    const result = validateCommentPreservation(requested, actual);
    expect(result.preserved).toBe(false);
    expect(result.mismatch).toContain("requested");
    expect(result.mismatch).toContain("actual");
  });

  it("should detect missing actual comment", () => {
    const requested = "sniper killer ea v2+";

    const result = validateCommentPreservation(requested, undefined);
    expect(result.preserved).toBe(false);
    expect(result.mismatch).toContain("No actual comment");
  });

  it("should pass exact comment through execution", async () => {
    const eaName = "sniper killer ea v2+";
    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName,
      paperTrading: true,
    });

    const executedTrade = results.find((r) => r.status === "executed");
    expect(executedTrade).toBeDefined();
    if (executedTrade) {
      expect(executedTrade.meta?.requestedComment).toBe(eaName);
      expect(executedTrade.meta?.actualComment).toBe(eaName);
    }
  });
});

// ============================================================================
// Tests: executeAutoTrade Function
// ============================================================================

describe("executeAutoTrade", () => {
  it("should execute trades with correct spacing", async () => {
    const startTime = Date.now();
    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 2,
      eaName: "test ea",
      paperTrading: true,
    });

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(2000);

    expect(results.length).toBe(2);
    expect(results[0].status).toBe("executed");
    expect(results[1].status).toBe("executed");
  });

  it("should emit execution-result events with TRADE EXECUTED", async () => {
    const events: { event: string; data: any }[] = [];
    const results = await executeAutoTrade({
      symbol: "EURUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test",
      emitEvent: (event, data) => {
        events.push({ event, data });
      },
      paperTrading: true,
    });

    expect(events.length).toBeGreaterThan(0);
    // Check that the event data contains "EXECUTED"
    expect(events[0].data.event).toContain("EXECUTED");
  });

  it("should call onTradeExecute callback", async () => {
    const callbacks: number[] = [];
    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test",
      onTradeExecute: (_trade, index) => {
        callbacks.push(index);
      },
      paperTrading: true,
    });

    expect(callbacks.length).toBe(1);
    expect(callbacks[0]).toBe(1);
  });

  it("should stop on first failed trade", async () => {
    const results = await executeAutoTrade({
      symbol: "INVALID_SYMBOL",
      lotSize: 0.01,
      maxTrades: 5,
      eaName: "test",
      paperTrading: true,
    });

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("blocked");
  });

  it("should use paperTrading mode when specified", async () => {
    const results = await executeAutoTrade({
      symbol: "AUDUSD",
      lotSize: 0.01,
      maxTrades: 1,
      eaName: "test",
      paperTrading: true,
    });

    const executed = results.find((r) => r.status === "executed");
    expect(executed?.meta?.mtOrderId).toContain("PAPER");
  });
});

// ============================================================================
// Tests: safeTradeCount Helper
// ============================================================================

describe("safeTradeCount", () => {
  it("should parse number input", () => {
    expect(safeTradeCount(5)).toBe(5);
    expect(safeTradeCount(0)).toBe(0);
    expect(safeTradeCount(-1)).toBe(0);
    expect(safeTradeCount(3.7)).toBe(3);
  });

  it("should parse string input", () => {
    expect(safeTradeCount("5")).toBe(5);
    expect(safeTradeCount("0")).toBe(0);
    expect(safeTradeCount("abc")).toBe(0);
    expect(safeTradeCount("")).toBe(0);
  });

  it("should handle null/undefined", () => {
    expect(safeTradeCount(null)).toBe(0);
    expect(safeTradeCount(undefined)).toBe(0);
  });
});

// ============================================================================
// Tests: Market Scanner Core - Symbol Mapping
// ============================================================================

describe("Market Scanner Core: Symbol Mapping", () => {
  it("should verify direct broker symbols", () => {
    const result = resolveSymbol("EURUSD");
    expect(result.verified).toBe(true);
    expect(result.source).toBe("direct_broker");
  });

  it("should verify mapped symbols (NASDAQ -> HW_100)", () => {
    const result = resolveSymbol("NASDAQ", "HW_100");
    expect(result.verified).toBe(true);
    expect(result.source).toBe("verified_mapping");
  });

  it("should block unverified mappings", () => {
    const result = resolveSymbol("NASDAQ", "NQ=F");
    expect(result.verified).toBe(false);
    expect(result.source).toBe("proxy_blocked");
  });

  it("should block proxy symbols without mapping", () => {
    const result = resolveSymbol("NQ=F");
    expect(result.verified).toBe(false);
    expect(result.source).toBe("proxy_blocked");
  });

  it("should check symbol support", () => {
    expect(isSymbolSupported("EURUSD").supported).toBe(true);
    expect(isSymbolSupported("HW_100").supported).toBe(true);
    expect(isSymbolSupported("NQ=F").supported).toBe(false);
    expect(isSymbolSupported("ES=F").supported).toBe(false);
  });
});

// ============================================================================
// Tests: Shared Analysis Cache
// ============================================================================

describe("Market Scanner Core: Shared Analysis", () => {
  it("should cache analysis for shared use", () => {
    const mockAnalysis: AnalysisResult = {
      symbol: "TEST",
      direction: { type: "BUY", entry: 1.0, sl: 0.99, tp: 1.02, rrRatio: 2, reason: "test" },
      rsi15m: 35,
      rsi1h: 38,
      momentum15m: 0.2,
      momentum1h: 0.25,
      source: "mt5_broker",
      timeframe: "1h",
      candleTimestamp: Date.now(),
      strength: "strong",
      executionReady: true,
      reason: "test",
      timestamp: Date.now(),
    };

    setSharedAnalysis(mockAnalysis);

    const cached = getSharedAnalysis("TEST");
    expect(cached).toBeDefined();
    expect(cached?.direction.type).toBe("BUY");
  });

  it("should invalidate stale cache", () => {
    const result = getSharedAnalysis("NONEXISTENT");
    expect(result).toBeUndefined();
  });

  it("should validate analysis for execution", () => {
    const validAnalysis: AnalysisResult = {
      symbol: "EURUSD",
      direction: { type: "BUY", entry: 1.0, sl: 0.99, tp: 1.02, rrRatio: 2, reason: "test" },
      rsi15m: 35,
      rsi1h: 38,
      momentum15m: 0.2,
      momentum1h: 0.25,
      source: "mt5_broker",
      timeframe: "1h",
      candleTimestamp: Date.now(),
      strength: "strong",
      executionReady: true,
      reason: "test",
      timestamp: Date.now(),
    };

    const validation = validateAnalysisForExecution(validAnalysis);
    expect(validation.valid).toBe(true);

    // FORCE_WEAK_EXECUTION: a weak-but-Directional plan is executable — the
    // strength check that used to refuse it below MODERATE is gone.
    const weakAnalysis: AnalysisResult = {
      ...validAnalysis,
      strength: "weak",
    };
    expect(validateAnalysisForExecution(weakAnalysis).valid).toBe(true);

    // The genuine order-breakers still refuse, unchanged.
    const refused: AnalysisResult = {
      ...validAnalysis,
      direction: { type: "NO_TRADE", reason: "Missing or unavailable broker data", blocked: true },
    };
    expect(validateAnalysisForExecution(refused).valid).toBe(false);
    const stale: AnalysisResult = { ...validAnalysis, executionReady: false };
    expect(validateAnalysisForExecution(stale).valid).toBe(false);
    const proxy: AnalysisResult = { ...validAnalysis, source: "proxy" };
    expect(validateAnalysisForExecution(proxy).valid).toBe(false);
  });
});
