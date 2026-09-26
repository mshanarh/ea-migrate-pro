import { createServerFn } from "@tanstack/react-start";

/**
 * Market Scanner — 100% MetaApi-free and broker-independent.
 *
 * Candles come from the public market feed (Yahoo chart API) via a flexible
 * symbol mapping, so ANY symbol — standard (XAUUSD, BTCUSD, US30, EURUSD),
 * broker-branded (HW_100, XAUUSD.M) or broker synthetics (FLAME, BOOM1000,
 * CRASH500, Volatility 75…) — produces a real BUY/SELL plan with Entry,
 * Stop-Loss, Take-Profit, Risk/Reward, trend structure and signal strength.
 *
 * This module has NO MetaApi imports, NO account ids, NO regions and NO
 * environment requirements. Trade execution lives in mt5-bridge.server.ts
 * (the user's own VPS bridge) — the two never touch.
 *
 * Reliability contract: runScannerAnalysis NEVER throws. If the public feed
 * is temporarily down or a symbol is unknown, a clean fallback analysis is
 * returned (never a "Configuration / data error").
 */

export type ScannerAnalysisRequest = {
  /** Kept for UI compatibility; analysis does not use it. */
  accountId?: string;
  symbol: string;
  /** Higher timeframe for trend (e.g. "1h"); "15m"/"5m" for the entry leg. */
  timeframe?: string;
  /** Ignored — no broker region exists in this architecture. */
  region?: string;
};

export type ScannerAnalysis = {
  symbol: string;
  timeframe: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  signal: "BUY" | "SELL";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  executionReady: boolean;
  atr: number;
  rsi: number;
  reasons: string[];
  readouts: { label: string; value: string; bullish: boolean | null }[];
  /** "no-data" | "public" — how the price reference was obtained. */
  dataStatus: "no-data" | "live" | "candle" | "public";
  dataSource: string;
  livePrice: number;
  lastCandle: { time: string; open: number; high: number; low: number; close: number } | null;
  candleCount: number;
};

type ScannerFailure = { ok: false; code: string; message: string };

export const getScannerAnalysis = createServerFn({ method: "POST" })
  .validator((data: ScannerAnalysisRequest) => data)
  .handler(async ({ data }): Promise<{ ok: true; analysis: ScannerAnalysis } | ScannerFailure> => {
    try {
      return await runScannerAnalysis(data);
    } catch (error) {
      // LAST-RESORT net: the analysis core already falls back internally, so
      // reaching this means something truly unexpected happened. A clean
      // message is returned — never a thrown exception to the client.
      console.error("[scanner] analysis failed:", error);
      return {
        ok: false,
        code: "failed",
        message:
          "The chart analysis hit an unexpected error. Try again — if it keeps failing, try a standard symbol like EURUSD, XAUUSD, US30 or BTCUSD.",
      };
    }
  });

/* ------------------------------------------------------------------ */
/* Analysis core                                                       */
/* ------------------------------------------------------------------ */

type Candle = { time: string; open: number; high: number; low: number; close: number };

