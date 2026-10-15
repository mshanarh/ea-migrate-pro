// ============================================================================
// Market Scanner Core - Symbol Mapping & Broker Data Verification
// ============================================================================
// This module ensures scanner and auto-trading use the SAME verified analysis
// and that broker symbols are never confused with proxy/synthetic tickers.
// ============================================================================

import { resolveTradeDirection, type AnalysisResult, type TradeDecision } from "./auto-trade";

// ============================================================================
// Symbol Mapping Configuration
// ============================================================================

// Public feed tickers (from chart providers, news feeds, etc.) to broker symbols
// ONLY includes mappings to verified broker symbols
export const PUBLIC_FEED_MAPPINGS: Record<string, string> = {
  // NASDAQ -> User's actual broker symbol (NOT NQ=F proxy)
  "NASDAQ": "HW_100",
  "NASDAQ100": "HW_100",
  "US100": "HW_100",
  "NDX": "HW_100",

  // Other mappings would be added for actual broker symbols
  // Example: "EURUSD": "EURUSD" (direct match)
};

// Symbols that are synthetic/proxy and should NEVER be traded directly
export const PROXY_SYMBOLS: Set<string> = new Set([
  "NQ=F",    // NASDAQ futures proxy
  "ES=F",    // S&P 500 futures proxy
  "YM=F",    // Dow futures proxy
  "CL=F",    // Crude oil futures proxy
  "GC=F",    // Gold futures proxy
  "HG=F",    // Copper futures proxy
  "DXY",     // Dollar index (often synthetic)
  "VIX",     // Volatility index (often synthetic)
  "NDX",     // Nasdaq index (requires broker symbol mapping)
  "SPX",     // S&P index (requires broker symbol mapping)
]);

// ============================================================================
// Shared Analysis Cache - ONE result for scanner AND auto-trading
// ============================================================================

const analysisCache = new Map<string, AnalysisResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getSharedAnalysis(symbol: string): AnalysisResult | undefined {
  const cached = analysisCache.get(symbol.toUpperCase().trim());
  if (!cached) return undefined;

  // Check freshness
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    analysisCache.delete(symbol.toUpperCase().trim());
    return undefined;
  }

  return cached;
}

export function setSharedAnalysis(result: AnalysisResult): void {
  const key = result.symbol.toUpperCase().trim();
  analysisCache.set(key, result);
  console.log(`[scanner-core] Shared analysis cached for ${result.symbol}: ${result.direction.type} (${result.strength})`);
}

export function invalidateAnalysis(symbol: string): void {
  analysisCache.delete(symbol.toUpperCase().trim());
  console.log(`[scanner-core] Analysis invalidated for ${symbol}`);
}

// ============================================================================
// Symbol Resolution & Verification
// ============================================================================

export interface SymbolResolution {
  publicTicker: string;
  brokerSymbol: string;
  verified: boolean;
  source: "direct_broker" | "verified_mapping" | "unverified" | "proxy_blocked";
  error?: string;
}

