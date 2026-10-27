import { useSyncExternalStore } from "react";

/**
 * THE SIGNAL WAITING FOR A HUMAN DECISION.
 *
 * Start no longer trades on its own. When the bot's own analysis produces a
 * valid entry it STOPS there and publishes it here instead of sending an
 * order: the card floating over the app shows the analysed side and levels,
 * the engine keeps re-validating them against fresh broker candles, and the
 * ONLY thing that can place an order is the trader tapping Execute.
 *
 * Nothing in this module executes anything — it is a mailbox between the
 * trading loop (`awaitPendingDecision`) and the card (`confirmPendingSignal`).
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
   * `ready` while the candles still agree with the signal, `invalid` once the
   * market moved away from it — the card then names the reason and Execute is
   * gone, so a stale signal can never be traded.
   */
  state: "ready" | "invalid";
  /** Present only when `state` is `invalid`. */
  invalidReason?: string;
  /** When the signal was (re)validated — the card shows its age. */
  updatedAt: number;
};

export type SignalDecision = "execute" | "invalid";

let state: PendingSignal | null = null;
let decide: ((decision: SignalDecision) => void) | null = null;
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

/** Live value for rendering — never a snapshot taken once on mount. */
export function usePendingSignal(): PendingSignal | null {
  return useSyncExternalStore(subscribe, getState, () => null);
}

/** The current signal, for code that only needs to read it. */
export function peekPendingSignal(): PendingSignal | null {
  return state;
}

/** Publish a freshly analysed signal (also used when refreshing a live one). */
export function publishPendingSignal(signal: PendingSignal): void {
  state = signal;
  emit();
}

/** The market moved away from the signal — it can no longer be executed. */
export function invalidatePendingSignal(reason: string): void {
  if (!state) return;
  state = { ...state, state: "invalid", invalidReason: reason, updatedAt: Date.now() };
  emit();
  const resolver = decide;
  decide = null;
  resolver?.("invalid");
}

/** Drop the signal without executing anything. */
export function clearPendingSignal(): void {
  state = null;
  emit();
  const resolver = decide;
  decide = null;
  resolver?.("invalid");
}

/** The trader tapped Execute — the loop may now place the order. */
export function confirmPendingSignal(): void {
  const resolver = decide;
  decide = null;
  resolver?.("execute");
}

/**
 * Wait for the trader's decision on this signal.
 * Resolves `execute` ONLY when Execute was tapped; every other path (a stale
 * signal, Stop, the screen going away, the wait window closing) resolves
 * `invalid`, so nothing is ever sent without a deliberate tap.
 */
export function awaitPendingDecision(): Promise<SignalDecision> {
  return new Promise<SignalDecision>((resolve) => {
    decide = resolve;
  });
}

/** Test seam. */
export function resetPendingSignal(): void {
  state = null;
  decide = null;
  emit();
}
