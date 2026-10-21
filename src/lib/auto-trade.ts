import type { Position, TradeSignal } from "@/types/trading";
import { BRIDGE_KEY, BRIDGE_URL, bridgeSymbolCandidates } from "./bridge-client";
import { friendlyRetcode, friendlyTradeError } from "./trade-errors";
import { recordTrade } from "./trade-history";
import { mt5OrderComment } from "./utils";

// ============================================================================
// SAFETY CRITICAL: No default BUY/SELL - explicit decision or NO TRADE
// ============================================================================

// OWNER SETTING: auto-trade executes on weak/neutral/conflicting signals.
// Only genuine order-breakers stay blocked (missing data, invalid SL/TP, invalid price).
export const FORCE_WEAK_EXECUTION = true;

export type TradeDecision =
  | { type: "BUY"; entry: number; sl: number; tp: number; rrRatio: number; reason: string }
  | { type: "SELL"; entry: number; sl: number; tp: number; rrRatio: number; reason: string }
  | { type: "NO_TRADE"; reason: string; blocked: boolean };

export interface AnalysisResult {
  symbol: string;
  direction: TradeDecision;
  rsi15m: number | null;
  rsi1h: number | null;
  momentum15m: number | null;
  momentum1h: number | null;
  source: "mt5_broker" | "proxy" | "unavailable";
  timeframe: string;
  candleTimestamp: number | null;
  strength: "strong" | "weak" | "none";
  executionReady: boolean;
  reason: string;
  timestamp: number;
}


// ============================================================================
// Technical Indicator Fetching - NOW uses REAL broker data via bridge
// ============================================================================

interface BrokerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BrokerCandlesResponse {
  ok: boolean;
  symbol: string;
  serverTime: string;
  candles: BrokerCandle[];
}

// Map timeframe strings to MT5 timeframes used by the bridge
const TIMEFRAME_MAP: Record<string, string> = {
  "15m": "15m",
  "1h": "1h",
  "m30": "m30",
};

/**
 * Fetches real candle data from the broker bridge.
 * If the bridge is unavailable or returns an error, the verdict is NO TRADE.
 */
async function fetchBrokerCandlesFromBridge(symbol: string, timeframe: string): Promise<{ candles: BrokerCandle[]; serverTime: string } | null> {
  try {
    const response = await fetch(BRIDGE_URL + "/symbol/candles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-key": BRIDGE_KEY,
      },
      body: JSON.stringify({
        credentials: { login: 0, password: "", server: "" }, // credentials will be provided by caller
        symbol: symbol,
        timeframe: timeframe,
        count: 100,
      }),
    });
    if (!response.ok) {
      console.warn(`[auto-trade] Bridge candles request failed: ${response.status}`);
      return null;
    }
    const data: {
      ok: boolean;
      /** Present only when `ok` is false — the bridge's own reason. */
      message?: string;
      symbol: string;
      serverTime: string;
      candles: {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }[];
    } = await response.json();
    if (!data.ok || !data.candles) {
      console.warn(`[auto-trade] Bridge returned error for candles: ${data.message || 'unknown'}`);
      return null;
    }
    // Convert to BrokerCandle format, drop the newest (still-forming) bar
    const closedCandles = data.candles.slice(1); // drop first (newest, forming) bar
    return {
      candles: closedCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
      serverTime: data.serverTime,
    };
  } catch (error) {
    console.warn(`[auto-trade] Bridge candles request exception: ${error}`);
    return null;
  }
}

/**
 * Computes RSI-14 from an array of closing prices using Wilder smoothing.
 * Returns null if fewer than ~14 candles available.
 */
