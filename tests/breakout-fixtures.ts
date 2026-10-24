/**
 * Broker candle series for the breakout tests.
 *
 * The bridge serves `mt5.copy_rates_from_pos(...)`, which is OLDEST-FIRST and
 * ends with the still-forming bar. `bridgeSeries` reproduces exactly that: N
 * range bars, one completed breakout bar, then a forming bar that the app must
 * drop from the END.
 */

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const BASE_TIME = 1_700_000_000;
export const BAR_SECONDS = 900;

/**
 * A series the OVEREXTENSION FILTER lets through.
 *
 * The filter refuses entries into an exhausted move, so a test about something
 * else (payload shapes, order comments, direction) needs a market that is
 * actually tradeable: a gentle drift that stays inside 2 ATR of the 20-candle
 * average, a pullback bar at the end, and a final COMPLETED candle that closes
 * back in the signal's direction — with the live quote inside that pullback.
 *
 * `forming: true` appends the still-forming bar every real bridge payload has,
 * which the app drops from the END.
 */
export function pullbackSeries(input: {
  direction?: "BUY" | "SELL";
  bars?: number;
  base?: number;
  forming?: boolean;
} = {}): { candles: Candle[]; closes: number[]; bid: number; ask: number } {
  const direction = input.direction ?? "BUY";
  const bars = input.bars ?? 21;
  const base = input.base ?? 1.1;
  const sign = direction === "BUY" ? 1 : -1;
  // Proportions of the price, so the same helper serves AUDUSD and US30.
  const drift = base * 0.00008;
  const pad = base * 0.0004;
  const round = (value: number) => Number(value.toFixed(5));

  const closes: number[] = [];
  for (let i = 0; i < bars; i += 1) closes.push(round(base + sign * drift * i));

  // The impulse peaks, pulls back, then a completed candle closes with the
  // trend — the pullback + confirmation the entry filter requires.
  const peak = round(closes[bars - 3]! + sign * base * 0.0012);
  closes[bars - 3] = peak;
  closes[bars - 2] = round(peak - sign * base * 0.0008);
  closes[bars - 1] = round(peak - sign * base * 0.0004);

  const candles: Candle[] = closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      time: BASE_TIME + index * BAR_SECONDS,
      open,
      high: round(Math.max(open, close) + pad),
      low: round(Math.min(open, close) - pad),
      close,
      volume: 1000,
    };
  });

  if (input.forming) {
    const last = closes[closes.length - 1]!;
    candles.push({
      time: BASE_TIME + closes.length * BAR_SECONDS,
      open: last,
      high: last + 5,
      low: last - 5,
      close: last,
      volume: 10,
    });
  }

  const price = round(closes[bars - 1]! + sign * base * 0.00005);
  return { candles, closes, bid: round(price - base * 0.00005), ask: round(price + base * 0.00005) };
}

export function bridgeSeries(input: {
  /** Lowest low of the range bars. */
  low: number;
  /** Highest high of the range bars. */
  high: number;
  /**
   * Close of the newest COMPLETED bar. Outside [low, high] it is a candle-close
   * breakout; inside it the bar is part of the range and only a live price
   * break can signal.
   */
  breakoutClose: number;
  /** How many bars build the range (default 20, the strategy lookback). */
  bars?: number;
  /** Close of the still-forming bar appended last (dropped by the app). */
  formingClose?: number;
}): Candle[] {
  const bars = input.bars ?? 20;
  const out: Candle[] = [];
  for (let i = 0; i < bars; i += 1) {
    const nearLow = i % 2 === 0;
    out.push({
      time: BASE_TIME + i * BAR_SECONDS,
      open: nearLow ? input.low : input.high,
      high: input.high,
      low: input.low,
      close: nearLow ? input.high : input.low,
      volume: 1000,
    });
  }

  const breakoutTime = BASE_TIME + bars * BAR_SECONDS;
  out.push({
    time: breakoutTime,
    open: input.high,
    high: Math.max(input.high, input.breakoutClose),
    low: Math.min(input.low, input.breakoutClose),
    close: input.breakoutClose,
    volume: 2000,
  });

  const forming = input.formingClose ?? input.breakoutClose;
  out.push({
    time: breakoutTime + BAR_SECONDS,
    open: forming,
    high: forming + (input.high - input.low) * 2,
    low: forming - (input.high - input.low) * 2,
    close: forming,
    volume: 10,
  });

  return out;
}