export function resolveSymbol(publicTicker: string, brokerSymbol?: string): SymbolResolution {
  const normalizedPublic = publicTicker.toUpperCase().trim();

  // If no broker symbol provided, treat public ticker as broker symbol
  if (!brokerSymbol) {
    // Check if it's a proxy symbol
    if (PROXY_SYMBOLS.has(normalizedPublic)) {
      return {
        publicTicker: normalizedPublic,
        brokerSymbol: normalizedPublic,
        verified: false,
        source: "proxy_blocked",
        error: `Symbol ${normalizedPublic} is a proxy/synthetic ticker. Trading blocked.`,
      };
    }
    return {
      publicTicker: normalizedPublic,
      brokerSymbol: normalizedPublic,
      verified: true,
      source: "direct_broker",
    };
  }

  const normalizedBroker = brokerSymbol.toUpperCase().trim();

  // Check if broker symbol is a proxy
  if (PROXY_SYMBOLS.has(normalizedBroker)) {
    return {
      publicTicker: normalizedPublic,
      brokerSymbol: normalizedBroker,
      verified: false,
      source: "proxy_blocked",
      error: `Broker symbol ${normalizedBroker} is a proxy/synthetic ticker. Cannot trade. Use actual broker symbol.`,
    };
  }

  // Check if there's a verified mapping
  const mappedBroker = PUBLIC_FEED_MAPPINGS[normalizedPublic];
  if (mappedBroker) {
    if (mappedBroker === normalizedBroker) {
      return {
        publicTicker: normalizedPublic,
        brokerSymbol: normalizedBroker,
        verified: true,
        source: "verified_mapping",
      };
    }
    return {
      publicTicker: normalizedPublic,
      brokerSymbol: normalizedBroker,
      verified: false,
      source: "unverified",
      error: `Mapping mismatch: ${normalizedPublic} maps to ${mappedBroker} but received ${normalizedBroker}`,
    };
  }

  // No mapping - treat as direct if they match
  if (normalizedPublic === normalizedBroker) {
    return {
      publicTicker: normalizedPublic,
      brokerSymbol: normalizedBroker,
      verified: true,
      source: "direct_broker",
    };
  }

  // Unverified mapping
  return {
    publicTicker: normalizedPublic,
    brokerSymbol: normalizedBroker,
    verified: false,
    source: "unverified",
    error: `No verified mapping from ${normalizedPublic} to ${normalizedBroker}. Trading blocked.`,
  };
}

// ============================================================================
// Scanner Analysis - Uses SAME logic as auto-trade
// ============================================================================

export interface ScannerResult {
  symbol: string;
  direction: TradeDecision;
  analysis: AnalysisResult;
  chartRead: "bullish" | "bearish" | "neutral";
  confidence: number; // 0-100
  timestamp: number;
}

