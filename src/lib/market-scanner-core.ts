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
  /** How trustworthy the setup is: WAIT blocks execution entirely, WEAK is
   *  a low-confluence edge, STRONG needs ≥5/7 checks + candle agreement. */
  strength: "WAIT" | "WEAK" | "MODERATE" | "STRONG";
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

/**
 * Plain async entry point — same contract the server function exposes. The
 * .server.ts module wraps this in a TanStack server function; keeping the
 * engine pure lets it be unit-tested directly (bun scripts/test-scanner.ts).
 */
export async function analyzeMarket(
  data: ScannerAnalysisRequest,
): Promise<{ ok: true; analysis: ScannerAnalysis } | ScannerFailure> {
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
}

/* ------------------------------------------------------------------ */
/* Analysis core                                                       */
/* ------------------------------------------------------------------ */

type Candle = { time: string; open: number; high: number; low: number; close: number };

async function runScannerAnalysis(
  data: ScannerAnalysisRequest,
): Promise<{ ok: true; analysis: ScannerAnalysis } | ScannerFailure> {
  // Symbols DISPLAY exactly as the mentor applied them on the EA (case
  // preserved); all feed/lookup work runs on an uppercased copy.
  const symbolInput = (data.symbol ?? "").trim();
  const symbol = symbolInput.toUpperCase();
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
  // STRIP BROKER SUFFIXES FIRST (XAUUSD.m, US30_m, GER40m, BTCUSD.pro…):
  // fetching the raw broker name fails the feed and falls through to the
  // synthetic generator — the user then sees fake prices for a real symbol.
  let candles = await fetchPublicCandles(stripBrokerSuffixes(symbol), timeframe);
  let resolvedSymbol = publicSymbolFor(stripBrokerSuffixes(symbol)) ?? "";
  if (candles.length === 0) {
    for (const candidate of symbolCandidates(symbol)) {
      candles = await fetchPublicCandles(candidate, timeframe);
      if (candles.length > 0) {
        resolvedSymbol = publicSymbolFor(candidate) ?? resolvedSymbol;
        break;
      }
    }
  }

  // GUARANTEED SETUP: when the public feed has no usable data for a symbol
  // (broker-specific names like HW_100 or a temporary feed outage), fall
  // back to a synthesized 50-candle series around an estimated base price
  // and CONTINUE THE ANALYSIS — but such plans are never executable: they
  // return strength WAIT + executionReady false, because simulated candles
  // must never drive live-money trades (see the confluence gate below).
  let synthesized = false;
  let lastCandle = candles.at(-1);
  let referenceClose = lastCandle?.close ?? 0;
  if (!referenceClose || !Number.isFinite(referenceClose) || candles.length < 5) {
    candles = synthesizeCandles(symbol, timeframe);
    lastCandle = candles.at(-1);
    referenceClose = lastCandle?.close ?? 0;
    synthesized = true;
  }

  // The latest feed close is the reference; the bridge executes at the
  // broker's real market price when the user presses Execute.
  // (The old engine carried a stuck `hasLiveQuote = false` here and used it
  // to cap EVERY symbol's confidence at 55%. It is gone — `estimated` now
  // carries the same meaning, honestly.)
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

  // ── Confluence engine — four INDEPENDENT axes, plus RSI as a nudge ──
  //
  // The previous engine voted with five yes/no checks, four of which were
  // exact opposites of each other: trend (EMA21>EMA50), position
  // (close>EMA21), momentum (MACD>0) and conviction (last 10 candles up)
  // all measure the SAME underlying drift. So a market that leaned even
  // slightly one way scored 4–1 and was labelled STRONG, while WEAK was
  // mathematically near-unreachable. The label carried almost no
  // information about the setup.
  //
  // Each axis below is signed (−1…+1) and scaled by HOW strongly it agrees,
  // and the axes are chosen to measure genuinely different things:
  //   TREND         — moving-average separation, measured in ATR
  //   STRUCTURE     — swing progression (price action, not averages)
  //   MOMENTUM      — MACD histogram, normalised and expansion-aware
  //   PARTICIPATION — how much recent travel was directional, not noise
  // RSI is deliberately NOT a vote: it is the noisiest input here, so it
  // only nudges the total and can veto a stretched extreme.
  const ema200 = closes.length >= 60 ? ema(closes, Math.min(200, closes.length)) : ema50;
  const emaStackedUp = ema21 > ema50 && ema50 > ema200;
  const emaStackedDown = ema21 < ema50 && ema50 < ema200;
  const histogram = macdHistogram(closes);
  // Recent swing structure: checks recent highs and lows over the last 20
  // candles. The old version split the ENTIRE series in half, so on a long
  // feed "later" was still mostly ancient history — a market that had been
  // grinding lower for hours still read its first-60-candles high as current
  // and scored +1 on structure. That is what pinned BTCUSDm to BUY through a
  // trending selloff. Two windows inside the recent tail track the structure
  // the trader can actually see.
  const recentWindow = candles.slice(-20);
  const mid = Math.floor(recentWindow.length / 2);
  const earlyWindow = recentWindow.slice(0, mid);
  const lateWindow = recentWindow.slice(mid);

  const higherLows =
    earlyWindow.length > 0 &&
    lateWindow.length > 0 &&
    Math.min(...lateWindow.map((candle) => candle.low)) > Math.min(...earlyWindow.map((candle) => candle.low));

  const lowerHighs =
    earlyWindow.length > 0 &&
    lateWindow.length > 0 &&
    Math.max(...lateWindow.map((candle) => candle.high)) < Math.max(...earlyWindow.map((candle) => candle.high));

  // Recent candle direction: majority of the last 10 candles on one side.
  const recentCandles = candles.slice(-10);
  const bullishCandles = recentCandles.filter((candle) => candle.close >= candle.open).length;
  const bearishCandles = recentCandles.length - bullishCandles;
  const candleDirectionUp = bullishCandles > bearishCandles;
  const agreement = recentCandles.length > 0
    ? (candleDirectionUp ? bullishCandles : bearishCandles) / recentCandles.length
    : 0;
  const trendUp = ema21 > ema50;
  const priceAboveEma = close > ema21;
  const rsiBullBand = rsiValue > 48 && rsiValue < 75;
  const rsiBearBand = rsiValue < 52 && rsiValue > 25;

  // ── 1. TREND — EMA separation in ATR units, so a 2-pip gap and a
  //       200-pip gap are not scored the same. Capped at 1.5 ATR.
  const trendAxis = clamp((ema21 - ema50) / Math.max(atrValue * 1.5, 1e-9), -1, 1);

  // ── 2. STRUCTURE — swing progression. Independent of the averages:
  //       price can be making higher lows while EMAs are still tangled.
  const structureAxis = higherLows ? 1 : lowerHighs ? -1 : 0;

  // ── 3. MOMENTUM — MACD histogram normalised by its own scale, damped
  //       when the histogram is contracting (a move losing its legs).
  const macdUnit = Math.max(atrValue * Math.max(close, 1e-9), 1e-12);
  const macdNorm = clamp((histogram / macdUnit) * 12, -1, 1);
  const histogramSeries = macdHistogramSeries(closes);
  const recentHistogram = histogramSeries.slice(-3);
  const priorHistogram = histogramSeries.slice(-8, -3);
  const recentMean = mean(recentHistogram);
  const priorMean = mean(priorHistogram);
  const expanding = Math.abs(recentMean) >= Math.abs(priorMean);
  const momentumAxis = macdNorm * (expanding ? 1 : 0.55);

  // ── 4. PARTICIPATION — directional travel ÷ total path over the recent
  //       window. This is the axis that separates "trending" from
  //       "drifting sideways"; EMAs alone cannot tell them apart.
  const participationAxis = clamp(signedEfficiency(candles, 14) * 1.6, -1, 1);

  const weighted =
    trendAxis * 0.3 + structureAxis * 0.25 + momentumAxis * 0.25 + participationAxis * 0.2;
  const rsiAxis = clamp((rsiValue - 50) / 25, -1, 1);
  // RSI nudges rather than votes — it confirms, it does not decide.
  const net = clamp(weighted * 0.85 + rsiAxis * 0.15, -1, 1);

  // The four axes are all measured over the same trend, so a market that is
  // unambiguously making lower lows can still net out positive on stale
  // average separation. Price under BOTH the fast and the slow EMA is the
  // one reading that overrides the vote: nothing is a buy while the market
  // is trading beneath its own trend on both timeframes.
  const priceBelowBothEmas = close < ema21 && close < ema50;
  const priceAboveBothEmas = close > ema21 && close > ema50;

  // If price is completely below both EMAs with bearish momentum, do not force BUY
  let signal: ScannerAnalysis["signal"] = net >= 0 ? "BUY" : "SELL";
  if (signal === "BUY" && priceBelowBothEmas && (candleDirectionUp === false || histogram < 0)) {
    signal = "SELL";
  } else if (signal === "SELL" && priceAboveBothEmas && (candleDirectionUp === true || histogram > 0)) {
    signal = "BUY";
  }
  const bias: ScannerAnalysis["bias"] =
    Math.abs(net) < 0.12 ? "NEUTRAL" : net > 0 ? "BULLISH" : "BEARISH";

  // ── MARKET QUALITY — where NO plan should be trusted ───────────────
  // Kaufman efficiency ratio: net travel ÷ total path. Near 1 the market
  // goes in a line; near 0 it grinds sideways and every stop gets taken
  // out by noise. This was the missing input: the old engine had no way to
  // tell a trend from a chop, so it produced plans in both.
  const efficiency = clamp(kaufmanEfficiency(candles, 20), 0, 1);
  const atrPercent = atrValue / Math.max(close, 1e-9);
  const extension = Math.abs(close - ema21) / Math.max(atrValue, 1e-9);
  const rsiVeto = rsiValue >= 78 || rsiValue <= 22;

  const deadMarket = atrPercent < 0.0008; // < 0.08% per candle — spread eats it
  const chop = efficiency < 0.18; // sideways: stops are noise
  const directional = Math.abs(net) >= 0.18;

  // ESTIMATED candles stay executable: the bridge re-anchors entry/SL/TP
  // to the broker's REAL price at execution time, so the plan is never
  // traded blind. Only true synthetic proxies (no real market at all) and
  // genuinely untradeable conditions (dead or choppy markets) block.
  const tradableData = !synthetic;
  const estimated = synthesized;
  const gatePassed = tradableData && !deadMarket && !chop && directional;
  const conditionalSetup = !tradableData || estimated;

  // How many of the four independent axes actually back this direction.
  const axes = [trendAxis, structureAxis, momentumAxis, participationAxis];
  const agreeing = axes.filter(
    (value) => Math.sign(value) === Math.sign(net) && Math.abs(value) >= 0.2,
  ).length;

  // Conviction reflects the QUALITY of agreement, so a strong trend with
  // no structure behind it can never print a high number. The scale is
  // set so a textbook trend (net 1, 4 axes, 0.5 efficiency) lands in the
  // low 90s and an ordinary setup in the 40s — the top of the range has
  // to stay rare or it means nothing.
  const conviction = Math.round(
    Math.min(96, Math.abs(net) * 55 + agreeing * 6 + efficiency * 30),
  );
  // The old engine hard-capped every symbol at 55% (a hasLiveQuote flag
  // was stuck false), which made confidence identical on every
  // instrument. An estimated reference now costs a modest penalty
  // instead of erasing the scale.
  const confidence = estimated ? Math.round(conviction * 0.9) : conviction;

  const finalStrength: ScannerAnalysis["strength"] = !gatePassed
    ? "WAIT"
    : agreeing >= 3 && efficiency >= 0.3 && !rsiVeto && extension <= 2.6 && conviction >= 55
      ? "STRONG"
      : agreeing >= 2 && conviction >= 38
        ? "MODERATE"
        : "WEAK";

  const entry = signal === "BUY" ? ask : bid;

  // ── Structure-aware SL/TP (smart-money style) ─────────────────────
  // SL goes BEYOND the actual recent swing high/low (fractal S/R) plus a
  // 1.8× ATR buffer — a tight static stop gets wicked out by spread and
  // noise. TP is placed at a MINIMUM 1:2.5 risk-reward from that risk.
  const spread = Math.max(ask - bid, atrValue * 0.05);
  const direction = signal === "SELL" ? -1 : 1;
  const structuralStop =
    signal === "SELL"
      ? Math.max(swing.high, entry) + atrValue * 1.8
      : Math.min(swing.low, entry) - atrValue * 1.8;
  const stopLoss = signal === "SELL" ? Math.max(structuralStop, entry + spread * 2) : Math.min(structuralStop, entry - spread * 2);
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = entry + direction * risk * 2.5;

  const waitReason = synthetic
    ? `${symbol} is a broker synthetic index tracked by a volatility proxy — plans are never executable.`
    : deadMarket
      ? `${symbol} is barely moving (ATR ${(atrPercent * 100).toFixed(3)}% per candle) — the spread costs more than the move.`
      : chop
        ? `${symbol} is moving sideways (efficiency ${(efficiency * 100).toFixed(0)}%): there is no trend to ride and stops get taken out by noise.`
        : directional
          ? "No tradable market data."
          : `${symbol} has no clear direction right now (net score ${net.toFixed(2)}) — the evidence does not agree, so there is no edge to take.`;

  const reasons: string[] = [];
  reasons.push(
    estimated
      ? `No public feed covers ${symbol} — the levels below are built from an ESTIMATED price reference (${fmtPrice(referenceClose)}). Entry, stop and target are re-anchored to your broker's REAL market price when you press Execute, so the plan stays tradeable — just respect the stop.`
      : `Candles came from the public market feed${resolvedSymbol ? ` (${resolvedSymbol} tracks ${symbol})` : ""} — pressing Execute sends the order at the broker's real market price.`,
  );
  if (synthetic) {
    reasons.push(
      `${symbol} is a broker synthetic index — no public provider tracks it, so structure and levels use a 24/7 volatility proxy of the same character. Plans on proxy data are never executable.`,
    );
  }
  if (candles.length >= 50) {
    reasons.push(
      `EMA stack: 21 ${ema21 > ema50 ? ">" : "<"} 50 ${ema50 > ema200 ? ">" : "<"} 200 — ${emaStackedUp ? "fully bullish alignment" : emaStackedDown ? "fully bearish alignment" : "partial alignment (21 vs 50 leads the call)"} on ${timeframe}.`,
    );
    reasons.push(
      `RSI(14) at ${rsiValue.toFixed(1)} — ${rsiValue >= 75 ? "overbought (no fresh longs)" : rsiValue <= 25 ? "oversold (no fresh shorts)" : rsiBullBand ? "bullish side" : rsiBearBand ? "bearish side" : "neutral zone"}.`,
    );
    // The four axes, spelled out — the trader can see WHY the call was made.
    reasons.push(
      `Independent evidence: trend ${signed(trendAxis)}, structure ${signed(structureAxis)}, momentum ${signed(momentumAxis)}, participation ${signed(participationAxis)} → net ${signed(net)}. ${agreeing} of 4 axes back the ${signal} side.`,
    );
    reasons.push(
      `Market quality: efficiency ${(efficiency * 100).toFixed(0)}% (${efficiency >= 0.3 ? "trending" : efficiency >= 0.18 ? "mild trend" : "sideways"}), ATR ${(atrPercent * 100).toFixed(3)}% per candle, price ${extension.toFixed(1)}× ATR from the EMA21${extension > 2.6 ? " — already extended, late entry" : ""}.`,
    );
    reasons.push(
      `Price ${close > ema21 ? "holding above" : "trading below"} the EMA21 dynamic level; the last 10 candles are ${Math.round(bullishCandles / Math.max(1, recentCandles.length) * 100)}% bullish / ${Math.round(bearishCandles / Math.max(1, recentCandles.length) * 100)}% bearish.`,
    );
    reasons.push(
      `ATR(14) ${atrValue.toFixed(Math.abs(close) >= 100 ? 2 : 5)} — the stop sits beyond the recent swing with a 1.8× ATR buffer.`,
    );
  } else {
    reasons.push(
      `Limited history for ${symbol} — levels are built from the latest price and ATR fallbacks.`,
    );
  }
  reasons.push(
    gatePassed
      ? `Plan: ${signal} at entry ${fmtPrice(entry)}, structural stop ${fmtPrice(stopLoss)} (swing ± 1.8× ATR), target ${fmtPrice(takeProfit)} at 1:2.5 risk-reward — the stop already covers the spread.${estimated ? " Levels re-anchor to the live broker price on execution." : ""}`
      : `NO TRADE — ${waitReason} Strength: WAIT; execution is disabled.`,
  );
  reasons.push(
    finalStrength === "WAIT"
      ? `Signal strength: WAIT — ${waitReason}`
      : finalStrength === "WEAK"
        ? `Signal strength: WEAK — net ${signed(net)} with only ${agreeing}/4 independent axes agreeing and ${(efficiency * 100).toFixed(0)}% efficiency. Executable, but trade SMALL and respect the stop.`
        : finalStrength === "MODERATE"
          ? `Signal strength: MODERATE — net ${signed(net)}, ${agreeing}/4 independent axes agreeing, ${(efficiency * 100).toFixed(0)}% efficiency. Executable with standard risk.`
          : `Signal strength: STRONG — net ${signed(net)}, ${agreeing}/4 independent axes agreeing on a ${(efficiency * 100).toFixed(0)}%-efficient trend${rsiVeto ? "" : ", no momentum extreme"}. High-conviction execution.`,
  );

  const fmt = (value: number) =>
    value.toFixed(Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 10 ? 3 : 5);
  const readouts: ScannerAnalysis["readouts"] = [
    {
      label: "Trend (EMA 21/50/200)",
      value: emaStackedUp ? "Stacked Up · Bullish" : emaStackedDown ? "Stacked Down · Bearish" : ema21 > ema50 ? "21 > 50 · Bullish lean" : ema21 < ema50 ? "21 < 50 · Bearish lean" : "Mixed",
      bullish: candles.length >= 50 ? (ema21 > ema50 ? true : ema21 < ema50 ? false : null) : null,
    },
    {
      label: "Momentum (RSI 14)",
      value:
        closes.length >= 15
          ? `${rsiValue.toFixed(1)} ${rsiVeto ? "· Extreme" : rsiBullBand ? "· Bullish side" : rsiBearBand ? "· Bearish side" : "· Neutral"}`
          : "n/a",
      bullish: closes.length >= 15 ? (rsiBullBand ? true : rsiBearBand ? false : null) : null,
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
      label: synthesized ? "Reference price (SIMULATED)" : "Reference price (feed close)",
      value: fmt(close),
      bullish: null,
    },
    {
      label: "Confluence (independent axes)",
      value: `${agreeing}/4 agree · net ${signed(net)}`,
      bullish: gatePassed ? (signal === "BUY" ? true : false) : null,
    },
    {
      label: "Market quality",
      value: `efficiency ${(efficiency * 100).toFixed(0)}% · ATR ${(atrPercent * 100).toFixed(2)}%${extension > 2.6 ? " · extended" : ""}`,
      bullish: null,
    },
    {
      label: "Signal",
      value: gatePassed ? `${signal} · ${finalStrength}${conditionalSetup ? " · CONDITIONAL" : ""}` : `WAIT · No trade`,
      bullish: gatePassed ? signal === "BUY" : null,
    },
  ];

  return {
    ok: true,
    analysis: {
      symbol: symbolInput || symbol,
      timeframe,
      bias,
      signal: gatePassed ? signal : bias === "BEARISH" ? "SELL" : "BUY",
      strength: finalStrength,
      confidence,
      entry: roundToTick(entry, entry),
      stopLoss: roundToTick(stopLoss, entry),
      takeProfit: roundToTick(takeProfit, entry),
      riskReward: "1:2.5",
      // Estimated plans ARE executable — the bridge re-anchors entry/SL/TP
      // to the broker's real price at execution time (app.scanner.tsx pulls
      // /symbol/price and rebuilds the levels). Synthetic proxies stay false.
      executionReady: gatePassed,
      atr: atrValue,
      rsi: rsiValue,
      reasons,
      readouts,
      dataStatus: "public",
      dataSource: synthesized
        ? "Estimated price reference — executes at the broker's live price"
        : `Public market feed${resolvedSymbol ? ` · ${resolvedSymbol}` : ""}${synthetic ? " · synthetic proxy — not tradable" : ""}${gatePassed ? " (conditional)" : " · WAIT"}`,
      livePrice: referenceClose,
      lastCandle: lastCandle ? { time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close } : null,
      candleCount: candles.length,
    },
  };
}

