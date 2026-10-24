import { useSyncExternalStore } from "react";
import {
  formatPrice,
  normalizeExecution,
  type ExecutionSide,
  type NormalizedExecution,
} from "@/lib/execution-events";

/**
 * THE LIVE EXECUTION STATE — what the bot is doing RIGHT NOW, and what the
 * broker actually did.
 *
 * The AI trade analysis card needs three different things, and none of them
 * may be guessed:
 *   • the PLAN (symbol, direction, lot size, how many trades) — known the
 *     moment the trader presses START or Execute;
 *   • the bot's real STAGE (analysing, setting the stops, executing, trade
 *     n of m) — the same lines the floating bot popup narrates, not a
 *     parallel script;
 *   • the newest CONFIRMED fill, with the broker's own entry, stop loss and
 *     take profit — which replaces the plan's estimate as soon as it lands.
 *
 * The store is deliberately dumb: it stores what the producers hand it and
 * never computes a price, a direction or a status of its own.
 */

export type ExecutionPlan = {
  /** The symbol the bot is trading on. */
  symbol: string;
  /** The direction the engine analysed. */
  direction?: ExecutionSide;
  /** The lot size that was sent to the broker. */
  lotSize?: number;
  /** How many trades the run contains. */
  totalTrades?: number;
  /** The robot (EA) name exactly as it is configured. */
  robotName?: string;
  /** The analysed entry — an estimate until the broker reports the fill. */
  entry?: number;
  /** The analysed stop loss — an estimate until the broker confirms it. */
  stopLoss?: number;
  /** The analysed take profit — an estimate until the broker confirms it. */
  takeProfit?: number;
  /** The broker's decimal count for this symbol. */
  digits?: number;
  /** The trend the analysis read from the broker's closes. */
  trend?: ExecutionSide;
  /** How far the live price sat from the 20-candle average, in ATR(14). */
  extensionAtr?: number;
  /** The overextension filter's verdict: enter / too-extended / waiting-*. */
  entryGate?: string;
  /** What the filter measured, and why it entered or skipped. */
  entryReason?: string;
  /** Which behaviour is running — shown on the card as SCALPER/NORMAL MODE. */
  mode?: "scalper" | "normal";
};

export type ExecutionState = {
  /** A run is on screen right now. */
  active: boolean;
  /** The plan the run started with. */
  plan: ExecutionPlan | null;
  /** The bot's real stage line, narrated exactly like the bot popup. */
  stage: string;
  /** The newest CONFIRMED execution, with the broker's own values. */
  last: NormalizedExecution | null;
};

const EMPTY: ExecutionState = {
  active: false,
  plan: null,
  stage: "",
  last: null,
};

let state: ExecutionState = EMPTY;
const listeners = new Set<() => void>();

function setState(next: ExecutionState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): ExecutionState {
  return state;
}

/** A run started — the plan is known, the stages and the fills are not. */
export function startExecution(plan: ExecutionPlan): void {
  setState({ active: true, plan, stage: "", last: null });
}

/**
 * The plan learned something new (the analysed direction, the real levels).
 * Merged into the running plan — never replaces it, so the symbol and the
 * trade count survive.
 */
export function updateExecutionPlan(patch: Partial<ExecutionPlan>): void {
  if (!state.plan) return;
  setState({ ...state, plan: { ...state.plan, ...patch } });
}

/** The bot moved to its next step. */
export function setExecutionStage(stage: string): void {
  if (state.stage === stage) return;
  setState({ ...state, stage });
}

/** The run is over — the card keeps the last values but stops updating. */
export function stopExecution(): void {
  if (!state.active) return;
  setState({ ...state, active: false });
}

/**
 * One result arrived on the execution bus.
 *
 * A confirmed fill becomes the card's source of truth (real entry, real
 * stops, real direction) and the stage line advances to "Trade n of m
 * executed — …". A refusal is reported as a refusal. Progress chatter is
 * ignored: it carries no trade.
 */
export function recordExecutionResult(payload: unknown): void {
  const execution = normalizeExecution(payload);
  if (!execution) return;
  if (execution.status === null) return;
  if (!execution.symbol && !execution.message) return;

  // The closing line of a run is a SUMMARY, not a fill — it never replaces
  // the confirmed trade the card is showing.
  if (execution.summary) {
    const parts: string[] = [];
    if (execution.filled !== null && execution.total !== null && execution.total > 0) {
      parts.push(`${execution.filled}/${execution.total} trades opened`);
    } else {
      parts.push("Trades opened");
    }
    if (execution.symbol) parts.push(execution.symbol);
    setState({ ...state, stage: parts.join(" · ") });
    return;
  }

  if (execution.status === "executed" && execution.symbol) {
    const parts: string[] = [];
    if (execution.index !== null && execution.total !== null && execution.total > 0) {
      parts.push(`Trade ${execution.index}/${execution.total} executed`);
    } else {
      parts.push("Trade executed");
    }
    if (execution.symbol) parts.push(execution.symbol);
    if (execution.side) parts.push(execution.side);
    const entry = formatPrice(execution.entry, execution.digits);
    if (entry) parts.push(`Entry ${entry}`);
    const stop = formatPrice(execution.stopLoss, execution.digits);
    if (stop) parts.push(`SL ${stop}`);
    const target = formatPrice(execution.takeProfit, execution.digits);
    if (target) parts.push(`TP ${target}`);
    setState({ ...state, stage: parts.join(" · "), last: execution });
    return;
  }

  if (execution.status === "failed" || execution.status === "blocked") {
    setState({ ...state, stage: execution.message || "Trade not opened" });
  }
}

/** Test seam — put the store back to its empty state. */
export function resetExecutionState(): void {
  setState(EMPTY);
}

/** Live value for rendering — never a snapshot taken once on mount. */
export function useExecutionState(): ExecutionState {
  return useSyncExternalStore(subscribe, getState, () => EMPTY);
}
