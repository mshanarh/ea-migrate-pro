import { describe, expect, it } from "vitest";
import {
  fiveBarTrendSign,
  readTrend,
  type BrokerCandle,
} from "@/lib/auto-trade";

/**
 * EMA 20/50/200 TREND ALIGNMENT.
 *
 * The failure this pins: a 3–5 bar bounce inside a violent downtrend produces a
 * POSITIVE net move, so the old 5-bar direction read bought the peak of the
 * retracement. The trend filter has to read DOWN from the EMA stack no matter
 * what the last five closes did.
 */
function series(
  closes: ReadonlyArray<number>,
  openOf?: (i: number, close: number) => number,
): BrokerCandle[] {
  return closes.map((close, i) => {
    const open = openOf ? openOf(i, close) : i === 0 ? close : closes[i - 1]!;
    return {
      time: 1_700_000_000 + i * 900,
      open,
      high: Math.max(open, close) + 0.0004,
      low: Math.min(open, close) - 0.0004,
      close,
      volume: 100,
    };
  });
}

/** A steady leg of `bars` closes, then a cumulative counter-move. */
function legThen(start: number, step: number, bars: number, tail: number[]): number[] {
  const leg = Array.from({ length: bars }, (_, i) => start + step * i);
  const last = leg[leg.length - 1]!;
  const moved: number[] = [];
  let value = last;
  for (const delta of tail) {
    value += delta;
    moved.push(Number(value.toFixed(5)));
  }
  return [...leg, ...moved];
}

describe("readTrend — EMA 20/50/200 filter", () => {
  it("confirms a downtrend and refuses BUY even when the last 5 bars are up", () => {
    const closes = legThen(1.2, -0.001, 236, [0.0015, 0.0015, 0.0015, 0.0015, 0.0015]);
    const candles = series(closes);
    const price = closes[closes.length - 1]!;

    expect(fiveBarTrendSign(candles.slice(-6))).toBe(1); // the old 5-bar read says BUY
    const trend = readTrend(candles, price);
    expect(trend?.trend).toBe("DOWN");
    expect(trend?.bias).toBe("SELL");
    expect(trend?.ema50).not.toBeNull();
    expect(trend!.ema20! < trend!.ema50!).toBe(true);
    expect(price < trend!.ema50!).toBe(true);
  });

  it("confirms an uptrend and refuses SELL even when the last 5 bars are down", () => {
    const closes = legThen(1.0, 0.001, 236, [-0.001, -0.001, -0.001, -0.001, -0.001]);
    const candles = series(closes);
    const price = closes[closes.length - 1]!;

    expect(fiveBarTrendSign(candles.slice(-6))).toBe(-1); // the old 5-bar read says SELL
    const trend = readTrend(candles, price);
    expect(trend?.trend).toBe("UP");
    expect(trend?.bias).toBe("BUY");
    expect(trend!.ema20! > trend!.ema50!).toBe(true);
    expect(price > trend!.ema50!).toBe(true);
  });

  it("measures EMA200 only when the series is long enough", () => {
    const longCloses = legThen(1.1, -0.0005, 240, []);
    expect(readTrend(series(longCloses), longCloses[longCloses.length - 1]!)?.ema200).not.toBeNull();

    const shortCloses = legThen(1.1, -0.0005, 70, []);
    const short = readTrend(series(shortCloses), shortCloses[shortCloses.length - 1]!);
    expect(short?.ema200).toBeNull();
    expect(short?.ema50).not.toBeNull();
  });

  it("flags retracement exhaustion on a bearish rejection below EMA20", () => {
    const closes = [...legThen(1.2, -0.001, 236, [0.0015, 0.0015, 0.0015, 0.0015]), 0.964];
    const candles = series(closes, (i, close) =>
      i === closes.length - 1 ? close + 0.0035 : i === 0 ? close : closes[i - 1]!,
    );
    const trend = readTrend(candles, 0.964);
    expect(trend?.trend).toBe("DOWN");
    expect(trend?.exhaustion).toBe(true);
  });

  it("leaves an unconfirmed market free (short series, no EMA50)", () => {
    const closes = legThen(1.1, 0.0002, 40, []);
    const trend = readTrend(series(closes), closes[closes.length - 1]!);
    expect(trend?.trend).toBeNull();
    expect(trend?.bias).toBeNull();
    expect(trend?.exhaustion).toBe(false);
  });
});
