import { useSyncExternalStore } from "react";

export type Robot = {
  id: string;
  name: string;
  key: string;
  image?: string;
  running: boolean;
};

export type MtAccount = {
  platform: "MT4" | "MT5";
  broker: string;
  server: string;
  accountType: string;
  loginId: string;
};

export type AppSettings = {
  background: string;
  interfaceStyle: string;
  font: string;
  accent: number;
  accentColor: string;
};

export type AppState = {
  email: string | null;
  robots: Robot[];
  mt: MtAccount | null;
  settings: AppSettings;
};

const KEY = "eamp.app.v1";

const initial: AppState = {
  email: null,
  robots: [],
  mt: null,
  settings: { background: "Neon Grid", interfaceStyle: "Interface 1", font: "Inter", accent: 60, accentColor: "#6ea8ff" },
};

let state: AppState = initial;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...initial,
        ...saved,
        settings: { ...initial.settings, ...(saved.settings ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot = initial;

export function useAppState() {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
}

export function appSignIn(email: string) {
  load();
  state = { ...state, email: email.trim() };
  persist();
}

export function appSignOut() {
  load();
  state = { ...state, email: null };
  persist();
}

export function activateKey(key: string): { error?: string; robot?: Robot } {
  load();
  const clean = key.trim().toUpperCase();
  if (clean.length < 6) return { error: "That licence key looks too short." };
  if (state.robots.some((r) => r.key === clean)) return { error: "That key is already activated." };
  const robot: Robot = {
    id: `r-${Date.now()}`,
    key: clean,
    name: nameFromKey(clean),
    running: false,
  };
  state = { ...state, robots: [...state.robots, robot] };
  persist();
  return { robot };
}

const ROBOT_NAMES = [
  "Sniper Killer EA v2.0",
  "Specter V9",
  "Gold Reaper EA",
  "Nova Scalper EA",
  "Titan Grid EA",
];

function nameFromKey(key: string) {
  let sum = 0;
  for (const c of key) sum += c.charCodeAt(0);
  return ROBOT_NAMES[sum % ROBOT_NAMES.length] ?? "EA Robot";
}

export function toggleRobot(id: string) {
  load();
  state = {
    ...state,
    robots: state.robots.map((r) => (r.id === id ? { ...r, running: !r.running } : r)),
  };
  persist();
}

export function removeRobot(id: string) {
  load();
  state = { ...state, robots: state.robots.filter((r) => r.id !== id) };
  persist();
}

export function connectMt(mt: MtAccount) {
  load();
  state = { ...state, mt };
  persist();
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  load();
  state = { ...state, settings: { ...state.settings, [key]: value } };
  persist();
}
