import { useSyncExternalStore } from "react";
import { bindEmailToDevice, getEmailDeviceBinding, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";

export type Robot = {
  id: string;
  name: string;
  key: string;
  symbols: string[];
  image?: string;
  video?: string;
  eaId?: string;
  running: boolean;
};

export type MtAccount = {
  platform: "MT5";
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
  brandName: string;
  lotSize: string;
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

const INTERFACE_STYLE_IDS = new Set([
  "crimson_navigator",
  "navigator_plus",
  "pablo_crimson",
  "pablo_elite",
  "quantum_blue",
  "darkweb_ai",
  "supreme_equinox",
  "ultron_mega",
  "ea_cloud",
]);

const initial: AppState = {
  email: null,
  activeRobotId: null,
  robots: [],
  mt: null,
  settings: { background: "Neon Grid", interfaceStyle: "crimson_navigator", font: "Inter", accent: 60, accentColor: "#FF3B3B", brandName: "EA Migrate", lotSize: "0.01" },
};

let state: AppState = initial;
let loaded = false;
const listeners = new Set<() => void>();

const LAYOUT_ALIASES: Record<string, string> = {
  Prime: "navigator_plus",
  Custom: "crimson_navigator",
  "Neuro Scalper": "darkweb_ai",
  "Prime Pro": "pablo_elite",
  layout_orange: "crimson_navigator",
  layout_blue: "quantum_blue",
  layout_green: "ea_cloud",
  layout_sniper_circle: "crimson_navigator",
  layout_sniper_full: "navigator_plus",
  layout_sniper_vertical: "pablo_elite",
};

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
    const savedLayout = window.localStorage.getItem("layout");
    const savedThemeColor = window.localStorage.getItem("themeColor");
    const requestedLayout = savedLayout || state.settings.interfaceStyle;
    const aliasedLayout = LAYOUT_ALIASES[requestedLayout];
    const selectedLayout = INTERFACE_STYLE_IDS.has(requestedLayout)
      ? requestedLayout
      : aliasedLayout && INTERFACE_STYLE_IDS.has(aliasedLayout)
        ? aliasedLayout
        : initial.settings.interfaceStyle;
    state = { ...state, settings: { ...state.settings, interfaceStyle: selectedLayout, accentColor: savedThemeColor || state.settings.accentColor || initial.settings.accentColor } };
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window !== "undefined") { window.localStorage.setItem(KEY, JSON.stringify(state)); window.localStorage.setItem("layout", state.settings.interfaceStyle); window.localStorage.setItem("themeColor", state.settings.accentColor); }
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
  if (binding && binding.deviceId !== deviceId) return { error: "Email already in use on another device." };
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

function findSavedLicenseForEmail(key: string, email: string) {
  if (typeof window === "undefined") return { error: "License activation is only available in the app." };
  try {
    const raw = window.localStorage.getItem("eamp.store.v1");
    const store = raw ? JSON.parse(raw) : null;
    for (const account of store?.accounts ?? []) {
      const license = (account.licenses ?? []).find((item: { key?: string }) => item.key === key);
      if (!license) continue;
      if (!license.active) return { error: "That license key is paused." };
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) return { error: "That license key has expired." };
      if (license.clientEmail && license.clientEmail.toLowerCase() !== email.toLowerCase()) return { error: "That license key belongs to a different email." };
      const ea = (account.eas ?? []).find((item: { id?: string }) => item.id === license.eaId);
      const robotName = ea?.name || license.robotName || license.expertAdvisor || license.name || "Private EA";
      return {
        license,
        ea: {
          eaId: ea?.id || license.eaId,
          name: robotName,
          symbols: ea?.symbols || license.symbols || [],
          image: ea?.image || license.image,
          video: ea?.video || license.video,
        },
      };
    }
    return { error: "That license key was not found." };
  } catch {
    return { error: "That license key could not be checked." };
  }
}

export function activateKey(key: string): { error?: string; robot?: Robot } {
  load();
  const clean = key.trim().toUpperCase();
  if (!clean.startsWith("EMP-") || clean.length !== 16) return { error: "That license key is invalid." };
  if (state.robots.some((robot) => robot.key === clean)) return { error: "That key is already activated." };
  if (!state.email) return { error: "Sign in with your email before activating a key." };
  if (paymentStatusForEmail(state.email) === "unpaid") return { error: "Complete payment before activating your licence key." };
  // Validate the key first, then enforce the one-device binding before creating a robot.
  const licenseResult = findSavedLicenseForEmail(clean, state.email);
  if (licenseResult.error) return { error: licenseResult.error };
  const deviceResult = bindEmailToDevice(state.email, getDeviceId());
  if (deviceResult.error) return { error: deviceResult.error };
  const savedEa = licenseResult.ea;
  const robot: Robot = {
    id: "r-" + Date.now(),
    key: clean,
    name: savedEa?.name || "Private EA",
    symbols: savedEa?.symbols || licenseResult.license.symbols || [],
    ...(savedEa?.eaId ? { eaId: savedEa.eaId } : {}),
    ...(savedEa?.image ? { image: savedEa.image } : {}),
    ...(savedEa?.video ? { video: savedEa.video } : {}),
    running: false,
  };
  if (typeof window !== "undefined") window.localStorage.setItem("robotName", robot.name);
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
