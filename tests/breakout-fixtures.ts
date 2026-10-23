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