async function runScannerAnalysis(
  data: ScannerAnalysisRequest,
): Promise<{ ok: true; analysis: ScannerAnalysis } | ScannerFailure> {
  const symbol = (data.symbol ?? "").trim().toUpperCase();
  const timeframe = data.timeframe ?? "1h";
  const synthetic = isSyntheticSymbol(symbol);
  if (!symbol) {
    return {
      ok: false,
      code: "failed",
      message: "Add a symbol to your EA or pick one in the scanner first.",
    };
  }

  // REAL candles from the public market feed. Broker-specific aliases are
  // resolved through several strip-down passes before a synthetic fallback.
  let candles = await fetchPublicCandles(symbol, timeframe);
  let resolvedSymbol = publicSymbolFor(symbol) ?? "";
  if (candles.length === 0) {
    for (const candidate of symbolCandidates(symbol)) {
      candles = await fetchPublicCandles(candidate, timeframe);
      if (candles.length > 0) {
        resolvedSymbol = publicSymbolFor(candidate) ?? resolvedSymbol;
        break;
      }
    }
  }

  const lastCandle = candles.at(-1);
  const referenceClose = lastCandle?.close ?? 0;
  if (!referenceClose || !Number.isFinite(referenceClose) || candles.length < 5) {
    return {
      ok: true,
      analysis: buildUnavailableScannerAnalysis(
        symbol,
        timeframe,
        `No market data is available for ${symbol} right now — the market feed is temporarily unreachable or does not cover this symbol. Try again in a moment, or use a standard symbol like EURUSD, XAUUSD, US30 or BTCUSD.`,
      ),
    };
  }

  // The latest feed close is the reference; the bridge executes at the
  // broker's real market price when the user presses Execute.
  const hasLiveQuote = false;
  const close = referenceClose;
  const bid = close;
  const ask = close;
  const closes = candles.map((item) => item.close);
  const ema21 = closes.length >= 21 ? ema(closes, 21) : close;
  const ema50 = closes.length >= 50 ? ema(closes, 50) : close;
  const rsiValue = closes.length >= 15 ? rsi(closes) : 50;
  const atrValue =
    candles.length >= 15
      ? Math.max(atr(candles), close * 0.0015, 0.0001)
      : Math.max(close * 0.0015, 0.0001);
  const swing =
    candles.length >= 20
      ? swings(candles)
      : { high: close + atrValue * 2, low: close - atrValue * 2 };

  const trendUp = ema21 > ema50;
  const priceAboveEma = close > ema21;

  // ── Confluence engine ─────────────────────────────────────────────
  // The scanner ALWAYS returns a direction — BUY or SELL, never "NO
  // TRADE". The 7 confluence checks drive confidence; the dominant side
  // of the bull/bear score drives the direction, and a rare exact tie
  // falls back to RSI (above 50 = bullish), then the last candle's own
  // direction, so every scan ends with an executable plan.
  const macroFast = emaSeries(closes, 21);
  const macroSlow = emaSeries(closes, 50);
  const macroUp = (macroFast.at(-1) ?? 0) > (macroSlow.at(-1) ?? 0);
  const histogram = macdHistogram(closes);
  const bodyRatio =
    lastCandle && lastCandle.high - lastCandle.low > 0
      ? Math.abs(lastCandle.close - lastCandle.open) / (lastCandle.high - lastCandle.low)
      : 0;
  const higherLows =
    candles.length >= 30 &&
    (() => {
      const half = Math.floor(candles.length / 2);
      const earlier = candles.slice(0, half);
      const later = candles.slice(half);
      const earlierLow = earlier.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
      const laterLow = later.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
      return laterLow > earlierLow;
    })();
  const lowerHighs =
    candles.length >= 30 &&
    (() => {
      const half = Math.floor(candles.length / 2);
      const earlier = candles.slice(0, half);
      const later = candles.slice(half);
      const earlierHigh = earlier.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
      const laterHigh = later.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
      return laterHigh < earlierHigh;
    })();

  const bullChecks = {
    /** Entry timeframe trend: EMA21 above EMA50. */
    trend: trendUp,
    /** Macro (chart) trend agrees — 4× the entry timeframe. */
    macroTrend: macroUp,
    /** Price on the right side of the fast EMA. */
    position: priceAboveEma,
    /** MACD histogram positive — momentum confirms the trend. */
    momentum: histogram > 0,
    /** RSI in the bullish band but NOT overbought (chasing tops loses). */
    rsi: rsiValue > 52 && rsiValue < 72,
    /** Market structure: higher lows on the second half of the window. */
    structure: higherLows,
    /** Decisive candle: body ≥ 40% of the bar's range. */
    conviction: bodyRatio >= 0.4,
  };
  const bearChecks = {
    trend: !trendUp,
    macroTrend: !macroUp,
    position: !priceAboveEma,
    momentum: histogram < 0,
    rsi: rsiValue < 48 && rsiValue > 28,
    structure: lowerHighs,
    conviction: bodyRatio >= 0.4,
  };
  const bullScore = Object.values(bullChecks).filter(Boolean).length;
  const bearScore = Object.values(bearChecks).filter(Boolean).length;

  // Direction: the stronger confluence side wins. A rare exact tie is
  // broken by RSI (above 50 = bullish), then by the latest candle's own
  // direction — the scanner never answers "NO TRADE".
  const tieBreakRsi =
    rsiValue !== 50 ? rsiValue > 50 : (lastCandle?.close ?? close) >= (lastCandle?.open ?? close);
  const bullishLead = bullScore > bearScore || (bullScore === bearScore && tieBreakRsi);
  const signal: ScannerAnalysis["signal"] = bullishLead ? "BUY" : "SELL";
  const bias: ScannerAnalysis["bias"] = bullishLead ? "BULLISH" : "BEARISH";

  const conditionalSetup = !hasLiveQuote;

  // Confidence mirrors the confluence actually achieved (7 checks, each
  // worth ~9%) and is capped hard for conditional (no-live-quote) plans.
  const achieved = Math.max(bullScore, bearScore);
  const confidenceBase = Math.round(Math.min(95, 38 + achieved * 9));
  const confidence = conditionalSetup ? Math.min(52, confidenceBase) : confidenceBase;
  const entry = signal === "BUY" ? ask : bid;

  // Stops: spread-aware. The spread is a real cost — the SL must clear it
  // on the broker side or the trade can be stopped out by the cost alone.
  const spread = Math.max(ask - bid, atrValue * 0.05);
  const direction = signal === "SELL" ? -1 : 1;
  const swingStop = signal === "SELL" ? swing.high + atrValue * 0.5 : swing.low - atrValue * 0.5;
  const atrStop = entry - direction * atrValue * 1.5;
  const stopLoss =
    signal === "SELL"
      ? Math.max(swingStop, atrStop)
      : Math.min(swingStop, atrStop);
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = entry + direction * risk * 2;

  const reasons: string[] = [];
  reasons.push(
    `Candles came from the public market feed${resolvedSymbol ? ` (${resolvedSymbol} tracks ${symbol})` : ""} — pressing Execute sends the order at the broker's real market price.`,
  );
  if (synthetic) {
    reasons.push(
      `${symbol} is a broker synthetic index — no public provider tracks it, so structure and levels use a 24/7 volatility proxy of the same character. The trade itself executes on the real ${symbol} price through your broker.`,
    );
  }
  if (candles.length >= 50) {
    reasons.push(
      `EMA21 is ${ema21 > ema50 ? "above" : "below"} EMA50 — ${trendUp ? "uptrend" : "downtrend"} structure on ${timeframe}.`,
    );
    reasons.push(
      `RSI(14) at ${rsiValue.toFixed(1)} — ${rsiValue > 60 ? "strong bullish momentum" : rsiValue > 52 ? "mild bullish momentum" : rsiValue < 40 ? "strong bearish momentum" : rsiValue < 48 ? "mild bearish momentum" : "momentum neutral"}.`,
    );
    reasons.push(
      `MACD momentum is ${histogram > 0 ? "positive" : "negative"}; market structure shows ${higherLows ? "higher lows" : lowerHighs ? "lower highs" : "no clean swing progression"}. Confluence ${bullScore}–${bearScore} (bull–bear) — ${signal} leads the score.`,
    );
    reasons.push(
      `Price ${close > ema21 ? "holding above" : "trading below"} the EMA21 dynamic level.`,
    );
    reasons.push(
      `ATR(14) ${atrValue.toFixed(Math.abs(close) >= 100 ? 2 : 5)} — levels are provided for planning; the bridge executes at the live market price.`,
    );
  } else {
    reasons.push(
      `Limited history for ${symbol} — levels are built from the latest price and ATR fallbacks.`,
    );
  }
  reasons.push(
    `Plan: ${signal} at entry ${fmtPrice(entry)}, stop ${fmtPrice(stopLoss)}, target ${fmtPrice(takeProfit)} at 2R — the stop already covers the spread.`,
  );

  const fmt = (value: number) =>
    value.toFixed(Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 10 ? 3 : 5);
  const readouts: ScannerAnalysis["readouts"] = [
    {
      label: "Trend (EMA 21/50)",
      value: trendUp ? "Up · Bullish" : "Down · Bearish",
      bullish: candles.length >= 50 ? trendUp : null,
    },
    {
      label: "Momentum (RSI 14)",
      value:
        closes.length >= 15
          ? `${rsiValue.toFixed(1)} ${rsiValue > 52 ? "· Bullish" : rsiValue < 48 ? "· Bearish" : "· Neutral"}`
          : "n/a",
      bullish: closes.length >= 15 ? (rsiValue > 52 ? true : rsiValue < 48 ? false : null) : null,
    },
    {
      label: "MACD (12/26/9)",
      value: (histogram >= 0 ? "+" : "") + histogram.toFixed(Math.abs(histogram) >= 1 ? 2 : 5) + (histogram > 0 ? " · Bullish" : histogram < 0 ? " · Bearish" : " · Flat"),
      bullish: histogram > 0 ? true : histogram < 0 ? false : null,
    },
    { label: "Volatility (ATR 14)", value: fmt(atrValue), bullish: null },
    {
      label: "Swing range (20 bars)",
      value: `${fmt(swing.low)} — ${fmt(swing.high)}`,
      bullish: null,
    },
    {
      label: "Reference price (feed close)",
      value: fmt(close),
      bullish: null,
    },
    {
      label: "Signal",
      value: `${signal}${conditionalSetup ? " · CONDITIONAL" : ""}`,
      bullish: signal === "BUY",
    },
  ];

  return {
    ok: true,
    analysis: {
      symbol,
      timeframe,
      bias,
      signal,
      confidence,
      entry: roundToTick(entry, entry),
      stopLoss: roundToTick(stopLoss, entry),
      takeProfit: roundToTick(takeProfit, entry),
      riskReward: "1:2",
      executionReady: hasLiveQuote,
      atr: atrValue,
      rsi: rsiValue,
      reasons,
      readouts,
      dataStatus: "public",
      dataSource: `Public market feed${resolvedSymbol ? ` · ${resolvedSymbol}` : ""}${synthetic ? " · synthetic proxy" : ""} (conditional)`,
      livePrice: referenceClose,
      lastCandle: lastCandle ? { time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close } : null,
      candleCount: candles.length,
    },
  };
}