export async function analyzeChartForScanner(
  symbol: string,
  options: { requireExecutionReady?: boolean } = {},
): Promise<ScannerResult> {
  const { requireExecutionReady = true } = options;

  console.log(`[scanner-core] Analyzing chart for ${symbol}...`);

  // Use the SAME resolveTradeDirection as auto-trade
  const analysis = await import("./auto-trade").then((mod) =>
    mod.resolveTradeDirection(symbol, { requireExecutionReady, rejectProxyData: true }),
  );

  // Cache the result for auto-trading to use
  setSharedAnalysis(analysis);

  // Determine chart read based on direction
  let chartRead: "bullish" | "bearish" | "neutral";
  if (analysis.direction.type === "BUY") {
    chartRead = "bullish";
  } else if (analysis.direction.type === "SELL") {
    chartRead = "bearish";
  } else {
    chartRead = "neutral";
  }

  // Calculate confidence score
  let confidence = 0;
  if (analysis.strength === "strong") {
    confidence = 80;
  } else if (analysis.strength === "weak") {
    confidence = 40;
  }

  // Adjust based on RSI position
  if (analysis.rsi15m !== null && analysis.rsi1h !== null) {
    const avgRSI = (analysis.rsi15m + analysis.rsi1h) / 2;
    if (analysis.direction.type === "BUY" && avgRSI < 40) {
      confidence = Math.max(confidence, 75);
    } else if (analysis.direction.type === "SELL" && avgRSI > 60) {
      confidence = Math.max(confidence, 75);
    }
  }

  console.log(`[scanner-core] ${symbol}: ${chartRead} (${confidence}%), ${analysis.direction.type}`);

  return {
    symbol,
    direction: analysis.direction,
    analysis,
    chartRead,
    confidence,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function isSymbolSupported(symbol: string): { supported: boolean; error?: string } {
  const normalized = symbol.toUpperCase().trim();

  // Check if it's a proxy symbol
  if (PROXY_SYMBOLS.has(normalized)) {
    return {
      supported: false,
      error: `${normalized} is a proxy/synthetic symbol. Use actual broker symbol.`,
    };
  }

  // Check if we have broker data for it
  // In production, this would check against MT5 symbol list
  const knownBrokerSymbols = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "HW_100"];
  if (!knownBrokerSymbols.includes(normalized)) {
    return {
      supported: false,
      error: `Symbol ${normalized} not found in broker symbol list.`,
    };
  }

  return { supported: true };
}

export function validateAnalysisForExecution(analysis: AnalysisResult): {
  valid: boolean;
  reason?: string;
} {
  if (analysis.direction.type === "NO_TRADE") {
    return { valid: false, reason: analysis.direction.reason };
  }

  if (!analysis.executionReady) {
    return { valid: false, reason: "Analysis not execution-ready" };
  }

  if (analysis.strength !== "strong") {
    return { valid: false, reason: `Analysis strength is ${analysis.strength}, requires strong` };
  }

  if (analysis.source !== "mt5_broker") {
    return {
      valid: false,
      reason: `Data source is ${analysis.source}, requires mt5_broker`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Scanner Integration - analyzeMarket for ChartScanner component
// ============================================================================

export interface ScannerAnalysis {
  symbol: string;
  signal: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  confidence: number;
  strength: "WAIT" | "WEAK" | "MODERATE" | "STRONG";
  executionReady: boolean;
  dataSource: string;
  livePrice: number;
  lastCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
  } | null;
  candleCount: number;
  timeframe: string;
  readouts: Array<{ label: string; value: string; bullish?: boolean | null }>;
  reasons: string[];
  dataStatus: "ok" | "no-data";
}

export interface AnalyzeMarketRequest {
  symbol: string;
  timeframe: string;
}

export interface AnalyzeMarketResult {
  ok: boolean;
  analysis?: ScannerAnalysis;
  message?: string;
}

/**
 * Analyze market for scanner - uses the same safety logic as auto-trade
 * but returns the scanner-specific format expected by ChartScanner component
 */
export async function analyzeMarket(request: AnalyzeMarketRequest): Promise<AnalyzeMarketResult> {
  const { symbol, timeframe } = request;

  try {
    // Use the same resolveTradeDirection as auto-trade for consistency
    const analysis = await resolveTradeDirection(symbol, {
      requireExecutionReady: true,
      rejectProxyData: true,
    });

    if (analysis.direction.type === "NO_TRADE") {
      return {
        ok: false,
        message: analysis.direction.reason,
      };
    }

    const direction = analysis.direction as { type: "BUY" | "SELL"; entry: number; sl: number; tp: number };

    // Build scanner-specific analysis
    const scannerAnalysis: ScannerAnalysis = {
      symbol: analysis.symbol,
      signal: direction.type,
      entry: direction.entry,
      stopLoss: direction.sl,
      takeProfit: direction.tp,
      riskReward: "1:2",
      confidence: analysis.strength === "strong" ? 80 : 40,
      strength: analysis.strength === "strong" ? "STRONG" : analysis.strength === "weak" ? "WEAK" : "MODERATE",
      executionReady: analysis.executionReady,
      dataSource: analysis.source === "mt5_broker" ? "MT5 Broker" : "Estimated",
      livePrice: direction.type === "BUY" ? direction.entry : direction.entry,
      lastCandle: null,
      candleCount: 0,
      timeframe: "1h",
      readouts: [
        { label: "RSI 15m", value: analysis.rsi15m?.toFixed(1) ?? "—" },
        { label: "RSI 1h", value: analysis.rsi1h?.toFixed(1) ?? "—" },
        { label: "Momentum 15m", value: analysis.momentum15m?.toFixed(2) ?? "—" },
        { label: "Momentum 1h", value: analysis.momentum1h?.toFixed(2) ?? "—" },
      ],
      reasons: [analysis.reason],
      dataStatus: "ok",
    };

    return {
      ok: true,
      analysis: scannerAnalysis,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Analysis failed",
    };
  }
}
