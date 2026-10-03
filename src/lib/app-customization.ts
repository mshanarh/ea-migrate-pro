import { useSyncExternalStore } from "react";

export const ACCENT_COLORS = [
  { id: "inferno-red", name: "Inferno Red", value: "#FF2D2D" },
  { id: "solar-orange", name: "Solar Orange", value: "#FF9500" },
  { id: "cyber-yellow", name: "Cyber Yellow", value: "#FFD700" },
  { id: "lime", name: "Lime", value: "#B4FF39" },
  { id: "neon-green", name: "Neon Green", value: "#00FF88" },
  { id: "emerald", name: "Emerald", value: "#10B981" },
  { id: "teal", name: "Teal", value: "#14B8A6" },
  { id: "electric-blue", name: "Electric Blue", value: "#0096FF" },
  { id: "cyan", name: "Cyan", value: "#00E5FF" },
  { id: "sky", name: "Sky", value: "#38BDF8" },
  { id: "blueprint-blue", name: "Blueprint Blue", value: "#0066FF" },
  { id: "indigo", name: "Indigo", value: "#6366F1" },
  { id: "void-purple", name: "Void Purple", value: "#8A2BE2" },
  { id: "royal-purple", name: "Royal Purple", value: "#A855F7" },
  { id: "magenta", name: "Magenta", value: "#FF00E5" },
  { id: "pink", name: "Pink", value: "#FF4FA3" },
  { id: "rose", name: "Rose", value: "#F43F5E" },
  { id: "gold", name: "Gold", value: "#E7B53A" },
  { id: "champagne", name: "Champagne", value: "#F5D491" },
  { id: "titanium", name: "Titanium", value: "#B8C0CC" },
  { id: "crimson", name: "Crimson", value: "#DC143C" },
  { id: "plasma", name: "Plasma Pink", value: "#FF2E88" },
  { id: "ultraviolet", name: "Ultraviolet", value: "#7B2FFF" },
  { id: "matrix", name: "Matrix Green", value: "#00FF41" },
  { id: "aquamarine", name: "Aquamarine", value: "#7FFFD4" },
  { id: "copper", name: "Copper", value: "#B87333" },
  // Algohost trade palette — the red/amber/green tokens the Android layer
  // uses for trade-execution notifications and the primary contact colour.
  { id: "algohost-red", name: "Algohost Red", value: "#E11D48" },
  { id: "algohost-amber", name: "Algohost Amber", value: "#F97316" },
  { id: "algohost-green", name: "Algohost Green", value: "#22C55E" },
  { id: "white", name: "White", value: "#FFFFFF" },
] as const;

export const INTERFACE_THEMES = [
  { id: "NOVA CORE", name: "NOVA CORE", description: "Clean & bold" },
  { id: "PHANTOM PULSE", name: "PHANTOM PULSE", description: "Circular glow" },
  { id: "TITAN EDGE", name: "TITAN EDGE", description: "Aggressive scanner" },
  { id: "PRIME FORGE", name: "PRIME FORGE", description: "Key activation classic" },
  { id: "BLUEPRINT EDGE", name: "BLUEPRINT EDGE", description: "Blue robot console" },
  { id: "CRIMSON NAVIGATOR", name: "CRIMSON NAVIGATOR", description: "Laid-back red console" },
  { id: "NAVIGATOR PLUS", name: "NAVIGATOR PLUS", description: "White circle on red" },
  { id: "PABLO CRIMSON", name: "PABLO CRIMSON", description: "Mentor favourite" },
  { id: "PABLO ELITE", name: "PABLO ELITE", description: "Sniper focus mode" },
  { id: "QUANTUM BLUE", name: "QUANTUM BLUE", description: "Ice-blue circle" },
  { id: "DARKWEB AI", name: "DARKWEB AI", description: "Black sniper studio" },
  { id: "SUPREME EQUINOX", name: "SUPREME EQUINOX", description: "Dual accent layout" },
  { id: "ULTRON MEGA", name: "ULTRON MEGA", description: "Heavy metal console" },
  { id: "EA CLOUD", name: "EA CLOUD", description: "Green ladder classic" },
  { id: "SNIFFER", name: "Sniper", description: "Echoing reticle centre" },
  { id: "PHOENIX", name: "Phoenix", description: "Rise from the embers" },
] as const;

export const FONT_OPTIONS = [
  { id: "Inter", name: "Inter", description: "Modern & Clean" },
  { id: "Space Grotesk", name: "Space Grotesk", description: "Futuristic Tech" },
  { id: "JetBrains Mono", name: "JetBrains Mono", description: "Monospace Coding" },
  { id: "Orbitron", name: "Orbitron", description: "Sci-Fi Digital" },
  { id: "Rajdhani", name: "Rajdhani", description: "Bold Angular" },
  { id: "Audiowide", name: "Audiowide", description: "Retro Gaming" },
  { id: "Michroma", name: "Michroma", description: "Wide Cinematic", pro: true },
  { id: "Teko", name: "Teko", description: "Mecha Industrial", pro: true },
  { id: "Syncopate", name: "Syncopate", description: "Editorial Bold", pro: true },
  { id: "Cinzel", name: "Cinzel", description: "Luxury Serif", pro: true },
  { id: "Major Mono Display", name: "Major Mono Display", description: "Brutalist Mono", pro: true },
  { id: "Bruno Ace SC", name: "Bruno Ace SC", description: "Hyper Modern", pro: true },
  { id: "Russo One", name: "Russo One", description: "Heavy Display", pro: true },
] as const;

export type InterfaceThemeId = (typeof INTERFACE_THEMES)[number]["id"];
export type AccentColorId = (typeof ACCENT_COLORS)[number]["id"];
export type FontOptionId = (typeof FONT_OPTIONS)[number]["id"];

/** Each interface style carries its signature font — picking a style applies it. */
export const THEME_FONT: Record<InterfaceThemeId, FontOptionId> = {
  "NOVA CORE": "Orbitron",
  "PHANTOM PULSE": "Space Grotesk",
  "TITAN EDGE": "Rajdhani",
  "PRIME FORGE": "Inter",
  "BLUEPRINT EDGE": "Inter",
  "CRIMSON NAVIGATOR": "Russo One",
  "NAVIGATOR PLUS": "Russo One",
  "PABLO CRIMSON": "Teko",
  "PABLO ELITE": "Teko",
  "QUANTUM BLUE": "Space Grotesk",
  "DARKWEB AI": "JetBrains Mono",
  "SUPREME EQUINOX": "Russo One",
  "ULTRON MEGA": "Rajdhani",
  "EA CLOUD": "Inter",
  "SNIFFER": "Orbitron",
  "PHOENIX": "Space Grotesk",
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
  // A font removed from the lineup falls back to the default instead of
  // rendering as an invisible system stack.
  const validFont = FONT_OPTIONS.some((option) => option.id === storedFont);
  state = {
    color: storedColor ?? DEFAULT_COLOR,
    theme: storedTheme ?? DEFAULT_THEME,
    font: validFont ? (storedFont as FontOptionId) : DEFAULT_FONT,
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
