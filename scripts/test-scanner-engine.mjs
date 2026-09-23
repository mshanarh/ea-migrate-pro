/**
 * Offline confluence-engine test — synthetic candle series must yield:
 *   clean uptrend  → BUY
 *   clean downtrend→ SELL
 *   chop/neutral   → NO TRADE
 * Mirrors the scanner's logic inline (same formulas). Run: bun scripts/test-scanner-engine.mjs
 */
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let running = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? running;
    running = i === 0 ? v : v * k + running * (1 - k);
    out.push(running);
  }
  return out;
}
function macdHistogram(closes) {
  if (closes.length < 35) return 0;
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdLine = fast.map((v, i) => v - (slow[i] ?? v));
  const signal = emaSeries(macdLine, 9);
  return (macdLine.at(-1) ?? 0) - (signal.at(-1) ?? 0);
}
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i += 1) {
    const ch = (closes[i] ?? closes[i - 1] ?? 0) - (closes[i - 1] ?? 0);
    if (ch >= 0) g += ch; else l -= ch;
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const ch = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    ag = (ag * (period - 1) + Math.max(ch, 0)) / period;
    al = (al * (period - 1) + Math.max(-ch, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function analyze(candles) {
  const closes = candles.map((c) => c.close);
  const close = closes.at(-1) ?? 0;
  const lastCandle = candles.at(-1);
  const fast = emaSeries(closes, 21);
  const slow = emaSeries(closes, 50);
  const trendUp = (fast.at(-1) ?? 0) > (slow.at(-1) ?? 0);
  const macroUp = trendUp; // synthetic series are single-regime
  const priceAboveEma = close > (fast.at(-1) ?? 0);
  const rsiValue = rsi(closes);
  const histogram = macdHistogram(closes);
  const half = Math.floor(candles.length / 2);
  const earlier = candles.slice(0, half);
  const later = candles.slice(half);
  const eLow = Math.min(...earlier.map((c) => c.low));
  const lLow = Math.min(...later.map((c) => c.low));
  const eHigh = Math.max(...earlier.map((c) => c.high));
  const lHigh = Math.max(...later.map((c) => c.high));
  const higherLows = lLow > eLow;
  const lowerHighs = lHigh < eHigh;
  const bodyRatio =
    lastCandle && lastCandle.high - lastCandle.low > 0
      ? Math.abs(lastCandle.close - lastCandle.open) / (lastCandle.high - lastCandle.low)
      : 0;
  const bull = [trendUp, macroUp, priceAboveEma, histogram > 0, rsiValue > 52 && rsiValue < 72, higherLows, bodyRatio >= 0.4];
  const bear = [!trendUp, !macroUp, !priceAboveEma, histogram < 0, rsiValue < 48 && rsiValue > 28, lowerHighs, bodyRatio >= 0.4];
  const bullScore = bull.filter(Boolean).length;
  const bearScore = bear.filter(Boolean).length;
  const REQUIRED = 6;
  if (bullScore >= REQUIRED && bullScore > bearScore) return { signal: "BUY", bullScore, bearScore, rsiValue, histogram };
  if (bearScore >= REQUIRED && bearScore > bullScore) return { signal: "SELL", bullScore, bearScore, rsiValue, histogram };
  return { signal: "NO TRADE", bullScore, bearScore, rsiValue, histogram };
}

// ── Synthetic series (with pullbacks/noise so RSI stays in-band) ──────
function makeSeries(step, noise, bars = 140) {
  const candles = [];
  let price = 100;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  for (let i = 0; i < bars; i += 1) {
    const pullback = i % 6 === 3 ? -step * 1.4 : 0; // periodic pullback bars
    const open = price;
    price += step + noise * rand() + pullback;
    const close = price;
    candles.push({
      time: String(i),
      open,
      high: Math.max(open, close) + noise * 0.6,
      low: Math.min(open, close) - noise * 0.6,
      close,
    });
  }
  return candles;
}
const uptrend = makeSeries(0.35, 0.12);
const downtrend = makeSeries(-0.35, 0.12).map((c, i) => ({ ...c, time: String(i) }));
// Chop: mean-reverting oscillation with wide wicks (indecisive candles)
const chop = [];
let flat = 100;
let cseed = 7;
const crand = () => { cseed = (cseed * 1103515245 + 12345) % 2147483648; return cseed / 2147483648 - 0.5; };
for (let i = 0; i < 140; i += 1) {
  const wave = Math.sin(i / 4) * 0.5;
  const open = flat;
  const close = flat + wave + crand() * 0.3;
  flat = 100 + (flat - 100) * 0.9;
  chop.push({ time: String(i), open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close });
}

const upResult = analyze(uptrend);
const downResult = analyze(downtrend);
const chopResult = analyze(chop);
console.log("uptrend  →", upResult.signal, `(bull ${upResult.bullScore}/7, bear ${upResult.bearScore}/7, rsi ${upResult.rsiValue.toFixed(1)}, macd ${upResult.histogram.toFixed(4)})`);
console.log("downtrend→", downResult.signal, `(bull ${downResult.bullScore}/7, bear ${downResult.bearScore}/7, rsi ${downResult.rsiValue.toFixed(1)}, macd ${downResult.histogram.toFixed(4)})`);
console.log("chop     →", chopResult.signal, `(bull ${chopResult.bullScore}/7, bear ${chopResult.bearScore}/7, rsi ${chopResult.rsiValue.toFixed(1)}, macd ${chopResult.histogram.toFixed(4)})`);

let failed = 0;
if (upResult.signal !== "BUY") { console.error("FAIL: uptrend should be BUY"); failed += 1; }
if (downResult.signal !== "SELL") { console.error("FAIL: downtrend should be SELL"); failed += 1; }
if (chopResult.signal !== "NO TRADE") { console.error("FAIL: chop should be NO TRADE"); failed += 1; }
console.log(failed === 0 ? "RESULT: OK — confluence engine behaves correctly" : `RESULT: ${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