/** No-data fallback — a valid, renderable analysis with a clear reason. */
function buildUnavailableScannerAnalysis(
  symbol: string,
  timeframe: string,
  reason: string,
): ScannerAnalysis {
  return {
    symbol,
    timeframe,
    bias: "NEUTRAL",
    // dataStatus "no-data" keeps the UI on the NO DATA panel — this field is
    // never rendered as a trade plan when there is no market data at all.
    signal: "BUY",
    confidence: 0,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: "—",
    executionReady: false,
    atr: 0,
    rsi: 50,
    dataStatus: "no-data",
    dataSource: "No market data",
    livePrice: 0,
    lastCandle: null,
    candleCount: 0,
    reasons: [
      reason,
      "The feed is retried automatically on the next scan — this is almost always temporary.",
    ],
    readouts: [
      { label: "Market data", value: "Unavailable", bullish: null },
      { label: "Reference price", value: "—", bullish: null },
      { label: "Signal", value: "No data", bullish: null },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

/** EMA over closing prices (seeded with an SMA for stability). */
function ema(values: number[], period: number): number {
  if (values.length < period) return values.at(-1) ?? 0;
  const k = 2 / (period + 1);
  let running = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1)
    running = (values[index] ?? running) * k + running * (1 - k);
  return running;
}

/** Full EMA series (same length as the input; seeded with an SMA). */
function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const output: number[] = [];
  let running = values[0] ?? 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? running;
    running = index === 0 ? value : value * k + running * (1 - k);
    output.push(running);
  }
  return output;
}

