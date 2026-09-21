import { useSyncExternalStore } from "react";

export type TradingPair = {
  id: string;
  symbol: string;
  minLot: number;
  active: boolean;
};

export type UserPair = {
  id: string;
  userId: string;
  symbol: string;
  lotSize: number;
  maxTrades: number;
  createdAt: string;
};

export type DailyScan = {
  userId: string;
  scanDate: string;
  count: number;
};

const KEY = "eamp.trading-pairs.v1";
const DAILY_SCAN_LIMIT = 5;

let state: { tradingPairs: TradingPair[]; userPairs: UserPair[]; dailyScans: DailyScan[] } = {
  tradingPairs: [
    { id: "tp-xauusd", symbol: "XAUUSD", minLot: 0.01, active: true },
    { id: "tp-gbpjpy", symbol: "GBPJPY", minLot: 0.01, active: true },
    { id: "tp-us30", symbol: "US30", minLot: 0.1, active: true },
    { id: "tp-nas100", symbol: "NAS100", minLot: 0.1, active: true },
  ],
  userPairs: [],
  dailyScans: [],
};

let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<{ tradingPairs: TradingPair[]; userPairs: UserPair[]; dailyScans: DailyScan[] }>;
      state = {
        tradingPairs: Array.isArray(saved.tradingPairs) ? saved.tradingPairs : state.tradingPairs,
        userPairs: Array.isArray(saved.userPairs) ? saved.userPairs : [],
        dailyScans: Array.isArray(saved.dailyScans) ? saved.dailyScans : [],
      };
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = state;

function getSnapshot() {
  load();
  return state;
}

export function useTradingPairsStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

/** Mentor adds a pair (source of truth for the app's Available tab). */
export function addTradingPair(symbol: string, minLot: number): { error?: string; pair?: TradingPair } {
  load();
  const clean = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,12}$/.test(clean)) return { error: "Use 3-12 letters/numbers (e.g. BTCUSD)." };
  if (state.tradingPairs.some((pair) => pair.symbol === clean)) return { error: `${clean} already exists.` };
  if (!(minLot > 0)) return { error: "Minimum lot must be greater than 0." };
  const pair: TradingPair = { id: "tp-" + Date.now().toString(36), symbol: clean, minLot, active: true };
  state = { ...state, tradingPairs: [...state.tradingPairs, pair] };
  persist();
  return { pair };
}

export function removeTradingPair(id: string) {
  load();
  const symbol = state.tradingPairs.find((item) => item.id === id)?.symbol;
  // Cascade: deleting a pair removes it from every user's My Pairs too.
  state = {
    ...state,
    tradingPairs: state.tradingPairs.filter((item) => item.id !== id),
    userPairs: symbol ? state.userPairs.filter((item) => item.symbol !== symbol) : state.userPairs,
  };
  persist();
}

export function addUserPair(userId: string, symbol: string, lotSize = 0.01, maxTrades = 0): { error?: string; pair?: UserPair } {
  load();
  const clean = symbol.trim().toUpperCase();
  const template = state.tradingPairs.find((pair) => pair.symbol === clean);
  if (!template) return { error: "That pair is not available." };
  if (state.userPairs.some((pair) => pair.userId === userId && pair.symbol === clean)) {
    return { error: `${clean} is already in My Pairs.` };
  }
  const userPair: UserPair = {
    id: "up-" + Date.now().toString(36),
    userId,
    symbol: clean,
    lotSize: Math.max(template.minLot, lotSize),
    maxTrades,
    createdAt: new Date().toISOString(),
  };
  state = { ...state, userPairs: [...state.userPairs, userPair] };
  persist();
  return { pair: userPair };
}

export function removeUserPair(userId: string, symbol: string) {
  load();
  state = { ...state, userPairs: state.userPairs.filter((pair) => !(pair.userId === userId && pair.symbol === symbol)) };
  persist();
}

export function updateUserPair(userId: string, symbol: string, patch: { lotSize?: number; maxTrades?: number }) {
  load();
  const template = state.tradingPairs.find((pair) => pair.symbol === symbol);
  state = {
    ...state,
    userPairs: state.userPairs.map((pair) =>
      pair.userId === userId && pair.symbol === symbol
        ? {
            ...pair,
            ...(patch.lotSize !== undefined ? { lotSize: Math.max(template?.minLot ?? 0.01, patch.lotSize) } : {}),
            ...(patch.maxTrades !== undefined ? { maxTrades: Math.max(0, Math.floor(patch.maxTrades)) } : {}),
          }
        : pair,
    ),
  };
  persist();
}

/** Today in Africa/Johannesburg as YYYY-MM-DD. */
export function sastToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

/** Platform admins — unlimited daily scans. */
const ADMIN_EMAILS = new Set(["biyasentobeko222@gmail.com", "ntobekotraders.official@gmail.com"]);

export function isUnlimitedScanner(email: string | null | undefined): boolean {
  return Boolean(email && ADMIN_EMAILS.has(email.trim().toLowerCase()));
}

export function getScanCount(userId: string): number {
  load();
  const today = sastToday();
  return state.dailyScans.find((scan) => scan.userId === userId && scan.scanDate === today)?.count ?? 0;
}

/** Registers one scan for the user, enforcing the daily limit (SAST day). Admins are unlimited. */
export function registerScan(userId: string): { allowed: boolean; count: number } {
  if (isUnlimitedScanner(userId)) return { allowed: true, count: 0 };
  load();
  const today = sastToday();
  const existing = state.dailyScans.find((scan) => scan.userId === userId && scan.scanDate === today);
  const count = existing?.count ?? 0;
  if (count >= DAILY_SCAN_LIMIT) return { allowed: false, count };
  const dailyScans = existing
    ? state.dailyScans.map((scan) => (scan.userId === userId && scan.scanDate === today ? { ...scan, count: count + 1 } : scan))
    : [...state.dailyScans.filter((scan) => scan.userId === userId), { userId, scanDate: today, count: 1 }];
  state = { ...state, dailyScans };
  persist();
  return { allowed: true, count: count + 1 };
}

export const DAILY_LIMIT = DAILY_SCAN_LIMIT;
