/**
 * THE EXECUTION EVENT CONTRACT — one shape for every "eamp:execution-result"
 * the app dispatches.
 *
 * The bus already existed (the top toast, the floating bot popup and the
 * Android bubble all read it), but every producer filled it in differently:
 * the auto-trade path carried symbol/side/SL/TP, the scanner path carried
 * only a message, and nobody carried the robot name, the lot size or the
 * fill price. Anything that wanted to SHOW or SPEAK a trade therefore had
 * to guess — and a guessed price is a lie the trader cannot see.
 *
 * This module is the single normaliser:
 *   • it types the payload,
 *   • it reads ONLY values that are really present (a missing level stays
 *     missing — it is never invented, defaulted or estimated),
 *   • it derives the outcome from the event's own status,
 *   • it produces a stable signature so the same execution can never be
 *     announced twice.
 */

/** The DOM event every execution surface listens on. */
export const EXECUTION_EVENT = "eamp:execution-result";

export type ExecutionSide = "BUY" | "SELL";

/**
 * The real outcome of one order attempt.
 *  - "executed" — the broker confirmed the fill.
 *  - "failed"   — the broker refused the order.
 *  - "blocked"  — the engine refused to send it (no trade, stale setup).
 *  - "closed"   — the position was closed.
 */
export type ExecutionStatus = "executed" | "failed" | "blocked" | "closed";

/**
 * The payload every producer dispatches. Everything except `message` is
 * OPTIONAL on purpose: a surface must be able to render the stage line when
 * a real value has not arrived yet.
 */
export type ExecutionResultDetail = {
  /** True only when the broker CONFIRMED the order. */
  ok: boolean;
  /** The human line every surface renders. */
  message: string;
  /** The real outcome of the attempt, when the producer knows it. */
  status?: ExecutionStatus;
  /** The symbol the order was placed on (the broker's own spelling). */
  symbol?: string;
  /** The direction that was actually traded. */
  side?: ExecutionSide;
  /** The lot size that was sent to the broker. */
  lotSize?: number;
  /** The price the order filled at. */
  entry?: number;
  /** The stop loss that was sent (0/absent = the order had no stop). */
  stopLoss?: number;
  /** The take profit that was sent (0/absent = the order had no target). */
  takeProfit?: number;
  /** The robot (EA) name exactly as it is configured. */
  robotName?: string;
  /** Which trade of the run this is (1-based). */
  index?: number;
  /** How many trades the run contains. */
  total?: number;
  /** The broker's decimal count for this symbol — used to print prices. */
  digits?: number;
  /** The broker's order/deal id, when the bridge reported one. */
  orderId?: string;
  /**
   * True for the CLOSING line of a run ("3 of 3 US30 trades opened"). It is a
   * summary, not a fill — it must never be read out as another trade.
   */
  summary?: boolean;
  /** How many orders of the run actually opened. */
  filled?: number;
};

/** A payload with every field normalised to "really there" or "not there". */
export type NormalizedExecution = {
  ok: boolean;
  message: string;
  status: ExecutionStatus | null;
  symbol: string;
  side: ExecutionSide | null;
  lotSize: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  robotName: string;
  index: number | null;
  total: number | null;
  digits: number | null;
  orderId: string;
  summary: boolean;
  filled: number | null;
};

/** A positive finite number, or null. Zero means "not set" for every level. */
function positiveNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

/** A non-negative integer, or null. */
function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Derive the outcome when the producer did not label it.
 *
 * A confirmed fill is only an "executed" when it ALSO names a direction and
 * a symbol — that is the shape of a real order. Everything else stays
 * unlabelled so nothing is announced as a success by accident.
 */
function inferStatus(detail: Record<string, unknown>, ok: boolean, symbol: string, side: ExecutionSide | null): ExecutionStatus | null {
  const explicit = detail["status"];
  if (explicit === "executed" || explicit === "failed" || explicit === "blocked" || explicit === "closed") {
    return explicit;
  }
  const message = text(detail["message"]);
  if (ok && symbol && side) return "executed";
  if (/refused|failed|rejected|not enough margin|insufficient/i.test(message)) return "failed";
  if (/no trade|blocked|stale/i.test(message)) return "blocked";
  if (ok && symbol) return "executed";
  return null;
}

/**
 * Normalise one bus payload. Returns null when the payload is not an object
 * at all — a malformed event must never crash a listener.
 */
export function normalizeExecution(payload: unknown): NormalizedExecution | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = payload as Record<string, unknown>;

  const symbol = text(detail["symbol"]);
  const rawSide = text(detail["side"]).toUpperCase();
  const side: ExecutionSide | null = rawSide === "BUY" || rawSide === "SELL" ? rawSide : null;
  const ok = detail["ok"] === true;
  const message = text(detail["message"]);

  return {
    ok,
    message,
    status: inferStatus(detail, ok, symbol, side),
    symbol,
    side,
    lotSize: positiveNumber(detail["lotSize"] ?? detail["lot_size"]),
    entry: positiveNumber(detail["entry"] ?? detail["price"]),
    stopLoss: positiveNumber(detail["stopLoss"] ?? detail["sl"]),
    takeProfit: positiveNumber(detail["takeProfit"] ?? detail["tp"]),
    robotName: text(detail["robotName"] ?? detail["eaName"]),
    index: count(detail["index"]),
    total: count(detail["total"]),
    digits: count(detail["digits"]),
    orderId: text(detail["orderId"]),
    summary: detail["summary"] === true,
    filled: count(detail["filled"]),
  };
}

/**
 * Print a price the way the broker printed it.
 *
 * With the broker's own decimal count the value is exact. Without it the
 * number keeps its real precision and gains a single decimal place, so
 * "19860" reads as "19860.0" and "1.085" stays "1.085" — never "1.08500".
 */
export function formatPrice(value: number | null | undefined, digits?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (typeof digits === "number" && digits >= 0 && digits <= 8) return value.toFixed(digits);
  const trimmed = String(Number(value.toFixed(5)));
  return trimmed.includes(".") ? trimmed : `${trimmed}.0`;
}

/** Print a lot size without inventing precision: 0.1 stays "0.1", 1 stays "1". */
export function formatLot(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(4)));
}

/**
 * A stable fingerprint of ONE execution.
 *
 * Two events with the same fingerprint describe the same fill, so the voice
 * and the popup can refuse to repeat themselves. The trade index and the
 * order id are part of it: seven identical market orders on one symbol are
 * seven DIFFERENT trades.
 */
export function executionSignature(execution: NormalizedExecution): string {
  return [
    execution.status ?? "unknown",
    execution.summary ? "summary" : "fill",
    execution.symbol,
    execution.side ?? "-",
    execution.index ?? "-",
    execution.total ?? "-",
    formatPrice(execution.entry, execution.digits),
    formatPrice(execution.stopLoss, execution.digits),
    formatPrice(execution.takeProfit, execution.digits),
    formatLot(execution.lotSize),
    execution.orderId,
    execution.message,
  ].join("|");
}

/**
 * The window in which the SAME execution is treated as a repeat.
 *
 * Long enough that a second listener receiving the same event (or the same
 * event being dispatched twice) is silent, short enough that running the
 * same robot again later still speaks.
 */
export const EXECUTION_REPEAT_WINDOW_MS = 90_000;