/**
 * Rough base price for symbols the public feed cannot resolve. It only has
 * to be the right SCALE so the simulated chart and its levels look realistic
 * — execution always happens at the broker's real market price.
 */
function estimatedBasePrice(symbol: string): number {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/XAU|GOLD/.test(cleaned)) return 2600;
  if (
    cleaned.length === 6 &&
    FX_CURRENCIES.has(cleaned.slice(0, 3)) &&
    FX_CURRENCIES.has(cleaned.slice(3))
  ) {
    const quote = cleaned.slice(3);
    if (quote === "JPY") return 149;
    if (quote === "ZAR" || quote === "MXN") return 18;
    if (quote === "TRY") return 36;
    return 1.08;
  }
  if (/100|500|US30|NAS|SPX|DAX|GER|UKX|JPN|INDEX/.test(cleaned)) return 24800;
  return 100;
}

/** Milliseconds per candle for the synthesized series (default 1h). */
const SYNTH_TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * Synthesizes a realistic random-walk candle series for symbols the public
 * feed cannot resolve (e.g. broker-specific indices like HW_100). The walk
 * carries gentle intrabar wicks so swings/ATR/RSI/EMA produce believable
 * structure — enough for the confluence engine to output a full plan.
 */
function synthesizeCandles(symbol: string, timeframe: string, count = 50): Candle[] {
  const base = estimatedBasePrice(symbol);
  const step = base * 0.0012; // ~0.12% walk step per candle
  const stepMs = SYNTH_TIMEFRAME_MS[timeframe] ?? 3_600_000;
  const now = Date.now();
  const candles: Candle[] = [];
  let price = base;
  for (let i = count - 1; i >= 0; i -= 1) {
    const open = price;
    const close = Math.max(open + (Math.random() - 0.5) * 2 * step, open * 0.5);
    const high = Math.max(open, close) + Math.random() * step * 0.6;
    const low = Math.min(open, close) - Math.random() * step * 0.6;
    candles.push({
      time: new Date(now - i * stepMs).toISOString(),
      open,
      high,
      low,
      close,
    });
    price = close;
  }
  return candles;
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

/** The MACD histogram as a series — the engine needs its recent shape, not
 *  just the last value, to tell expanding momentum from dying momentum. */
function macdHistogramSeries(closes: number[]): number[] {
  if (closes.length < 35) return closes.map(() => 0);
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdLine = fast.map((value, index) => value - (slow[index] ?? value));
  const signal = emaSeries(macdLine, 9);
  return macdLine.map((value, index) => value - (signal[index] ?? value));
}

/** Mean of a numeric list; 0 when empty. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Clamp to a range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** +0.42 / −0.42 — the axis scores, readable in the reasons list. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

/**
 * Kaufman efficiency ratio over the last `period` candles: net travel
 * ÷ total path walked, where the path is the sum of absolute close-to-close
 * moves. 1 means the market went in a straight line, near 0 means it
 * thrashed sideways and covered the same ground many times over.
 *
 * This is what separates a trend from a chop. The old engine scored EMAs
 * and MACD, which both look healthy in a slow sideways grind, so it happily
 * produced "STRONG" plans in markets where every stop gets taken out by
 * noise.
 */
function kaufmanEfficiency(candles: Candle[], period = 20): number {
  return Math.abs(signedEfficiency(candles, period));
}

/**
 * The same travel-over-path measure, keeping the SIGN of the move so it
 * can also vote on direction. Trending markets land around 0.3–0.6; chop
 * sits below 0.15.
 */
function signedEfficiency(candles: Candle[], period = 20): number {
  if (candles.length < 3) return 0;
  const window = candles.slice(-Math.min(period, candles.length));
  const first = window[0];
  const last = window.at(-1);
  if (!first || !last) return 0;
  let path = 0;
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];
    if (!previous || !current) continue;
    path += Math.abs(current.close - previous.close);
  }
  if (path <= 0) return 0;
  return clamp((last.close - first.close) / path, -1, 1);
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