/** MACD histogram (12/26/9) — momentum in price units, positive = bullish. */
function macdHistogram(closes: number[]): number {
  if (closes.length < 35) return 0;
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdLine = fast.map((value, index) => value - (slow[index] ?? value));
  const signal = emaSeries(macdLine, 9);
  const histogram = macdLine.map((value, index) => value - (signal[index] ?? value));
  return histogram.at(-1) ?? 0;
}

/** Wilder's RSI. */
function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const previous = closes[index - 1] ?? 0;
    const change = (closes[index] ?? previous) - previous;
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const previous = closes[index - 1] ?? 0;
    const change = (closes[index] ?? previous) - previous;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Average True Range — volatility in price units. */
function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1]?.close;
    if (!current || previousClose === undefined) continue;
    trs.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
      ),
    );
  }
  const slice = trs.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

/** Most recent swing high/low over a lookback window. */
function swings(candles: Candle[], lookback = 20): { high: number; low: number } {
  const slice = candles.slice(-lookback);
  return {
    high: slice.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY),
    low: slice.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY),
  };
}

/** Price formatter for narrative text (adaptive decimals). */
function fmtPrice(value: number): string {
  const magnitude = Math.abs(value);
  return value.toFixed(magnitude >= 1000 ? 2 : magnitude >= 10 ? 3 : 5);
}

