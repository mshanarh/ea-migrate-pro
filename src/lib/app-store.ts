import { useSyncExternalStore } from "react";
import { bindEmailToDevice, getEmailDeviceBinding, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";

export type Robot = {
  id: string;
  name: string;
  version?: string;
  key: string;
  symbols: string[];
  pairs?: PairSetting[];
  image?: string;
  video?: string;
  eaId?: string;
  running: boolean;
};

export type PairSetting = {
  symbol: string;
  lotSize: string;
  maxTrades: string;
};

export type MtAccount = {
  platform: "MT5";
  broker: string;
  server: string;
  accountType: string;
  loginId: string;
  /** The user's own MetaApi account id (created under the platform token). */
  mcAccountId?: string;
  /** MetaApi region returned at connect time (used to pick the trade API host). */
  environment?: string;
  /** live or demo — detected from the broker server name (demo/trial servers). */
  kind?: "live" | "demo";
};

export type AppSettings = {
  background: string;
  backgroundEnabled: boolean;
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
  settings: { background: "Neon Grid", backgroundEnabled: true, interfaceStyle: "crimson_navigator", font: "Inter", accent: 60, accentColor: "#FF3B3B", brandName: "EA Migrate", lotSize: "0.01" },
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
        robots: Array.isArray(saved.robots)
          ? saved.robots.map((robot) => ({
              ...robot,
              symbols: Array.isArray(robot.symbols) ? robot.symbols : [],
              pairs: Array.isArray(robot.pairs)
                ? robot.pairs.map((pair) => ({
                    symbol: typeof pair?.symbol === "string" ? pair.symbol : "",
                    lotSize: typeof pair?.lotSize === "string" && pair.lotSize ? pair.lotSize : "0.01",
                    maxTrades: typeof pair?.maxTrades === "string" && pair.maxTrades ? pair.maxTrades : "0",
                  })).filter((pair) => pair.symbol)
                : (Array.isArray(robot.symbols) ? robot.symbols : []).map((symbol) => ({ symbol, lotSize: "0.01", maxTrades: "0" })),
            }))
          : initial.robots,
        settings: { ...initial.settings, ...(saved.settings ?? {}), backgroundEnabled: saved.settings?.backgroundEnabled ?? true },
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

/**
 * Restore everything a user had on another device/deployment, straight from
 * the shared cloud store: robots rebuilt from their active license keys (with
 * the EA's live name/symbols/image/video), the MT5 connection memory, and
 * payment memory (an active license already proves payment — no second Whop
 * charge for the same EA).
 */
export async function restoreRobotsFromCloud(): Promise<{ robots: number; mt5: boolean }> {
  load();
  if (typeof window === "undefined" || !state.email) return { robots: 0, mt5: false };
  const email = state.email;
  const { syncRestoreLicenses, syncGetMt5Account } = await import("@/lib/account-sync.server");
  const [licenseResult, mt5Result] = await Promise.allSettled([
    syncRestoreLicenses({ data: { email } }),
    syncGetMt5Account({ data: { userId: email } }),
  ]);

  let restoredCount = 0;
  if (licenseResult.status === "fulfilled" && licenseResult.value.enabled) {
    const robots: Robot[] = [];
    for (const license of licenseResult.value.licenses) {
      const clean = license.key.trim().toUpperCase().replace(/\s+/g, "");
      if (!clean || robots.some((robot) => robot.key === clean)) continue;
      // Paused or expired keys restore, but the home screen shows them via the
      // license state — robots only come from active licenses.
      if (!license.active) continue;
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) continue;
      robots.push({
        id: "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        key: clean,
        name: license.eaName || "Private EA",
        symbols: license.symbols,
        pairs: license.symbols.map((symbol) => ({ symbol, lotSize: state.settings.lotSize || "0.01", maxTrades: "0" })),
        ...(license.eaId ? { eaId: license.eaId } : {}),
        ...(license.image ? { image: license.image } : {}),
        ...(license.video ? { video: license.video } : {}),
        running: false,
      });
      restoredCount += 1;
    }
    if (restoredCount > 0) {
      // Merge with anything already on this device, cloud robots taking
      // precedence by key, then keep existing local-only robots.
      const existing = state.robots.filter((robot) => !robots.some((fresh) => fresh.key === robot.key));
      state = { ...state, activeRobotId: state.activeRobotId ?? robots[0]?.id ?? null, robots: [...robots, ...existing] };
      persist();
    }
  }

  let mt5Restored = false;
  if (mt5Result.status === "fulfilled" && mt5Result.value.enabled && mt5Result.value.record && !state.mt) {
    const record = mt5Result.value.record;
    state = {
      ...state,
      mt: {
        platform: "MT5",
        broker: record.broker,
        server: record.server,
        accountType: record.accountType,
        loginId: record.loginId,
        mcAccountId: record.mcAccountId,
        ...(record.environment ? { environment: record.environment } : {}),
        ...(record.kind === "demo" || record.kind === "live" ? { kind: record.kind } : {}),
      },
    };
    mt5Restored = true;
  }

  // An active license is itself proof of payment — restore payment memory so
  // the user is never charged twice for the same EA on a new deployment.
  if (restoredCount > 0 && state.email && paymentStatusForEmail(state.email) === "unpaid") {
    markEmailPaid(state.email);
  }

  return { robots: restoredCount, mt5: mt5Restored };
}

export function appSignIn(email: string): { error?: string } {
  load();
  const clean = email.trim().toLowerCase();
  if (!clean) return { error: "Enter your email address." };
  const deviceId = getDeviceId();
  const binding = getEmailDeviceBinding(clean);
  if (binding && binding.deviceId !== deviceId) return { error: "Account already used — this email is linked to another device. One email, one device." };
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
          version: ea?.version,
          symbols: ea?.symbols || license.symbols || [],
          image: ea?.image || license.image,
          video: ea?.video || license.video,
        },
      };
    }
    return { error: "That license key was not found. Confirm the key with your mentor and make sure it was issued to your email." };
  } catch {
    return { error: "That license key could not be checked. Please try again." };
  }
}