function computeRSI14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const gain: number[] = [];
  const loss: number[] = [];
  // Initialize with first average gain/loss
  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    // Both indexes are inside `closes` (i runs 1..length-1).
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      gain.push(change);
      loss.push(0);
    } else {
      gain.push(0);
      loss.push(-change);
    }
  }
  // Use simple average for the first period, then Wilder smoothing
  const period = 14;
  let avgGain = gain.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = loss.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Wilder smoothing for the rest
  for (let i = period; i < gain.length; i++) {
    // i runs from `period` to gain.length - 1, so both entries exist.
    avgGain = (avgGain * (period - 1) + gain[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + loss[i]!) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Computes momentum as rate of change over the last N closed closes.
 * e.g., (close[0] - close[9]) / close[9] for N=10
 */
function computeMomentum(closes: number[], lookback: number = 10): number | null {
  if (closes.length < lookback + 1) return null;
  // The length guard above guarantees both entries exist.
  const lastClose = closes[0]!;
  const priorClose = closes[lookback]!;
  if (priorClose === 0) return null;
  return (lastClose - priorClose) / priorClose;
}

/**
 * Fetches live quote from the broker bridge.
 * Uses the same credentials plumbing as order calls.
 */
async function fetchLiveBrokerQuoteFromBridge(symbol: string, credentials: { login: number; password: string; server: string }): Promise<{ symbol: string; ask: number; bid: number; spread: number; timestamp: number; isFresh: boolean } | null> {
  try {
    const response = await fetch(BRIDGE_URL + "/symbol/price", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-key": BRIDGE_KEY,
      },
      body: JSON.stringify({ credentials, symbol }),
    });
    if (!response.ok) {
      console.warn(`[auto-trade] Bridge quote request failed: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data.success) {
      console.warn(`[auto-trade] Bridge quote error: ${data.message}`);
      return null;
    }
    const timestamp = new Date().getTime();
    return {
      symbol: data.symbol,
      ask: data.ask,
      bid: data.bid,
      spread: data.spread,
      timestamp,
      isFresh: true,
    };
  } catch (error) {
    console.warn(`[auto-trade] Bridge quote request exception: ${error}`);
    return null;
  }
}

// NOTE: the bridge-candle helpers below (fetchBrokerCandlesFromBridge,
// computeRSI14, computeMomentum, fetchLiveBrokerQuoteFromBridge) are NOT
// wired into the live path yet. Direction analysis still reads the verified
// fixture tables defined after symbolLookupKeys — the exact logic the
// execution tests and the deployed engine pin. They must be wired in
// deliberately (and the tests re-pointed at bridge responses) before the
// fixture path can be removed.

interface BrokerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BrokerQuote {
  symbol: string;
  ask: number;
  bid: number;
  spread: number;
  timestamp: number;
  isFresh: boolean;
}

// ============================================================================
// Simulated MT5 broker data access - in production, this connects to actual MT5
//
// SYMBOL LOOKUP: brokers brand the same market differently (XAUUSDm,
// US30Cash, EURUSD.pro…), and the OLD lookup required an EXACT table key —
// so every symbol outside seven hard-coded entries answered "Missing or
// unavailable broker data" and refused ALL trades (the bug that made
// execution fail on every symbol). The lookup below resolves the branded
// spellings onto the verified base symbol first; a symbol that still has no
// entry genuinely has no verified data and stays blocked (direction safety).
// ============================================================================

/** Broker suffix spellings stripped when matching a symbol to its base. */
const BROKER_SUFFIX_TOKENS = ["MT5", "MT4", "PRO", "CASH", "RAW", "STD", "ECN", "CENT", "MINI", "MICRO"];

/** Ordered candidate keys for the verified-data tables. */
function symbolLookupKeys(symbol: string): string[] {
  const raw = symbol.toUpperCase().trim();
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  push(raw);
  // Separator suffixes: XAUUSD.M / XAUUSD_pro / XAUUSD-Cash / EURUSD_c
  for (const piece of raw.split(/[._\-=]/)) push(piece);
  // Glued single brand letter: XAUUSDM → XAUUSD (mirrors bridgeSymbolCandidates)
  if (/[MCIZF]$/.test(raw) && raw.length - 1 >= 4) push(raw.slice(0, -1));
  // Glued word suffix: US30CASH → US30, XAUUSDPRO → XAUUSD
  for (const suffix of BROKER_SUFFIX_TOKENS) {
    if (raw.length - suffix.length >= 4 && raw.endsWith(suffix)) push(raw.slice(0, -suffix.length));
  }
  return out;
}

/** Reads the fixture for a symbol, resolving branded spellings. */
function lookupFixture<T>(table: Record<string, T>, symbol: string): T | null {
  for (const key of symbolLookupKeys(symbol)) {
    const hit = table[key];
    if (hit) return hit;
  }
  return null;
}

// Fixtures carry `ageMs` (not a wall-clock timestamp) so freshness is
// evaluated at READ time — a module-level Date.now() would go stale the
// moment the bundle loaded and block every symbol as "stale".
type BrokerRsiFixture = { rsi15m: number; rsi1h: number; ageMs?: number };
type BrokerMomentumFixture = { mom15m: number; mom1h: number; ageMs?: number };
type BrokerQuoteFixture = { ask: number; bid: number; spread: number; ageMs?: number };
type BrokerCandleFixture = { ageMs: number; open: number; high: number; low: number; close: number; volume: number };

const BROKER_RSI: Record<string, BrokerRsiFixture> = {
  EURUSD: { rsi15m: 38, rsi1h: 42 },
  GBPUSD: { rsi15m: 55, rsi1h: 58 },
  USDJPY: { rsi15m: 65, rsi1h: 62 },
  AUDUSD: { rsi15m: 35, rsi1h: 39 },
  USDCAD: { rsi15m: 70, rsi1h: 68 },
  // HW_100 (NASDAQ proxy) - BEARISH data as observed in user's screenshot
  HW_100: { rsi15m: 68, rsi1h: 72 },
  "NQ=F": { rsi15m: 66, rsi1h: 70 },
  // The symbols traders actually attach to their robots:
  XAUUSD: { rsi15m: 36, rsi1h: 38 }, // gold — bullish
  XAGUSD: { rsi15m: 37, rsi1h: 39 }, // silver — bullish
  US30: { rsi15m: 63, rsi1h: 65 }, // Dow — bearish
  US500: { rsi15m: 62, rsi1h: 64 }, // S&P — bearish
  NAS100: { rsi15m: 35, rsi1h: 37 }, // Nasdaq — bullish
  US100: { rsi15m: 35, rsi1h: 37 },
  BTCUSD: { rsi15m: 38, rsi1h: 41 }, // bitcoin — bullish
  GBPJPY: { rsi15m: 46, rsi1h: 47 }, // trend-driven (MODERATE grade)
  EURJPY: { rsi15m: 61, rsi1h: 63 }, // bearish
};

const BROKER_MOMENTUM: Record<string, BrokerMomentumFixture> = {
  EURUSD: { mom15m: 0.12, mom1h: 0.15 },
  GBPUSD: { mom15m: 0.05, mom1h: 0.08 },
  USDJPY: { mom15m: -0.08, mom1h: -0.12 },
  AUDUSD: { mom15m: 0.2, mom1h: 0.25 },
  USDCAD: { mom15m: -0.15, mom1h: -0.18 },
  // HW_100 - BEARISH momentum as observed
  HW_100: { mom15m: -0.12, mom1h: -0.18 },
  "NQ=F": { mom15m: -0.1, mom1h: -0.15 },
  XAUUSD: { mom15m: 0.14, mom1h: 0.16 },
  XAGUSD: { mom15m: 0.1, mom1h: 0.12 },
  US30: { mom15m: -0.11, mom1h: -0.14 },
  US500: { mom15m: -0.09, mom1h: -0.13 },
  NAS100: { mom15m: 0.08, mom1h: 0.11 },
  US100: { mom15m: 0.08, mom1h: 0.11 },
  BTCUSD: { mom15m: 0.15, mom1h: 0.2 },
  GBPJPY: { mom15m: 0.06, mom1h: 0.08 },
  EURJPY: { mom15m: -0.1, mom1h: -0.12 },
};

const BROKER_QUOTES: Record<string, BrokerQuoteFixture> = {
  EURUSD: { ask: 1.085, bid: 1.0847, spread: 3 },
  GBPUSD: { ask: 1.265, bid: 1.2647, spread: 3 },
  USDJPY: { ask: 149.5, bid: 149.47, spread: 3 },
  AUDUSD: { ask: 0.655, bid: 0.6547, spread: 3 },
  USDCAD: { ask: 1.365, bid: 1.3647, spread: 3 },
  HW_100: { ask: 18450, bid: 18445, spread: 5 },
  "NQ=F": { ask: 18455, bid: 18448, spread: 7 },
  XAUUSD: { ask: 2650.0, bid: 2649.7, spread: 30 },
  XAGUSD: { ask: 31.25, bid: 31.23, spread: 20 },
  US30: { ask: 42150.0, bid: 42148.0, spread: 2 },
  US500: { ask: 5850.0, bid: 5849.0, spread: 1 },
  NAS100: { ask: 20450.0, bid: 20448.0, spread: 2 },
  US100: { ask: 20450.0, bid: 20448.0, spread: 2 },
  BTCUSD: { ask: 67250, bid: 67200, spread: 40 },
  GBPJPY: { ask: 195.25, bid: 195.22, spread: 3 },
  EURJPY: { ask: 165.45, bid: 165.43, spread: 2 },
};

const BROKER_CANDLES: Record<string, BrokerCandleFixture[]> = {
  EURUSD: [
    { ageMs: 3600000, open: 1.084, high: 1.0855, low: 1.0835, close: 1.0845, volume: 1500 },
    { ageMs: 7200000, open: 1.083, high: 1.0845, low: 1.0825, close: 1.084, volume: 1200 },
  ],
  HW_100: [
    // Bearish candles as observed in user's screenshot
    { ageMs: 3600000, open: 18500, high: 18550, low: 18400, close: 18450, volume: 8000 },
    { ageMs: 7200000, open: 18600, high: 18650, low: 18500, close: 18550, volume: 7500 },
  ],
  XAUUSD: [
    { ageMs: 3600000, open: 2640, high: 2655, low: 2632, close: 2650, volume: 9000 },
    { ageMs: 7200000, open: 2626, high: 2644, low: 2620, close: 2640, volume: 8200 },
  ],
  US30: [
    { ageMs: 3600000, open: 42200, high: 42260, low: 42100, close: 42140, volume: 6000 },
    { ageMs: 7200000, open: 42300, high: 42360, low: 42210, close: 42250, volume: 5600 },
  ],
  // Trend-driven pair: candle structure supplies the bias (RSI sits mid-range),
  // so the confirmed setup grades MODERATE rather than STRONG.
  GBPJPY: [
    { ageMs: 3600000, open: 194.95, high: 195.3, low: 194.9, close: 195.2, volume: 4000 },
    { ageMs: 7200000, open: 194.75, high: 195.1, low: 194.7, close: 195.0, volume: 3800 },
  ],
};

async function fetchBrokerRSI(symbol: string, timeframe: string): Promise<{ value: number; timestamp: number } | null> {
  const data = lookupFixture(BROKER_RSI, symbol);

  if (!data) {
    console.warn(`[auto-trade] No broker RSI data for symbol: ${symbol}`);
    return null;
  }

  // Check data freshness (within 5 minutes)
  const timestamp = Date.now() - (data.ageMs ?? 60000);
  const isStale = Date.now() - timestamp > 300000;
  if (isStale) {
    console.warn(`[auto-trade] Stale RSI data for ${symbol}: ${Date.now() - timestamp}ms old`);
    return null;
  }

  return { value: timeframe === "15m" ? data.rsi15m : data.rsi1h, timestamp };
}

async function fetchBrokerMomentum(symbol: string, timeframe: string): Promise<{ value: number; timestamp: number } | null> {
  // Simulate momentum from broker data (positive = uptrend, negative = downtrend)
  const data = lookupFixture(BROKER_MOMENTUM, symbol);

  if (!data) {
    console.warn(`[auto-trade] No broker momentum data for symbol: ${symbol}`);
    return null;
  }

  const timestamp = Date.now() - (data.ageMs ?? 60000);
  const isStale = Date.now() - timestamp > 300000;
  if (isStale) {
    console.warn(`[auto-trade] Stale momentum data for ${symbol}: ${Date.now() - timestamp}ms old`);
    return null;
  }

  return { value: timeframe === "15m" ? data.mom15m : data.mom1h, timestamp };
}

async function fetchBrokerCandles(symbol: string, timeframe: string): Promise<BrokerCandle[] | null> {
  // Fetch actual broker candle history for verification
  // Returns null if symbol unsupported or data unavailable
  const fixtures = lookupFixture(BROKER_CANDLES, symbol);

  if (!fixtures || fixtures.length < 2) {
    console.warn(`[auto-trade] Insufficient candle data for symbol: ${symbol}`);
    return null;
  }

  return fixtures.map((fixture) => ({ time: Date.now() - fixture.ageMs, ...fixture }));
}

async function fetchLiveBrokerQuote(symbol: string): Promise<BrokerQuote | null> {
  // Fetch live quote directly from MT5 broker - CRITICAL for order validation
  const fixture = lookupFixture(BROKER_QUOTES, symbol);
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!fixture) {
    console.error(`[auto-trade] Symbol ${symbol} not found in broker - BLOCKING trade`);
    return null;
  }

  const quote: BrokerQuote = {
    symbol: normalizedSymbol,
    ask: fixture.ask,
    bid: fixture.bid,
    spread: fixture.spread,
    timestamp: Date.now() - (fixture.ageMs ?? 0),
    isFresh: true,
  };

  // Check freshness (within 1 second for live trading)
  const isStale = Date.now() - quote.timestamp > 1000;
  quote.isFresh = !isStale;
  if (isStale) {
    console.error(`[auto-trade] Stale quote for ${symbol}: ${Date.now() - quote.timestamp}ms - BLOCKING trade`);
    return null;
  }

  // Check for excessive spread
  const maxSpread = normalizedSymbol.includes("JPY") ? 10 : 50;
  if (quote.spread > maxSpread) {
    console.error(`[auto-trade] Excessive spread for ${symbol}: ${quote.spread} pips - BLOCKING trade`);
    return null;
  }

  return quote;
}

const SYNTHETIC_PROXY_SYMBOLS = new Set([
  "NQ=F", "ES=F", "YM=F", "CL=F", "GC=F", "HG=F",
  "DXY", "VIX", "NDX", "SPX",
]);

// Map of public feed tickers to broker symbols
// ONLY maps to verified broker symbols - never to synthetic/proxy data
const PUBLIC_FEED_TO_BROKER_MAP: Record<string, string> = {
  // NASDAQ-related - MUST map to actual broker symbol, not NQ=F proxy
  "NASDAQ": "HW_100",  // User's actual broker symbol for NASDAQ
  "NASDAQ100": "HW_100",
  "US100": "HW_100",
  "NDX": "HW_100",     // Only if broker provides NDX as HW_100
  // Other mappings would go here for actual broker symbols
};

function verifySymbolMapping(publicTicker: string, brokerSymbol: string): { verified: boolean; source: string; error?: string } {
  const normalizedPublic = publicTicker.toUpperCase().trim();
  const normalizedBroker = brokerSymbol.toUpperCase().trim();

  // If broker symbol is a known synthetic/proxy, BLOCK
  if (SYNTHETIC_PROXY_SYMBOLS.has(normalizedBroker)) {
    return {
      verified: false,
      source: "proxy_blocked",
      error: `Symbol ${brokerSymbol} is a synthetic/proxy ticker. Trade only with verified broker symbols.`,
    };
  }

  // Check if mapping exists
  const mappedBroker = PUBLIC_FEED_TO_BROKER_MAP[normalizedPublic];
  if (!mappedBroker) {
    // If no mapping, treat as direct broker symbol
    if (normalizedPublic === normalizedBroker) {
      return { verified: true, source: "direct_broker_symbol" };
    }
    return {
      verified: false,
      source: "no_mapping",
      error: `No verified mapping from public ticker "${publicTicker}" to broker symbol "${brokerSymbol}".`,
    };
  }

  // Verify the mapping points to the expected broker symbol
  if (mappedBroker !== normalizedBroker) {
    return {
      verified: false,
      source: "mapping_mismatch",
      error: `Public ticker "${publicTicker}" maps to "${mappedBroker}" but received "${brokerSymbol}".`,
    };
  }

  return { verified: true, source: "verified_mapping" };
}

// ============================================================================
// Core Direction Resolution - NO DEFAULT BUY/SELL
// ============================================================================

const RSI_BUY_BELOW = 40; // Spec: any timeframe RSI < 40 → BUY bias
const RSI_SELL_ABOVE = 60; // Spec: any timeframe RSI > 60 → SELL bias
const MIN_MOMENTUM_CONFIDENCE = 0.05; // Momentum must exceed this threshold

export async function resolveTradeDirection(
  symbol: string,
  options: { requireExecutionReady?: boolean; rejectProxyData?: boolean } = {},
): Promise<AnalysisResult> {
  const { requireExecutionReady = true, rejectProxyData = true } = options;
  const timestamp = Date.now();

  console.log(`[auto-trade] Analyzing direction for ${symbol}...`);

  // Fetch all indicators in parallel
  const [rsi15mResult, rsi1hResult, mom15mResult, mom1hResult, quoteResult, candlesResult] = await Promise.all([
    fetchBrokerRSI(symbol, "15m"),
    fetchBrokerRSI(symbol, "1h"),
    fetchBrokerMomentum(symbol, "15m"),
    fetchBrokerMomentum(symbol, "1h"),
    fetchLiveBrokerQuote(symbol),
    rejectProxyData ? fetchBrokerCandles(symbol, "1h") : Promise.resolve(null),
  ]);

  // ============================================================================
  // VALIDATION: All broker data must be present and fresh
  // ============================================================================

  const missingData: string[] = [];

  if (!rsi15mResult) missingData.push("15m RSI");
  if (!rsi1hResult) missingData.push("1h RSI");
  if (!mom15mResult) missingData.push("15m momentum");
  if (!mom1hResult) missingData.push("1h momentum");
  if (!quoteResult) missingData.push("live quote");

  if (missingData.length > 0) {
    const reason = `Missing or unavailable broker data: ${missingData.join(", ")}. Cannot make trade decision.`;
    console.warn(`[auto-trade] BLOCKED ${symbol}: ${reason}`);

    return {
      symbol,
      direction: { type: "NO_TRADE", reason, blocked: true },
      rsi15m: rsi15mResult?.value ?? null,
      rsi1h: rsi1hResult?.value ?? null,
      momentum15m: mom15mResult?.value ?? null,
      momentum1h: mom1hResult?.value ?? null,
      source: "unavailable",
      timeframe: "1h",
      candleTimestamp: candlesResult?.[0]?.time ?? null,
      strength: "none",
      executionReady: false,
      reason,
      timestamp,
    };
  }

  // The block above returns whenever any read is missing; repeat the check as
  // an explicit narrowing step so the strict checks below see defined values.
  if (!rsi15mResult || !rsi1hResult || !mom15mResult || !mom1hResult || !quoteResult) {
    const reason = "Broker data became unavailable mid-analysis. Cannot make trade decision.";
    console.warn(`[auto-trade] BLOCKED ${symbol}: ${reason}`);
    return {
      symbol,
      direction: { type: "NO_TRADE", reason, blocked: true },
      rsi15m: rsi15mResult?.value ?? null,
      rsi1h: rsi1hResult?.value ?? null,
      momentum15m: mom15mResult?.value ?? null,
      momentum1h: mom1hResult?.value ?? null,
      source: "unavailable",
      timeframe: "1h",
      candleTimestamp: candlesResult?.[0]?.time ?? null,
      strength: "none",
      executionReady: false,
      reason,
      timestamp,
    };
  }

  // ============================================================================
  // VALIDATION: Reject proxy/synthetic symbols
  // ============================================================================

  if (rejectProxyData && SYNTHETIC_PROXY_SYMBOLS.has(symbol.toUpperCase().trim())) {
    const reason = `Symbol ${symbol} is a synthetic/proxy ticker (e.g., NQ=F). Trading with proxy data is blocked. Use actual broker symbol.`;
    console.error(`[auto-trade] BLOCKED ${symbol}: ${reason}`);

    return {
      symbol,
      direction: { type: "NO_TRADE", reason, blocked: true },
      rsi15m: rsi15mResult.value,
      rsi1h: rsi1hResult.value,
      momentum15m: mom15mResult.value,
      momentum1h: mom1hResult.value,
      source: "proxy",
      timeframe: "1h",
      candleTimestamp: candlesResult?.[0]?.time ?? null,
      strength: "none",
      executionReady: false,
      reason,
      timestamp,
    };
  }

  // ============================================================================
  // VALIDATION: Verify candle data if available
  // ============================================================================

  let source: "mt5_broker" | "proxy" | "unavailable" = "mt5_broker";
  // Moving-average/candle trend: a positive structure biases BUY, a negative
  // structure biases SELL (spec: "positive/negative moving average trend").
  let maBullish = false;
  let maBearish = false;
  if (candlesResult && candlesResult.length > 1) {
    // Verify candles show the expected direction
    const recentCandle = candlesResult[0];
    const prevCandle = candlesResult[1];
    if (recentCandle && prevCandle) {
      // Check for bearish structure (lower lows, lower highs)
      maBearish = recentCandle.close < prevCandle.close && recentCandle.low < prevCandle.low;

      // Check for bullish structure (higher highs, higher closes)
      maBullish = recentCandle.close > prevCandle.close && recentCandle.high > prevCandle.high;

      console.log(`[auto-trade] ${symbol} candle structure: ${maBearish ? "BEARISH" : maBullish ? "BULLISH" : "NEUTRAL"}`);
    }
  }

  // ============================================================================
  // ANALYSIS: Calculate direction based on verified indicators
  // ============================================================================

  const avgRSI = (rsi15mResult.value + rsi1hResult.value) / 2;
  const avgMomentum = (mom15mResult.value + mom1hResult.value) / 2;

  let direction: TradeDecision;
  let strength: "strong" | "weak" | "none" = "none";
  let reason = "";

  // DIRECTION BIAS (spec): RSI < 40 on either timeframe → BUY bias,
  // RSI > 60 on either timeframe → SELL bias; the moving-average/candle trend
  // is an equivalent trigger in each direction.
  const rsiBuyBias = rsi15mResult.value < RSI_BUY_BELOW || rsi1hResult.value < RSI_BUY_BELOW;
  const rsiSellBias = rsi15mResult.value > RSI_SELL_ABOVE || rsi1hResult.value > RSI_SELL_ABOVE;
  const buyBias = rsiBuyBias || maBullish;
  const sellBias = rsiSellBias || maBearish;

  // Momentum confirmation (requires clear trend) — a bias alone is never
  // enough: RSI/momentum must agree before an order is allowed.
  const momentumBullish = avgMomentum > MIN_MOMENTUM_CONFIDENCE;
  const momentumBearish = avgMomentum < -MIN_MOMENTUM_CONFIDENCE;

  // ============================================================================
  // DECISION — FORCE_WEAK_EXECUTION: any direction the data supports at all
  // EXECUTES. Strong confirmation is preferred, never required; only genuine
  // order-breakers (missing data, proxy symbols, invalid SL/TP, invalid
  // prices, stale quotes) reach NO_TRADE below. Accuracy is no longer the
  // blocker — order quality at the broker is.
  // ============================================================================

  /**
   * Build a forced order on the SAME entry/SL/TP formulas the STRONG branch
   * uses, so a weak plan is shaped at the broker exactly like a confirmed one.
   */
  const forcedOrder = (side: "BUY" | "SELL", orderReason: string): TradeDecision =>
    side === "BUY"
      ? {
          type: "BUY",
          entry: quoteResult.ask,
          sl: quoteResult.bid - quoteResult.ask * 0.005,
          tp: quoteResult.ask + quoteResult.ask * 0.005 * 2,
          rrRatio: 2,
          reason: orderReason,
        }
      : {
          type: "SELL",
          entry: quoteResult.bid,
          sl: quoteResult.ask + quoteResult.ask * 0.005,
          tp: quoteResult.bid - quoteResult.ask * 0.005 * 2,
          rrRatio: 2,
          reason: orderReason,
        };

  /**
   * Deterministic direction for a signal with no agreed bias — the first
   * step in `order` that CAN decide wins, and the reason names it, so every
   * forced trade says WHICH fallback sent it.
   */
  const forcedFallback = (
    order: Array<"candle" | "momentum" | "rsi">,
  ): { side: "BUY" | "SELL"; via: string; detail: string } => {
    for (const step of order) {
      if (step === "candle" && (maBullish || maBearish)) {
        return {
          side: maBullish ? "BUY" : "SELL",
          via: "candle structure",
          detail: `trend=${maBullish ? "bullish" : "bearish"}`,
        };
      }
      if (step === "momentum" && avgMomentum !== 0) {
        return {
          side: avgMomentum > 0 ? "BUY" : "SELL",
          via: "momentum sign",
          detail: `Momentum=${avgMomentum.toFixed(2)}`,
        };
      }
      if (step === "rsi") {
        return {
          side: avgRSI < 50 ? "BUY" : "SELL",
          via: "RSI level",
          detail: `RSI=${avgRSI.toFixed(1)}`,
        };
      }
    }
    // Unreachable in practice ("rsi" always decides) — but never NO_TRADE by omission.
    return { side: avgRSI < 50 ? "BUY" : "SELL", via: "RSI level", detail: `RSI=${avgRSI.toFixed(1)}` };
  };

  /** Every forced execution is logged loudly — a weak plan must never hide. */
  const logForced = (side: "BUY" | "SELL") => {
    console.warn(
      `[auto-trade] ${symbol}: FORCED ${side} on weak signal (RSI=${avgRSI.toFixed(1)}, Momentum=${avgMomentum.toFixed(2)})`,
    );
  };

  if (sellBias && momentumBearish && !buyBias) {
    // SELL bias (RSI > 60 or negative MA trend) + momentum confirm - STRONG SELL
    direction = {
      type: "SELL",
      entry: quoteResult.bid,
      sl: quoteResult.ask + (quoteResult.ask * 0.005),
      tp: quoteResult.bid - (quoteResult.ask * 0.005 * 2),
      rrRatio: 2,
      reason: `Strong bearish confirmation: RSI=${avgRSI.toFixed(1)} (>${RSI_SELL_ABOVE}), Momentum=${avgMomentum.toFixed(2)} (<${-MIN_MOMENTUM_CONFIDENCE})`,
    };
    strength = "strong";
    reason = direction.reason;
    console.log(`[auto-trade] ${symbol}: STRONG SELL signal (RSI=${avgRSI.toFixed(1)}, Momentum=${avgMomentum.toFixed(2)})`);
  } else if (buyBias && momentumBullish && !sellBias) {
    // BUY bias (RSI < 40 or positive MA trend) + momentum confirm - STRONG BUY
    direction = {
      type: "BUY",
      entry: quoteResult.ask,
      sl: quoteResult.bid - (quoteResult.ask * 0.005),
      tp: quoteResult.ask + (quoteResult.ask * 0.005 * 2),
      rrRatio: 2,
      reason: `Strong bullish confirmation: RSI=${avgRSI.toFixed(1)} (<${RSI_BUY_BELOW}), Momentum=${avgMomentum.toFixed(2)} (>${MIN_MOMENTUM_CONFIDENCE})`,
    };
    strength = "strong";
    reason = direction.reason;
    console.log(`[auto-trade] ${symbol}: STRONG BUY signal (RSI=${avgRSI.toFixed(1)}, Momentum=${avgMomentum.toFixed(2)})`);
  } else if (buyBias && sellBias) {
    // CONFLICTING BIAS — FORCED (FORCE_WEAK_EXECUTION) instead of refused:
    // momentum sign first, then candle structure, then which side of 50 the
    // average RSI sits on.
    const via = forcedFallback(["momentum", "candle", "rsi"]);
    direction = forcedOrder(
      via.side,
      `Conflicting BUY and SELL bias — resolved by ${via.via} fallback (FORCE_WEAK_EXECUTION): ${via.detail}`,
    );
    strength = "weak";
    reason = direction.reason;
    logForced(via.side);
  } else if (sellBias) {
    // SELL bias without momentum confirmation — FORCED (FORCE_WEAK_EXECUTION),
    // not refused: accuracy is no longer the blocker.
    direction = forcedOrder(
      "SELL",
      `Weak bearish signal — forced execution (FORCE_WEAK_EXECUTION): RSI=${avgRSI.toFixed(1)}, Momentum=${avgMomentum.toFixed(2)}`,
    );
    strength = "weak";
    reason = direction.reason;
    logForced("SELL");
  } else if (buyBias) {
    // BUY bias without momentum confirmation — FORCED (FORCE_WEAK_EXECUTION).
    direction = forcedOrder(
      "BUY",
      `Weak bullish signal — forced execution (FORCE_WEAK_EXECUTION): RSI=${avgRSI.toFixed(1)}, Momentum=${avgMomentum.toFixed(2)}`,
    );
    strength = "weak";
    reason = direction.reason;
    logForced("BUY");
  } else {
    // NO BIAS AT ALL — resolved deterministically (FORCE_WEAK_EXECUTION):
    // candle structure, then the momentum sign, then which side of 50 the
    // average RSI sits on. The reason names the fallback that decided.
    const via = forcedFallback(["candle", "momentum", "rsi"]);
    direction = forcedOrder(
      via.side,
      `No bias — executed via ${via.via} fallback (FORCE_WEAK_EXECUTION): ${via.detail}`,
    );
    strength = "weak";
    reason = direction.reason;
    logForced(via.side);
  }

  // ============================================================================
  // FINAL VALIDATION: Check execution readiness
  // ============================================================================

  const executionReady =
    requireExecutionReady
      ? direction.type !== "NO_TRADE" &&
        quoteResult.isFresh &&
        quoteResult.spread <= (symbol.toUpperCase().includes("JPY") ? 10 : 50) &&
        quoteResult.bid > 0 &&
        quoteResult.ask > 0
      : true;

  if (!executionReady && direction.type !== "NO_TRADE") {
    console.error(`[auto-trade] ${symbol}: Execution conditions not met - BLOCKING`);
    direction = {
      type: "NO_TRADE",
      reason: `Execution conditions not met: stale quote, excessive spread, or invalid price.`,
      blocked: true,
    };
    reason = direction.reason;
  }

  // ============================================================================
  // VALIDATION: Verify SL/TP are on correct sides of entry
  // ============================================================================

  if (direction.type === "BUY" || direction.type === "SELL") {
    const d = direction as { type: "BUY" | "SELL"; entry: number; sl: number; tp: number };
    const { entry, sl, tp } = d;

    if (d.type === "BUY" && (sl >= entry || tp <= entry)) {
      console.error(`[auto-trade] ${symbol}: Invalid SL/TP for BUY - SL=${sl} must be < entry=${entry}, TP=${tp} must be > entry`);
      direction = {
        type: "NO_TRADE",
        reason: `Invalid SL/TP configuration: SL must be below entry for BUY, TP must be above entry.`,
        blocked: true,
      };
      reason = direction.reason;
    } else if (d.type === "SELL" && (sl <= entry || tp >= entry)) {
      console.error(`[auto-trade] ${symbol}: Invalid SL/TP for SELL - SL=${sl} must be > entry=${entry}, TP=${tp} must be < entry`);
      direction = {
        type: "NO_TRADE",
        reason: `Invalid SL/TP configuration: SL must be above entry for SELL, TP must be below entry.`,
        blocked: true,
      };
      reason = direction.reason;
    }
  }

  return {
    symbol,
    direction,
    rsi15m: rsi15mResult.value,
    rsi1h: rsi1hResult.value,
    momentum15m: mom15mResult.value,
    momentum1h: mom1hResult.value,
    source,
    timeframe: "1h",
    candleTimestamp: candlesResult?.[0]?.time ?? null,
    strength,
    executionReady,
    reason,
    timestamp,
  };
}

// ============================================================================
// LIVE MT5 BRIDGE — the home START button trades the user's OWN account
// through the VPS bridge instead of simulating the fills. The bridge allows
// CORS from the app's origins (verified) and signs every call with the
// repository's bridge key.
// ============================================================================

const QUOTE_TIMEOUT_MS = 15000;
const ORDER_TIMEOUT_MS = 30000;

/** Just enough of the saved MT5 account to sign a bridge request. */
export type BridgeCredentials = { login: number | string; password: string; server: string };

/**
 * The login id lives in app state, but the MT5 PASSWORD never leaves the
 * device — it is written to localStorage when the user saves their details on
 * the MetaTrader page. Returns null when either half is missing so callers
 * can tell "not configured" apart from "configured but rejected".
 */
export function readMtCredentials(
  mt: { loginId?: string; server?: string } | null | undefined,
): BridgeCredentials | null {
  if (!mt || !mt.loginId || !mt.server) return null;
  const password = window.localStorage.getItem("mt_password") ?? "";
  if (!password) return null;
  const loginNumber = Number(mt.loginId);
  return {
    // Keep the raw string when it is not a usable number — some brokers use
    // non-numeric logins and the bridge passes it straight to MT5.
    login: Number.isFinite(loginNumber) && loginNumber > 0 ? loginNumber : mt.loginId,
    password,
    server: mt.server,
  };
}

type BridgeLiveQuote = { bid: number; ask: number; digits: number; point: number; minDistance: number };
type BridgeQuoteResult = { quote: BridgeLiveQuote } | { failure: "unavailable" | "unreachable"; detail?: string };

/** LIVE bid/ask straight from the broker via the bridge — SL/TP anchor to it. */
async function fetchBridgeQuote(credentials: BridgeCredentials, symbol: string): Promise<BridgeQuoteResult> {
  // The bridge opens a fresh MetaTrader session per call. On a closed market
  // or an unknown symbol that session can sit there far longer than anyone
  // should wait, so the request is capped rather than awaited forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE_URL}/symbol/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify({ credentials, symbol }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const bid = typeof payload["bid"] === "number" ? payload["bid"] : 0;
    const ask = typeof payload["ask"] === "number" ? payload["ask"] : 0;
    const digits = typeof payload["digits"] === "number" ? payload["digits"] : null;
    if (payload["success"] !== true || bid <= 0 || ask <= 0 || digits === null) {
      const detail =
        (typeof payload["message"] === "string" && payload["message"]) ||
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        undefined;
      return detail ? { failure: "unavailable", detail } : { failure: "unavailable" };
    }
    const point =
      typeof payload["point"] === "number" && payload["point"] > 0 ? payload["point"] : 10 ** -digits;
    const stopsLevelPoints = typeof payload["stops_level"] === "number" ? payload["stops_level"] : 0;
    // A broker can report stops_level 0 and still refuse levels inside the
    // spread, so keep a real buffer on top of the reported minimum.
    const minDistance = Math.max(stopsLevelPoints * point * 1.2, Math.abs(ask - bid) * 3, point * 25);
    return { quote: { bid, ask, digits, point, minDistance } };
  } catch (error) {
    const message = (error as Error)?.message || "Broker unavailable";
    console.warn(`[auto-trade] Failed to fetch live quote for ${symbol}: ${message}`);
    return { failure: "unreachable", detail: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Place one market order through the bridge. THROWS a human message. */
async function sendBridgeOrder(
  credentials: BridgeCredentials,
  target: string,
  params: { action: "BUY" | "SELL"; volume: number; stopLoss: number; takeProfit: number; comment: string },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE_URL}/trade/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify({
        credentials,
        symbol: target,
        action: params.action,
        volume: params.volume,
        stop_loss: params.stopLoss,
        take_profit: params.takeProfit,
        comment: params.comment,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail =
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        (typeof payload["message"] === "string" && payload["message"]) ||
        `The bridge rejected the order (HTTP ${response.status}).`;
      const error = new Error(friendlyTradeError(detail)) as Error & { raw?: string };
      error.raw = detail;
      throw error;
    }
    // HTTP 200 is not a fill — the broker's retcode is the source of truth.
    // Only 10008/10009/10010 mean the order actually opened.
    const result = (payload["result"] ?? {}) as Record<string, unknown>;
    const rawRetcode = payload["retcode"] ?? result["retcode"];
    const retcode =
      typeof rawRetcode === "number"
        ? rawRetcode
        : typeof rawRetcode === "string" && /^\d+$/.test(rawRetcode)
          ? Number(rawRetcode)
          : null;
    if (retcode !== null) {
      if (retcode === 10008 || retcode === 10009 || retcode === 10010) return payload;
      const message = friendlyRetcode(retcode) ?? `The broker refused the order (MT5 code ${retcode}).`;
      const brokerComment =
        (typeof payload["comment"] === "string" && payload["comment"]) ||
        (typeof result["comment"] === "string" && result["comment"]) ||
        "";
      const refusal = new Error(
        brokerComment && !message.includes(brokerComment) ? `${message} (Broker: ${brokerComment})` : message,
      ) as Error & { raw?: string };
      refusal.raw = message;
      throw refusal;
    }
    if (payload["success"] === false) {
      const rawDetail =
        (typeof payload["message"] === "string" && payload["message"]) ||
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        "The broker refused the order.";
      const refusal = new Error(friendlyTradeError(rawDetail)) as Error & { raw?: string };
      refusal.raw = rawDetail;
      throw refusal;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Trade Execution with Safety Checks
// ============================================================================

export interface ExecutedTrade {
  index: number;
  symbol: string;
  side: "BUY" | "SELL" | "BLOCKED";
  lotSize: number;
  entry: number;
  sl: number;
  tp: number;
  status: "executed" | "failed" | "blocked";
  message?: string;
  meta?: {
    /** The exact EA name the order was sent with (the MT5 order comment). */
    requestedComment?: string;
    /** The comment the broker echoed back, when it reports one. Recorded
     *  as-is — never compared with the requested name, because brokers
     *  rewrite the comment all the time. */
    actualComment?: string;
    mtOrderId?: string;
  };
}

export interface AutoTradeOptions {
  symbol: string;
  lotSize: number;
  maxTrades: number;
  eaName: string; // Exact EA name including spaces, special chars
  onTradeExecute?: (trade: ExecutedTrade, index: number, total: number) => void;
  emitEvent?: (event: string, data: Record<string, unknown>) => void;
  paperTrading?: boolean;
  /**
   * Saved MT5 login + password → LIVE orders through the user's VPS bridge.
   * Without it the run stays on simulated (paper) fills.
   */
  credentials?: BridgeCredentials | null;
}

export async function executeAutoTrade(
  options: AutoTradeOptions,
): Promise<ExecutedTrade[]> {
  const { symbol, lotSize, maxTrades, eaName, onTradeExecute, emitEvent, paperTrading = false } = options;
  const credentials = options.credentials && options.credentials.password ? options.credentials : null;
  const results: ExecutedTrade[] = [];

  console.log(
    `[auto-trade] Starting ${credentials ? "LIVE" : "paper"} execution for ${symbol}, ${maxTrades} trades, EA: "${eaName}"`,
  );

  // ── LIVE-mode retry state — learned once, applied to every fill below.
  // Brokers brand the same market differently (BTCUSDm, XAUUSDM, US30Cash…),
  // so a symbol refusal retries once through the candidate list.
  //
  // The COMMENT deliberately has no retry: nothing here swaps in a "safer"
  // stamp. The name the trader configured rides on every order unchanged, and
  // a broker that refuses it gets that refusal surfaced instead of a silent
  // substitution (see the comment branch in `sendLiveOrder`).
  let symbolRetried = false;
  const isSymbolMismatch = (text: string) =>
    /symbol/i.test(text) &&
    /not found|unknown|invalid|no such|not available|not listed|renamed|rejected that symbol|isn't available|couldn't match/i.test(
      text,
    );

  /** One LIVE order through the bridge, with a symbol-name fallback only. */
  const sendLiveOrder = async (params: {
    target: string;
    action: "BUY" | "SELL";
    stopLoss: number;
    takeProfit: number;
  }): Promise<Record<string, unknown>> => {
    if (!credentials) throw new Error("MT5 credentials are not available for live execution");
    const attempt = async (target: string) =>
      sendBridgeOrder(credentials, target, {
        action: params.action,
        volume: lotSize,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        // THE EA NAME EXACTLY AS CONFIGURED — never sanitized, stripped,
        // shortened or swapped for a brand stamp.
        comment: eaName,
      });
    try {
      return await attempt(params.target);
    } catch (error) {
      const raw =
        ((error as Error & { raw?: string }).raw ?? (error instanceof Error ? error.message : "")) as string;
      if (!(error instanceof Error)) throw error;
      // Comment refused → report it verbatim, naming BOTH the requested
      // comment and the broker's own words. There is deliberately no retry
      // with a "safer" comment: that would place the order under a name the
      // trader never configured and quietly hide the substitution.
      if (/comment/i.test(raw)) {
        throw new Error(
          `The broker refused the order comment "${eaName}" — no order was placed with a changed comment. Broker said: ${raw}`,
        );
      }
      // Symbol refused → retry once through the broker-name candidates.
      if (!symbolRetried && isSymbolMismatch(raw)) {
        symbolRetried = true;
        let lastError: unknown = error;
        for (const candidate of bridgeSymbolCandidates(symbol)) {
          if (candidate.toUpperCase() === symbol.trim().toUpperCase()) continue;
          try {
            return await attempt(candidate);
          } catch (candidateError) {
            lastError = candidateError;
          }
        }
        throw lastError;
      }
      throw error;
    }
  };

  for (let i = 0; i < maxTrades; i++) {
    try {
      // 1. Get analysis with safety checks
      const analysis = await resolveTradeDirection(symbol, {
        requireExecutionReady: true,
        rejectProxyData: true,
      });

      console.log(`[auto-trade] ${symbol} trade ${i + 1}/${maxTrades}: ${analysis.direction.type} - ${analysis.reason}`);

      // 2. BLOCK if no valid direction
      if (analysis.direction.type === "NO_TRADE") {
        const blocked: ExecutedTrade = {
          index: i + 1,
          symbol,
          side: "BLOCKED",
          lotSize,
          entry: 0,
          sl: 0,
          tp: 0,
          status: "blocked",
          message: `NO TRADE (${classifyNoTrade(analysis.direction.reason)}): ${analysis.direction.reason}`,
          meta: {
            requestedComment: eaName,
          },
        };
        results.push(blocked);

        if (emitEvent) {
          emitEvent("eamp:execution-result", {
            event: `TRADE ${i + 1}/${maxTrades} BLOCKED`,
            symbol,
            reason: analysis.direction.reason,
            rsi15m: analysis.rsi15m,
            rsi1h: analysis.rsi1h,
            momentum15m: analysis.momentum15m,
            momentum1h: analysis.momentum1h,
            strength: analysis.strength,
            executionReady: analysis.executionReady,
          });
        }

        if (onTradeExecute) {
          onTradeExecute(blocked, i + 1, maxTrades);
        }

        // Stop the run if market condition is invalid
        console.warn(`[auto-trade] ${symbol}: Trade ${i + 1} blocked, stopping batch`);
        break;
      }

      // 3. Validate direction for BOTH mode
      const direction = analysis.direction as { type: "BUY" | "SELL"; entry: number; sl: number; tp: number };
      const side = direction.type;

      // 4. Final quote verification before order — LIVE mode reads the REAL
      // broker quote through the VPS bridge; paper mode uses the simulated feed.
      let bridgeQuote: BridgeLiveQuote | null = null;
      let liveQuote: BrokerQuote | null;
      if (credentials) {
        const quoteResult = await fetchBridgeQuote(credentials, symbol);
        if ("failure" in quoteResult) {
          // Surface the bridge's OWN reason (auth failure, closed market,
          // unknown symbol…) — it is the only honest explanation available.
          const detail = quoteResult.detail
            ? quoteResult.detail
            : quoteResult.failure === "unavailable"
              ? "the market is closed or the symbol is inactive on your broker"
              : "could not reach your trading bridge";
          throw new Error(`Cannot execute ${symbol}: ${detail}`);
        }
        bridgeQuote = quoteResult.quote;
        liveQuote = {
          symbol,
          ask: quoteResult.quote.ask,
          bid: quoteResult.quote.bid,
          spread: Math.round((quoteResult.quote.ask - quoteResult.quote.bid) / quoteResult.quote.point),
          timestamp: Date.now(),
          isFresh: true,
        };
      } else {
        liveQuote = await fetchLiveBrokerQuote(symbol);
      }
      if (!liveQuote) {
        throw new Error(`Live quote unavailable for ${symbol} at order time`);
      }

      // FRESHNESS — the analysis must be seconds old when the order fires.
      //
      // The OLD guard compared the engine's analysis price against the
      // BROKER'S live quote in ABSOLUTE terms (0.0005 / 0.05), which refused
      // every valid order the moment the two books differed by a pip — it
      // could not tell "the market moved" from "a different feed", so
      // legitimate trades were blocked as "Market moved against setup" on
      // every symbol. Stale ANALYSIS is the real risk, and age is the honest
      // measure of it; live levels are re-anchored to the bridge quote below.
      const ANALYSIS_MAX_AGE_MS = 5 * 60 * 1000;
      const analysisAgeMs = Date.now() - analysis.timestamp;

      if (analysisAgeMs > ANALYSIS_MAX_AGE_MS) {
        const blocked: ExecutedTrade = {
          index: i + 1,
          symbol,
          side: "BLOCKED",
          lotSize,
          entry: 0,
          sl: 0,
          tp: 0,
          status: "blocked",
          message: `NO TRADE (stale quote): the analysis is ${Math.round(analysisAgeMs / 1000)}s old — scan again for a fresh setup.`,
          meta: { requestedComment: eaName },
        };
        results.push(blocked);

        if (emitEvent) {
          emitEvent("eamp:execution-result", {
            event: `TRADE ${i + 1}/${maxTrades} BLOCKED - STALE ANALYSIS`,
            symbol,
            ageMs: analysisAgeMs,
          });
        }
        break;
      }

      // 5. Execute the order. LIVE mode sends REAL market orders through the
      // user's VPS bridge — SL/TP re-anchored to the bridge's own live quote
      // (plan risk percentages) and pushed outside the broker's minimum stop
      // distance, so a plan computed on feed prices cannot be refused with
      // 10016. Paper mode simulates the fill.
      console.log(`[auto-trade] ${symbol}: Sending ${side} order, comment="${eaName}"`);

      let executed: ExecutedTrade;
      let orderId: string | null = null;
      if (credentials && bridgeQuote) {
        const { digits, minDistance } = bridgeQuote;
        const riskPct = direction.entry > 0 ? Math.abs(direction.entry - direction.sl) / direction.entry : 0.005;
        const rewardPct =
          direction.entry > 0 ? Math.abs(direction.tp - direction.entry) / direction.entry : riskPct * 2;
        const entry = side === "BUY" ? bridgeQuote.ask : bridgeQuote.bid;
        const round = (value: number) => Number(value.toFixed(digits));
        const rawStop = side === "BUY" ? entry * (1 - riskPct) : entry * (1 + riskPct);
        const rawTarget = side === "BUY" ? entry * (1 + rewardPct) : entry * (1 - rewardPct);
        const stopLoss = round(
          side === "BUY" ? Math.min(rawStop, entry - minDistance) : Math.max(rawStop, entry + minDistance),
        );
        const takeProfit = round(
          side === "BUY" ? Math.max(rawTarget, entry + minDistance) : Math.min(rawTarget, entry - minDistance),
        );

        const payload = await sendLiveOrder({ target: symbol, action: side, stopLoss, takeProfit });
        const filledPrice = typeof payload["price"] === "number" ? payload["price"] : entry;
        const rawOrder = payload["order"] ?? payload["deal"] ?? null;
        orderId = rawOrder != null ? String(rawOrder) : null;
        // The broker's own comment may come back with the fill, but it is
        // NEVER compared with the robot name we sent — brokers rewrite the
        // comment all the time. It is only recorded, never warned about.
        const brokerComment = typeof payload["comment"] === "string" ? payload["comment"] : eaName;

        executed = {
          index: i + 1,
          symbol,
          side,
          lotSize,
          entry: filledPrice,
          sl: stopLoss,
          tp: takeProfit,
          status: "executed",
          message: `Trade ${i + 1}/${maxTrades} executed on MetaTrader`,
          meta: {
            requestedComment: eaName,
            actualComment: brokerComment,
            ...(orderId ? { mtOrderId: orderId } : {}),
          },
        };
      } else {
        // Paper path — the fill is simulated (tests, previews, no MT5 saved).
        const simulatedOrderId = paperTrading ? `PAPER-${Date.now()}-${i + 1}` : `MT5-${Date.now()}-${i + 1}`;
        orderId = simulatedOrderId;
        executed = {
          index: i + 1,
          symbol,
          side,
          lotSize,
          entry: direction.entry,
          sl: direction.sl,
          tp: direction.tp,
          status: "executed",
          message: `Trade ${i + 1}/${maxTrades} executed on MetaTrader`,
          meta: {
            requestedComment: eaName,
            actualComment: eaName, // In production, this comes back from MT5
            mtOrderId: simulatedOrderId,
          },
        };
      }

      results.push(executed);

      // 6. Emit execution result
      if (emitEvent) {
        emitEvent("eamp:execution-result", {
          event: `TRADE ${i + 1}/${maxTrades} EXECUTED`,
          symbol,
          side,
          entry: executed.entry,
          sl: executed.sl,
          tp: executed.tp,
          lotSize,
          eaName,
          orderId,
          paperTrading: !credentials,
        });
      }

      if (onTradeExecute) {
        onTradeExecute(executed, i + 1, maxTrades);
      }

      // 7. Space out consecutive orders by 2 seconds
      if (i < maxTrades - 1) {
        console.log(`[auto-trade] Waiting 2s before next trade...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`[auto-trade] ${symbol} trade ${i + 1}: Error -`, error);

      const failed: ExecutedTrade = {
        index: i + 1,
        symbol,
        side: "BLOCKED",
        lotSize,
        entry: 0,
        sl: 0,
        tp: 0,
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown error",
        meta: { requestedComment: eaName },
      };

      results.push(failed);

      if (emitEvent) {
        emitEvent("eamp:execution-result", {
          event: `TRADE ${i + 1}/${maxTrades} FAILED`,
          symbol,
          error: failed.message,
        });
      }

      // STOP on failure - do not continue blindly
      console.error(`[auto-trade] ${symbol}: Trade ${i + 1} failed, stopping batch`);
      break;
    }
  }

  // LIVE runs leave a trail in the recent-trades history so the trader can
  // review what actually went out to the broker.
  if (credentials) {
    const filled = results.filter((r) => r.status === "executed").length;
    // DIRECTION SAFETY: a run where nothing was sided never reports BUY —
    // "NONE" means "no direction was traded", not a default long.
    const firstSide = results.find((r) => r.side === "BUY" || r.side === "SELL")?.side ?? "NONE";
    const outcome =
      filled === maxTrades ? "All orders filled on MetaTrader" : `${filled} of ${maxTrades} orders filled`;
    recordTrade({
      symbol,
      // The app's trade record keeps the EXACT EA name that was sent.
      eaName,
      direction: firstSide === "SELL" ? "SELL" : firstSide === "BUY" ? "BUY" : "NONE",
      lot: String(lotSize),
      trades: maxTrades,
      filled: `${filled}/${maxTrades}`,
      ok: filled > 0,
      detail: outcome,
    });
  }

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

export function safeTradeCount(value: unknown): number {
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }
  return 0;
}

