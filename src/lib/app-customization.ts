import { useSyncExternalStore } from "react";
import { colourCycleAccentId, subscribeColourCycle } from "@/lib/color-cycle";
import { setBottomNavStyle } from "@/lib/bottom-nav-style";
import { applyInterfaceDefinition, interfaceDefinitionFor } from "@/lib/interface-themes";

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
  { id: "SNIFFER", name: "Sniper", description: "Connected robot controls" },
  { id: "PHOENIX", name: "Phoenix", description: "Split control robot list" },
  { id: "VORTEX 1", name: "Vortex 1", description: "Glowing robot card" },
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
  {
    id: "Rubik Glitch",
    name: "Rubik Glitch",
    description: "Glitched Display",
  },
] as const;

export type InterfaceThemeId = (typeof INTERFACE_THEMES)[number]["id"];
export type AccentColorId = (typeof ACCENT_COLORS)[number]["id"];
export type FontOptionId = (typeof FONT_OPTIONS)[number]["id"];

/**
 * FONT AND INTERFACE STYLE ARE INDEPENDENT PREFS.
 *
 * An interface style owns colour, background, radii, borders, shadows, header
 * treatment and the bottom nav — never a typeface. Picking a style used to
 * overwrite the chosen font with the style's "signature" face, which is why
 * switching Quantum Blue → Ultron Mega silently reset the Settings choice.
 * There is deliberately no theme → font map any more.
 */

const DEFAULT_COLOR: AccentColorId = "solar-orange";
const DEFAULT_THEME: InterfaceThemeId = "NOVA CORE";
const DEFAULT_FONT: FontOptionId = "Orbitron";

const COLOR_KEY = "ea_migrate_color";
const THEME_KEY = "ea_migrate_theme";
const FONT_KEY = "ea_migrate_font";

export function accentColorValue(id: string): string {
  return (ACCENT_COLORS.find((color) => color.id === id) ?? ACCENT_COLORS[1]).value;
}

/**
 * THE WHOLE-APP FONT — ONE STACK, PUBLISHED AS A CSS VARIABLE.
 *
 * Every element in the app reads `--app-font` (see the font block in
 * styles.css), so the Settings choice reaches headers, body copy, numbers, the
 * bottom nav and the popups on EVERY interface style. Interface definitions no
 * longer carry a typeface of their own: a theme supplies colour, shape and
 * layout, the user supplies the font. The only face that may override the
 * choice is the choice itself (Rubik Glitch included, once it is picked).
 */
export const APP_FONT_VAR = "--app-font";

export function fontStack(id: string): string {
  return `'${id}', system-ui, -apple-system, "Segoe UI", sans-serif`;
}

/** Publish the selected font to <html>; safe to call on every render/effect. */
export function applyFontStack(id: string): string {
  const stack = fontStack(id);
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(APP_FONT_VAR, stack);
    document.documentElement.setAttribute("data-app-font", id);
  }
  return stack;
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
  // Tap-to-cycle interface colours (session-only, see color-cycle.ts): while
  // the effect runs, the theme's accent is the cycling one, so every screen
  // that derives colours from this hook shifts together. Nothing else in the
  // theme (or the stored preference) is touched.
  const cycleAccentId = useSyncExternalStore(
    subscribeColourCycle,
    colourCycleAccentId,
    () => null,
  );
  const base = useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
  return cycleAccentId ? { ...base, color: cycleAccentId as AccentColorId } : base;
}

export function setAccentColor(id: AccentColorId) {
  load();
  state = { ...state, color: id };
  persist();
}

export function setInterfaceTheme(id: InterfaceThemeId) {
  load();
  // STYLE TOKENS ONLY. The font is a SEPARATE app-level preference
  // (`ea_migrate_font` → `--app-font`) and is never rewritten here, so a style
  // switch cannot reset the user's chosen face.
  state = { ...state, theme: id };
  persist();
  // A styled interface is a WHOLE definition (lib/interface-themes.ts): its
  // nav shape ships with it and is applied immediately, exactly like its
  // colours/surfaces (published by InterfaceThemeSync).
  const definition = interfaceDefinitionFor(id);
  if (definition) {
    setBottomNavStyle(definition.navStyle);
    applyInterfaceDefinition(definition);
  } else {
    applyInterfaceDefinition(null);
  }
}

export function setFontOption(id: FontOptionId) {
  load();
  // The ONLY writer of the font preference — no interface style touches it.
  state = { ...state, font: id };
  persist();
}

/** Non-hook snapshot (route guards/tests) — never used to mutate state. */
export function getCustomization(): Customization {
  load();
  return state;
}