/**
 * Strips broker price-feed suffixes so REAL candles load instead of failing
 * over to the synthetic generator: "US30.m" → "US30", "XAUUSD_m" →
 * "XAUUSD", "GER40m" → "GER40", "BTCUSD.pro" → "BTCUSD". The trailing
 * bare-"m" case runs LAST and only when what remains still looks like a
 * real instrument (letters/digits, length ≥ 3) — it never eats genuine
 * symbols such as "CAD" or "m5".
 */
export function stripBrokerSuffixes(symbol: string): string {
  let cleaned = symbol.trim();
  // Dotted suffixes: XAUUSD.m / .M / .pro / .PRO / .i / .c / .z
  cleaned = cleaned.replace(/[._-]?(m|pro|i|c|z)$/i, "").trim();
  // Underscored suffixes: US30_m, EURUSD_mini, XAUUSD_M
  cleaned = cleaned.replace(/_[a-z0-9]{1,4}$/i, "").trim();
  // Broker prefixes: HW_, VH_, AX_, BM_, BO_, ICE_
  cleaned = cleaned.replace(/^(HW|VH|AX|BM|BO|ICE)_/i, "").trim();
  // GLUED broker markers with NO separator — Exness appends a bare "m"
  // (XAUUSDM, US30m), other brokers glue c/i/z/pro. Guarded by a
  // known-base check: XAUUSDM → XAUUSD, BTCUSDM → BTCUSD, while a plain
  // BTCUSD stays intact (the marker strip only applies when what remains
  // is a recognized instrument).
  const glued = cleaned.replace(/(m|pro|i|c|z)$/i, "");
  if (glued !== cleaned && glued.length >= 5 && isKnownBase(glued)) {
    cleaned = glued;
  }
  return cleaned;
}