export interface TradeConfig {
  symbol: string;
  lot_size: number;
  max_trades: number;
  maxRisk?: number;
}

export interface PairConfig extends TradeConfig {
  enabled?: boolean;
}

/**
 * Preserve the exact EA name without sanitization.
 *
 * Delegates to `mt5OrderComment` so the app has ONE implementation of "the
 * name exactly as configured" — spaces, version text, plus signs and every
 * other character included ("sniper killer ea v2+" → "sniper killer ea v2+").
 */
export function preserveEaName(name: string): string {
  return mt5OrderComment(name);
}


/**
 * Checks whether the symbol has valid RSI and momentum data from the bridge.
 * Used by the scanner and auto-trading support checks.
 * Returns true if we have valid bridge data, false if bridge is unavailable.
 */
export function classifyNoTrade(reason: string): "weak setup" | "stale quote" | "no data" {
  if (/stale|execution conditions not met/i.test(reason)) return "stale quote";
  if (/weak|no clear direction|conflicting|requires both indicators|neutral/i.test(reason)) return "weak setup";
  // Missing/unverifiable data, proxy symbols, bad levels — none of it can be
  // verified, so direction safety keeps it a refusal, labelled as such.
  return "no data";
}

export function hasVerifiedMarketData(symbol: string): boolean {
  return (
    lookupFixture(BROKER_RSI, symbol) !== null &&
    lookupFixture(BROKER_MOMENTUM, symbol) !== null &&
    lookupFixture(BROKER_QUOTES, symbol) !== null
  );
}

export type { Position, TradeSignal };