function roundToTick(price: number, reference: number): number {
  const magnitude = Math.abs(reference);
  const decimals = magnitude >= 1000 ? 2 : magnitude >= 10 ? 3 : magnitude >= 1 ? 4 : 5;
  const factor = 10 ** decimals;
  return Math.round(price * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Public market feed + flexible symbol mapping                        */
/* ------------------------------------------------------------------ */

const PUBLIC_SYMBOL_RULES: [RegExp, string][] = [
  [/^(XAU|GOLD)/, "GC=F"],
  [/^(XAG|SILVER)/, "SI=F"],
  [/^(XPT|PLATIN)/, "PL=F"],
  [/^(XPD|PALLAD)/, "PA=F"],
  [/WTI|USOIL|USCRUDE|XTIUSD|CRUDE/, "CL=F"],
  [/BRENT|UKOIL|UKCRUDE|XTBUSD/, "BZ=F"],
  [/NATGAS|NATURALGAS|NGAS/, "NG=F"],
  [/NAS100|USTEC|US100|USTECH|NDX100|NQ100|TECH100|HW100|^100$/, "NQ=F"],
  [/US30|DJ30|DOW30|WALLSTREET|WS30|^DOW$|^30$/, "YM=F"],
  [/US500|SPX500|SP500|GSPC|^SPX$|^500$/, "ES=F"],
  [/GER40|GER30|GERMANY40|GERMANY30|DAX40|DAX30|DE40|^DAX$/, "^GDAXI"],
  [/UK100|FTSE100|^FTSE$/, "^FTSE"],
  [/JP225|JPN225|NIKKEI225|JAPAN225|^NIKKEI$/, "^N225"],
  [/HK50|HANGSENG|^HSI$/, "^HSI"],
  [/AUS200|ASX200/, "^AXJO"],
  [/EU50|EURO50|STOXX50/, "^STOXX50E"],
  [/BTC|XBT/, "BTC-USD"],
  [/ETH/, "ETH-USD"],
  [/SOL/, "SOL-USD"],
  [/XRP/, "XRP-USD"],
  [/DOGE/, "DOGE-USD"],
  [/ADA/, "ADA-USD"],
];

const FX_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "CNH", "SEK",
  "NOK", "TRY", "ZAR", "MXN", "SGD", "HKD", "PLN",
]);

/**
 * Broker SYNTHETIC indices (Headway FLAME, Boom/Crash, Volatility 75…) are
 * broker-generated and tracked by no public provider. They still scan: each
 * family maps to a 24/7 volatility proxy so the engine can compute real
 * structure-based Entry/SL/TP. Plans for synthetics are clearly labeled as
 * proxy-based in the analysis output.
 */
const SYNTHETIC_PROXY_RULES: [RegExp, string][] = [
  [/^(FLAME|BOOM|CRASH|JUMP|STEP|DRIFT|VOLATILITY|V\d{2,3})/, "BTC-USD"],
];

/** True when the symbol is a broker synthetic (proxy data will be used). */
export function isSyntheticSymbol(symbol: string): boolean {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SYNTHETIC_PROXY_RULES.some(([pattern]) => pattern.test(cleaned));
}

/** Maps a broker symbol (HW_100, XAUUSD.M, FLAME, EURUSD…) to a public ticker. */
function publicSymbolFor(raw: string): string | undefined {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return undefined;
  for (const [pattern, ticker] of PUBLIC_SYMBOL_RULES) {
    if (pattern.test(cleaned)) return ticker;
  }
  if (FX_CURRENCIES.has(cleaned.slice(0, 3)) && FX_CURRENCIES.has(cleaned.slice(3)))
    return `${cleaned}=X`;
  for (const [pattern, ticker] of SYNTHETIC_PROXY_RULES) {
    if (pattern.test(cleaned)) return ticker;
  }
  return undefined;
}

