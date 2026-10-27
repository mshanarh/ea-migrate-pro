import { useSyncExternalStore } from "react";
import { callNative } from "./native-bridge";

/**
 * THE SIGNAL WAITING FOR A HUMAN DECISION — and the card that follows the
 * trader out of the app.
 *
 * Start no longer trades on its own. When the bot's own analysis produces a
 * valid entry it STOPS there and publishes it here instead of sending an
 * order: the analysis card shows the analysed side and levels, the engine
 * keeps re-validating them against fresh broker candles, and the ONLY thing
 * that can place an order is the trader tapping Execute.
 *
 * WHY THE NATIVE CARD IS FED FROM HERE
 * ────────────────────────────────────
 * The trader has to leave the app to place the order in MetaTrader, so the
 * decision card has to leave with them. Every publish therefore also pushes the
 * signal to the Android overlay (`showTradeAnalysis`) — the rounded floating
 * card that draws OVER MetaTrader — and hides it the moment the signal is gone.
 * The overlay's own EXECUTE button cannot run the trading code itself, so its
 * tap comes back as `eamp:native-execute` and is turned into the same
 * confirmation the in-app button sends: nothing is executed by the native side,
 * ever.
 *
 * Nothing in this module places an order — it is a mailbox between the trading
 * loop and the two cards (in-app and floating).
 */

export type PendingSignal = {
  symbol: string;
  /** The analysed side — the only side Execute can send. */
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  /** How many orders the analysed plan would send. */
  trades: number;
  /** Which behaviour produced it (shown on the card). */
  mode: "scalper" | "normal";
  robotName: string;
  /** Why the analysis chose this side — the engine's own words. */
  reason: string;
  /**
   * `ready` while the candles still agree with the signal, `confirmed` for the
   * instant between the trader's tap and the order being sent, and `invalid`
   * once the market moved away from it — the card then names the reason and
   * Execute is gone, so a stale signal can never be traded.
   */
  state: "ready" | "confirmed" | "invalid";
  /** Present only when `state` is `invalid`. */
  invalidReason?: string;
  /** When the signal was (re)validated — the card shows its age. */
  updatedAt: number;
};

let state: PendingSignal | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): PendingSignal | null {
  return state;
}

/**
 * THE FLOATING CARD OVER METATRADER.
 *
 * Only a `ready` signal is worth showing — a tapped or dropped one comes down
 * (the Android card has its own dismiss handling, and a card left up after the
 * trader acted is what reads as "nothing happened").
 */
function pushToNativeCard(signal: PendingSignal | null): void {
  if (!signal || signal.state !== "ready") {
    callNative("hideTradeAnalysis");
    return;
  }
  callNative(
    "showTradeAnalysis",
    JSON.stringify({
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit,
      takeProfit2: signal.takeProfit,
      lotSize: signal.lotSize,
      trades: signal.trades,
      robotName: signal.robotName,
      mode: signal.mode,
      reason: signal.reason,
      updatedAt: signal.updatedAt,
    }),
  );
}

let nativeExecuteBound = false;

/**
 * THE OVERLAY'S EXECUTE TAP IS A REAL CONFIRMATION.
 *
 * The floating card is a native window, so its button dispatches
 * `eamp:native-execute` into the page with the signal it was drawn from (see
 * MainActivity). Bound once, the first time a signal is published — a tap only
 * confirms when it is THIS signal (same symbol) that is still waiting, so a
 * stale card can never place an order for a signal that already went away.
 */
function ensureNativeExecuteBinding(): void {
  if (nativeExecuteBound || typeof window === "undefined") return;
  nativeExecuteBound = true;
  window.addEventListener("eamp:native-execute", (event) => {
    if (!state || state.state !== "ready") return;
    const detail = (event as CustomEvent).detail as { symbol?: string } | undefined;
    const tapped = (detail?.symbol ?? "").trim().toUpperCase();
    if (tapped && tapped !== state.symbol.trim().toUpperCase()) return;
    console.info(`[signal] Execute tapped on the floating card — confirming ${state.direction} ${state.symbol}`);
    confirmPendingSignal();
  });
}

/** Live value for rendering — never a snapshot taken once on mount. */
export function usePendingSignal(): PendingSignal | null {
  return useSyncExternalStore(subscribe, getState, () => null);
}

/** The current signal, for code that only needs to read it. */
export function peekPendingSignal(): PendingSignal | null {
  return state;
}

/**
 * Would the floating card LOOK different? The loop republishes its held signal
 * on every pass (about every six seconds) to keep the age current; redrawing the
 * native window that often would make it flicker and reset a drag mid-read, so
 * the overlay is only touched when the card's own content changed.
 */
function cardContentChanged(previous: PendingSignal | null, next: PendingSignal): boolean {
  if (!previous || previous.state !== "ready") return true;
  return (
    previous.symbol !== next.symbol ||
    previous.direction !== next.direction ||
    previous.entry !== next.entry ||
    previous.stopLoss !== next.stopLoss ||
    previous.takeProfit !== next.takeProfit ||
    previous.lotSize !== next.lotSize ||
    previous.trades !== next.trades ||
    previous.reason !== next.reason
  );
}

/** Publish a freshly analysed signal (also used when refreshing a live one). */
export function publishPendingSignal(signal: PendingSignal): void {
  const redrawCard = cardContentChanged(state, signal);
  state = signal;
  ensureNativeExecuteBinding();
  if (redrawCard) pushToNativeCard(state);
  emit();
}

/** The market moved away from the signal — it can no longer be executed. */
export function invalidatePendingSignal(reason: string): void {
  if (!state) return;
  state = { ...state, state: "invalid", invalidReason: reason, updatedAt: Date.now() };
  pushToNativeCard(null);
  emit();
}

/** Drop the signal without executing anything (Stop, or the trader dismissed it). */
export function clearPendingSignal(): void {
  state = null;
  pushToNativeCard(null);
  emit();
}

/**
 * The trader tapped Execute — in the app, or on the card floating over
 * MetaTrader. The signal is marked CONFIRMED and the loop picks it up on its
 * next pass; the card comes down because the order is on its way.
 */
export function confirmPendingSignal(): void {
  if (!state || state.state !== "ready") return;
  state = { ...state, state: "confirmed", updatedAt: Date.now() };
  pushToNativeCard(null);
  emit();
}

/**
 * THE LOOP'S HALF OF THE HANDSHAKE.
 *
 * Returns the confirmed signal exactly once and clears it, so a double tap (or
 * a repeated pass) can never place two orders for one decision.
 */
export function takeConfirmedPendingSignal(): PendingSignal | null {
  if (!state || state.state !== "confirmed") return null;
  const confirmed = state;
  state = null;
  pushToNativeCard(null);
  emit();
  return confirmed;
}

/** Test seam. */
export function resetPendingSignal(): void {
  state = null;
  callNative("hideTradeAnalysis");
  emit();
}
