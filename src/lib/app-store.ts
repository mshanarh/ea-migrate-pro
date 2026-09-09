import { useSyncExternalStore } from "react";
import { bindEmailToDevice, getEmailDeviceBinding, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";

export type Robot = {
  id: string;
  name: string;
  key: string;
  image?: string;
  video?: string;
  eaId?: string;
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
  activeRobotId: string | null;
  robots: Robot[];
  mt: MtAccount | null;
  settings: AppSettings;
};

const KEY = "eamp.app.v3";
const LEGACY_KEYS = ["eamp.app.v1", "eamp.app.v2"];

const initial: AppState = {
  email: null,
  activeRobotId: null,
  robots: [],
  mt: null,
  settings: { background: "Neon Grid", interfaceStyle: "Neuro Scalper", font: "Inter", accent: 60, accentColor: "#FF453A" },
};

let state: AppState = initial;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    LEGACY_KEYS.forEach((legacy) => window.localStorage.removeItem(legacy));
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...initial,
        ...saved,
        activeRobotId: saved.activeRobotId ?? initial.activeRobotId,
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

function getDeviceId() {
  if (typeof window === "undefined") return "server";
  const key = "eamp.device.id";
  const saved = window.localStorage.getItem(key);
  if (saved) return saved;
  const generated = "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  window.localStorage.setItem(key, generated);
  return generated;
}

export function appSignIn(email: string): { error?: string } {
  load();
  const clean = email.trim().toLowerCase();
  if (!clean) return { error: "Enter your email address." };
  const deviceId = getDeviceId();
  const binding = getEmailDeviceBinding(clean);
  if (binding && binding.deviceId !== deviceId) return { error: "This email is already activated on another device." };
  if (paymentStatusForEmail(clean) === "admin") markEmailPaid(clean);
  state = { ...state, email: clean };
  persist();
  return {};
}

export function appSignOut() {
  load();
  state = { ...state, email: null };
  persist();
}

function findSavedEaForLicense(key: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem("eamp.store.v1");
    const store = raw ? JSON.parse(raw) : null;
    for (const account of store?.accounts ?? []) {
      const license = (account.licenses ?? []).find((item: { key?: string }) => item.key === key);
      if (!license) continue;
      const ea = (account.eas ?? []).find((item: { id?: string }) => item.id === license.eaId);
      if (ea) return { eaId: ea.id, name: ea.name, image: ea.image, video: ea.video };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function activateKey(key: string): { error?: string; robot?: Robot } {
  load();
  const clean = key.trim().toUpperCase();
  if (!clean.startsWith("EMP-") || clean.length !== 16) return { error: "That license key is invalid." };
  if (state.robots.some((robot) => robot.key === clean)) return { error: "That key is already activated." };
  if (!state.email) return { error: "Sign in with your email before activating a key." };
  if (paymentStatusForEmail(state.email) === "unpaid") return { error: "Complete payment before activating your licence key." };
  const deviceResult = bindEmailToDevice(state.email, getDeviceId());
  if (deviceResult.error) return { error: deviceResult.error };
  const savedEa = findSavedEaForLicense(clean);
  const robot: Robot = {
    id: "r-" + Date.now(),
    key: clean,
    name: savedEa?.name || "Private EA",
    ...(savedEa?.eaId ? { eaId: savedEa.eaId } : {}),
    ...(savedEa?.image ? { image: savedEa.image } : {}),
    ...(savedEa?.video ? { video: savedEa.video } : {}),
    running: false,
  };
  state = { ...state, activeRobotId: state.activeRobotId || robot.id, robots: [...state.robots, robot] };
  persist();
  return { robot };
}

export function setActiveRobot(id: string) {
  load();
  if (!state.robots.some((robot) => robot.id === id)) return;
  state = { ...state, activeRobotId: id };
  persist();
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
  const robots = state.robots.filter((r) => r.id !== id);
  state = { ...state, activeRobotId: state.activeRobotId === id ? (robots[0]?.id ?? null) : state.activeRobotId, robots };
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