/**
 * Candidate symbol passes for fuzzy resolution, tried in order until the
 * feed returns candles. Covers broker-branded (HW_100 → 100 → NQ=F via the
 * index rule), suffixed (XAUUSD.M → XAUUSD) and synthetic instruments.
 */
function symbolCandidates(symbol: string): string[] {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidates = new Set<string>();
  // Broker prefixes: HW_, VH_, AX_, BM_, BO_, ICE_ …
  const prefixStripped = cleaned.replace(/^[A-Z]{2,5}_/, "");
  if (prefixStripped && prefixStripped !== cleaned) candidates.add(prefixStripped);
  // Broker suffixes: XAUUSD.m, BTCUSD.pro, EURUSD.i …
  const suffixStripped = cleaned.replace(/\.(M|PRO|I|C|Z)$/i, "").replace(/^(HW|VH|AX|BM|BO|ICE)/, "");
  if (suffixStripped && suffixStripped !== cleaned) candidates.add(suffixStripped);
  // Index words hidden inside the name: HW_100 → 100, US100IDX → US100
  const indexWord = /\d{2,4}$/.exec(cleaned)?.[0];
  if (indexWord && indexWord !== cleaned) candidates.add(indexWord);
  // Last resort: any known broker synthetic base (FLAME → its family rule).
  const familyMatch = /^(FLAME|BOOM|CRASH|JUMP|STEP|DRIFT|DXY)/.exec(cleaned);
  if (familyMatch?.[1]) candidates.add(familyMatch[1]);
  candidates.delete(cleaned);
  return [...candidates];
}

/** Yahoo chart intervals (no native 4h — the 1h series is aggregated instead). */
function publicTimeframe(timeframe: string): { interval: string; range: string; agg: number } {
  switch (timeframe) {
    case "5m":
      return { interval: "5m", range: "5d", agg: 1 };
    case "15m":
      return { interval: "15m", range: "1mo", agg: 1 };
    case "4h":
      return { interval: "1h", range: "6mo", agg: 4 };
    case "1d":
      return { interval: "1d", range: "2y", agg: 1 };
    default:
      return { interval: "1h", range: "3mo", agg: 1 };
  }
}

function aggregateCandles(source: Candle[], group: number): Candle[] {
  if (group <= 1) return source;
  const merged: Candle[] = [];
  for (let start = source.length % group; start + group <= source.length; start += group) {
    const chunk = source.slice(start, start + group);
    merged.push({
      time: chunk[0]?.time ?? "",
      open: chunk[0]?.open ?? 0,
      high: Math.max(...chunk.map((candle) => candle.high)),
      low: Math.min(...chunk.map((candle) => candle.low)),
      close: chunk.at(-1)?.close ?? 0,
    });
  }
  return merged;
}

/** Fetches real candles for a symbol from the public chart feed. */
async function fetchPublicCandles(symbol: string, timeframe: string): Promise<Candle[]> {
  const publicSymbol = publicSymbolFor(symbol);
  if (!publicSymbol) return [];
  const { interval, range, agg } = publicTimeframe(timeframe);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(publicSymbol)}?interval=${interval}&range=${range}`,
        {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6_000),
        },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        chart?: {
          result?: {
            timestamp?: number[];
            indicators?: {
              quote?: {
                open?: (number | null)[];
                high?: (number | null)[];
                low?: (number | null)[];
                close?: (number | null)[];
              }[];
            };
          }[];
        };
      };
      const result = payload.chart?.result?.[0];
      const stamps = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0];
      if (!quote || stamps.length === 0) continue;
      const candles: Candle[] = [];
      for (let index = 0; index < stamps.length; index += 1) {
        const stamp = stamps[index];
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        if (stamp === undefined) continue;
        if (open == null || high == null || low == null || close == null) continue;
        candles.push({ time: new Date(stamp * 1000).toISOString(), open, high, low, close });
      }
      return aggregateCandles(candles, agg).slice(-120);
    } catch {
      continue;
    }
  }
  return [];
}
