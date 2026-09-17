import { useSyncExternalStore } from "react";

export const ACCENT_COLORS = [
  { id: "inferno-red", name: "Inferno Red", value: "#FF2D2D" },
  { id: "solar-orange", name: "Solar Orange", value: "#FF9500" },
  { id: "cyber-yellow", name: "Cyber Yellow", value: "#FFD700" },
  { id: "lime", name: "Lime", value: "#B4FF39" },
  { id: "neon-green", name: "Neon Green", value: "#00FF88" },
  { id: "electric-blue", name: "Electric Blue", value: "#0096FF" },
  { id: "cyan", name: "Cyan", value: "#00E5FF" },
  { id: "void-purple", name: "Void Purple", value: "#8A2BE2" },
  { id: "blueprint-blue", name: "Blueprint Blue", value: "#0066FF" },
  { id: "magenta", name: "Magenta", value: "#FF00E5" },
  { id: "pink", name: "Pink", value: "#FF4FA3" },
  { id: "white", name: "White", value: "#FFFFFF" },
] as const;

export const INTERFACE_THEMES = [
  { id: "NOVA CORE", name: "NOVA CORE", description: "Clean & bold" },
  { id: "PHANTOM PULSE", name: "PHANTOM PULSE", description: "Circular glow" },
  { id: "TITAN EDGE", name: "TITAN EDGE", description: "Aggressive scanner" },
  { id: "PRIME FORGE", name: "PRIME FORGE", description: "Key activation classic" },
  { id: "BLUEPRINT EDGE", name: "BLUEPRINT EDGE", description: "Blue robot console" },
] as const;

export const FONT_OPTIONS = [
  { id: "Orbitron", name: "Orbitron" },
  { id: "Montserrat", name: "Montserrat" },
  { id: "Poppins", name: "Poppins" },
  { id: "Rajdhani", name: "Rajdhani" },
  { id: "Space Grotesk", name: "Space Grotesk" },
  { id: "Inter", name: "Inter" },
] as const;

export type InterfaceThemeId = (typeof INTERFACE_THEMES)[number]["id"];
export type AccentColorId = (typeof ACCENT_COLORS)[number]["id"];
export type FontOptionId = (typeof FONT_OPTIONS)[number]["id"];

/** Each interface style carries its signature font — picking a style applies it. */
export const THEME_FONT: Record<InterfaceThemeId, FontOptionId> = {
  "NOVA CORE": "Orbitron",
  "PHANTOM PULSE": "Space Grotesk",
  "TITAN EDGE": "Rajdhani",
  "PRIME FORGE": "Montserrat",
  "BLUEPRINT EDGE": "Montserrat",
};

const DEFAULT_COLOR: AccentColorId = "solar-orange";
const DEFAULT_THEME: InterfaceThemeId = "NOVA CORE";
const DEFAULT_FONT: FontOptionId = "Orbitron";

const COLOR_KEY = "ea_migrate_color";
const THEME_KEY = "ea_migrate_theme";
const FONT_KEY = "ea_migrate_font";

export function accentColorValue(id: string): string {
  return (ACCENT_COLORS.find((color) => color.id === id) ?? ACCENT_COLORS[1]).value;
}

export function fontStack(id: string): string {
  return `'${id}', system-ui, sans-serif`;
}

type Customization = {
  color: AccentColorId;
  theme: InterfaceThemeId;
  font: FontOptionId;
};

const defaults: Customization = {
  color: DEFAULT_COLOR,
  theme: DEFAULT_THEME,
  font: DEFAULT_FONT,
};

let state: Customization = { ...defaults };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const storedColor = window.localStorage.getItem(COLOR_KEY) as AccentColorId | null;
  const storedTheme = window.localStorage.getItem(THEME_KEY) as InterfaceThemeId | null;
  const storedFont = window.localStorage.getItem(FONT_KEY) as FontOptionId | null;
  state = {
    color: storedColor ?? DEFAULT_COLOR,
    theme: storedTheme ?? DEFAULT_THEME,
    font: storedFont ?? DEFAULT_FONT,
  };
}

function persist() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(COLOR_KEY, state.color);
    window.localStorage.setItem(THEME_KEY, state.theme);
    window.localStorage.setItem(FONT_KEY, state.font);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: Customization = { ...defaults };

export function useCustomization() {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
}

export function setAccentColor(id: AccentColorId) {
  load();
  state = { ...state, color: id };
  persist();
}

export function setInterfaceTheme(id: InterfaceThemeId) {
  load();
  // The interface style also drives the font — its signature typeface ships with it.
  state = { ...state, theme: id, font: THEME_FONT[id] };
  persist();
}

export function setFontOption(id: FontOptionId) {
  load();
  state = { ...state, font: id };
  persist();
}