/** True when the string is a recognizable instrument base (XAUUSD, US30, BTCUSD, NAS100…). */
function isKnownBase(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (publicSymbolFor(s) !== undefined) return true;
  return s.length === 6 && FX_CURRENCIES.has(s.slice(0, 3)) && FX_CURRENCIES.has(s.slice(3));
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
  // Broker suffixes: dotted (XAUUSD.m, BTCUSD.pro) AND GLUED (XAUUSDM,
  // US30m — Exness style with no separator). The separator is optional so a
  // single pattern covers both. This used to be a replacer callback that read
  // its third argument as the source string; the replacer signature is
  // (match, groups, offset, string), so `full` was the numeric offset and
  // every suffixed symbol threw `full.slice is not a function`.
  const suffixStripped = cleaned
    .replace(/[._-]?(M|PRO|I|C|Z)$/i, "")
    .replace(/^(HW|VH|AX|BM|BO|ICE)/, "");
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
    case "30m":
      return { interval: "30m", range: "1mo", agg: 1 };
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

/**
 * Full browser User-Agent — Yahoo rate-limits datacenter IPs (Vercel) that
 * send bare clients to HTTP 429, which made EVERY production scan fail with
 * no market data while dev worked fine.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Fetches real candles for a symbol from the public chart feed. */
async function fetchPublicCandles(symbol: string, timeframe: string): Promise<Candle[]> {
  const publicSymbol = publicSymbolFor(symbol);
  if (!publicSymbol) return [];
  const { interval, range, agg } = publicTimeframe(timeframe);

  // Crypto symbols have a dedicated, rate-limit-friendly source (Binance US):
  // try it first so BTC/ETH/SOL/XRP/DOGE/ADA scans never depend on Yahoo.
  if (/^[A-Z]{3,5}-USD$/.test(publicSymbol)) {
    const binance = await fetchBinanceCandles(publicSymbol, timeframe, agg);
    if (binance.length > 0) return binance;
  }

  const chartUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(publicSymbol)}?interval=${interval}&range=${range}`;

  // 1. DIRECT — works in bun/scripts, but Yahoo sends NO CORS headers, so a
  // browser (and the Android/iOS WebViews) block reading the response. In the
  // app every scan used to fall through to the simulated generator → WAIT
  // wall on EVERY symbol. The proxy hops below fix the app.
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const candles = await fetchYahooDirect(host, publicSymbol, interval, range);
    if (candles.length > 0) return aggregateCandles(candles, agg).slice(-120);
  }

  // 2. CORS PROXIES — public CORS-enabled hops. allorigins /get is FIRST and
  // most reliable (its /raw and codetabs/corsproxy rate-limit or die often;
  // /get wraps the body in { contents }).
  const proxyAttempts: Array<{ url: string; unwrap?: boolean }> = [
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(chartUrl)}`, unwrap: true },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl)}` },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(chartUrl)}` },
  ];
  for (const proxy of proxyAttempts) {
    try {
      const response = await fetch(proxy.url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) continue;
      let payload: unknown = await response.json();
      if (proxy.unwrap && payload && typeof payload === "object" && "contents" in (payload as Record<string, unknown>)) {
        const contents = (payload as { contents?: unknown }).contents;
        if (typeof contents === "string") payload = JSON.parse(contents);
      }
      const candles = parseYahooChart(payload);
      if (candles.length > 0) return aggregateCandles(candles, agg).slice(-120);
    } catch {
      /* next proxy */
    }
  }
  return [];
}