export function activateKey(key: string): { error?: string; robot?: Robot } {
  load();
  // Tolerant normalisation: trim, uppercase and strip any spaces the user pasted.
  const clean = key.trim().toUpperCase().replace(/\s+/g, "");
  console.log("[key-activation] Checking key:", clean);
  // Format check: the current generator issues EMP-XXXX-XXXX-XXXX; older
  // legacy keys were EMP- + 12 chars. Both are accepted, any other shape is
  // rejected before it ever reaches the license lookup.
  const validFormat = /^EMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean) || /^EMP-[A-Z0-9]{12}$/.test(clean);
  if (!validFormat) {
    return { error: "That license key is invalid. It should look like EMP-XXXX-XXXX-XXXX (no spaces)." };
  }
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
    ...(savedEa?.version ? { version: savedEa.version } : {}),
    symbols: savedEa?.symbols || licenseResult.license.symbols || [],
    pairs: (savedEa?.symbols || licenseResult.license.symbols || []).map((symbol: string) => ({ symbol, lotSize: "0.01", maxTrades: "0" })),
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

/**
 * Pull the mentor's latest EA data (symbols, image, video) into every activated
 * robot that came from that EA — so portal edits appear in the app immediately,
 * without the user re-activating. Existing per-pair settings are preserved for
 * symbols the EA still has; symbols the mentor removed are dropped.
 */
export function syncRobotsFromPortal() {
  load();
  if (typeof window === "undefined" || state.robots.length === 0) return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem("eamp.store.v1");
  } catch {
    return;
  }
  if (!raw) return;
  let changed = false;
  try {
    const store = JSON.parse(raw) as { accounts?: { eas?: { id?: string; name?: string; symbols?: string[]; image?: string; video?: string }[] }[] };
    const eas = (store.accounts ?? []).flatMap((account) => account.eas ?? []);
    if (eas.length === 0) return;
    const robots = state.robots.map((robot) => {
      const ea = eas.find((candidate) => candidate.id && candidate.id === robot.eaId);
      if (!ea) return robot;
      const symbols = Array.isArray(ea.symbols) ? ea.symbols : [];
      const oldPairs = robot.pairs ?? [];
      const pairs = symbols.map((symbol) => oldPairs.find((pair) => pair.symbol === symbol) ?? { symbol, lotSize: "0.01", maxTrades: "0" });
      const sameSymbols = symbols.length === robot.symbols.length && symbols.every((symbol, index) => symbol === robot.symbols[index]);
      const samePairs = pairs.length === oldPairs.length && pairs.every((pair, index) => pair === oldPairs[index]);
      if (sameSymbols && samePairs && ea.image === robot.image && ea.video === robot.video && (!ea.name || ea.name === robot.name)) return robot;
      changed = true;
      return {
        ...robot,
        symbols,
        pairs,
        ...(ea.image ? { image: ea.image } : {}),
        ...(ea.video ? { video: ea.video } : {}),
        ...(ea.name ? { name: ea.name } : {}),
      };
    });
    if (!changed) return;
    state = { ...state, robots };
    persist();
  } catch {
    /* ignore malformed portal data */
  }
}

export function setRobotPairs(id: string, pairs: PairSetting[]) {
  load();
  const safePairs = pairs.filter((pair) => pair.symbol.trim()).map((pair) => ({
    symbol: pair.symbol.trim().toUpperCase(),
    lotSize: pair.lotSize || "0.01",
    maxTrades: pair.maxTrades || "0",
  }));
  state = {
    ...state,
    robots: state.robots.map((robot) => robot.id === id ? { ...robot, pairs: safePairs } : robot),
  };
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

export function disconnectMt() {
  load();
  state = { ...state, mt: null };
  persist();
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  load();
  state = { ...state, settings: { ...state.settings, [key]: value } };
  persist();
}
