/**
 * Recent-trades history — every execution the scanner (or the home START)
 * fires is recorded here so the trader can review what actually went out.
 * localStorage-backed (survives reloads), capped at 30 entries, newest first.
 */
import { useSyncExternalStore } from "react";

export type TradeRecord = {
  id: string;
  at: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lot: string;
  trades: number;
  /** How many orders actually filled ("3/5"). */
  filled: string;
  ok: boolean;
  /** Strength grade at scan time (when known). */
  strength?: "WAIT" | "WEAK" | "MODERATE" | "STRONG";
  /** Short outcome/error line shown under the row. */
  detail: string;
};

const KEY = "eamp.trade.history.v1";
const MAX = 30;

let state: TradeRecord[] = load();
const listeners = new Set<() => void>();

function load(): TradeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as TradeRecord[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full/blocked — in-memory still works this session */
  }
}

export function recordTrade(record: Omit<TradeRecord, "id" | "at">) {
  const entry: TradeRecord = {
    ...record,
    id: "t-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
  };
  state = [entry, ...state].slice(0, MAX);
  persist();
  listeners.forEach((listener) => listener());
}

export function clearTradeHistory() {
  state = [];
  persist();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive hook — the Recent Trades dialog live-updates while open. */
export function useTradeHistory(): TradeRecord[] {
  return useSyncExternalStore(subscribe, () => state, () => [] as TradeRecord[]);
}