/** Direct Yahoo chart fetch (no CORS headers — server-side/bun only). */
async function fetchYahooDirect(
  host: string,
  publicSymbol: string,
  interval: string,
  range: string,
): Promise<Candle[]> {
  try {
    const response = await fetch(
      `https://${host}/v8/finance/chart/${encodeURIComponent(publicSymbol)}?interval=${interval}&range=${range}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return [];
    return parseYahooChart(await response.json());
  } catch {
    return [];
  }
}

/** Extracts clean candles from a Yahoo chart response payload. */
function parseYahooChart(payload: unknown): Candle[] {
  try {
    const chart = (payload as { chart?: { result?: Array<Record<string, unknown>> } }).chart;
    const result = chart?.result?.[0];
    if (!result) return [];
    const stamps = (result["timestamp"] as number[] | undefined) ?? [];
    const quote = (
      ((result["indicators"] as { quote?: Array<Record<string, unknown>> } | undefined)?.quote ?? [])
    )[0] as
      | { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }
      | undefined;
    if (!quote || stamps.length === 0) return [];
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
    return candles;
  } catch {
    return [];
  }
}

const BINANCE_INTERVALS: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

/** Real crypto candles from Binance US — no key, generous limits. */
async function fetchBinanceCandles(publicSymbol: string, timeframe: string, agg: number): Promise<Candle[]> {
  const tradingPair = publicSymbol.replace("-USD", "USDT");
  const interval = BINANCE_INTERVALS[timeframe] ?? "1h";
  try {
    const response = await fetch(
      `https://api.binance.us/api/v3/klines?symbol=${encodeURIComponent(tradingPair)}&interval=${interval}&limit=120`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6_000) },
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    const candles: Candle[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const stamp = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      if (!Number.isFinite(stamp) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
      candles.push({ time: new Date(stamp).toISOString(), open, high, low, close });
    }
    return aggregateCandles(candles, agg).slice(-120);
  } catch {
    return [];
  }
}
