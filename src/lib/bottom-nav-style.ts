import { useSyncExternalStore } from "react";

/**
 * THE FIFTEEN BOTTOM NAVIGATION LOOKS offered in Settings. Every one of them
 * keeps the same three destinations and colours the active tab with the app's
 * theme accent, so the colour cycle keeps working in all of them.
 */
export type BottomNavStyle =
  | "floating-pill" // Rounded glass bar with icons + labels (default / current look)
  | "icon-pill" // Floating pill, icons only
  | "classic-tabs" // Classic tab bar, icon above a text label
  | "compact-dots" // Compact icons with a dot under the active tab
  | "glass-bar" // Blurred translucent bar
  | "outlined-pill" // Thin border, no fill
  | "circle-dock" // Floating dock with a raised round centre button
  | "square-tiles" // Sharp corners, active tile filled
  | "underline-tabs" // Text labels with an underline on the active tab
  | "neon-glow" // Accent-lit edge, active tab glowing in the accent
  | "segmented-control" // One rounded track, active tab is a filled segment
  | "labels-above" // Small label above each icon
  | "rounded-tiles" // Every tab its own rounded tile, active one tinted
  | "gradient-bar" // Bar tinted with a gradient built from the accent
  | "capsule-active"; // Flat bar, active tab inside a filled capsule

export const BOTTOM_NAV_STYLE_OPTIONS: Array<{
  id: BottomNavStyle;
  name: string;
  description: string;
}> = [
  {
    id: "floating-pill",
    name: "Rounded Bar",
    description: "Default — rounded glass bar with icons and labels",
  },
  {
    id: "icon-pill",
    name: "Floating Icon Pill",
    description: "Floating pill with icons only",
  },
  {
    id: "classic-tabs",
    name: "Classic Labeled Tabs",
    description: "Tab bar with icon and text labels",
  },
  {
    id: "compact-dots",
    name: "Compact Icons + Dot",
    description: "Compact bar with an active dot",
  },
  {
    id: "glass-bar",
    name: "Glass Bar",
    description: "Blurred translucent bar with icons and labels",
  },
  {
    id: "outlined-pill",
    name: "Outlined Pill",
    description: "Thin border, no fill — outline only",
  },
  {
    id: "circle-dock",
    name: "Floating Circle Dock",
    description: "Round dock with a raised centre button",
  },
  {
    id: "square-tiles",
    name: "Square Tiles",
    description: "Sharp corners; the active tile is filled",
  },
  {
    id: "underline-tabs",
    name: "Underline Tabs",
    description: "Text labels with a coloured underline on the active tab",
  },
  {
    id: "neon-glow",
    name: "Neon Glow Bar",
    description: "Accent-lit edge with a glowing active tab",
  },
  {
    id: "segmented-control",
    name: "Segmented Control",
    description: "One rounded track; the active tab is a filled segment",
  },
  {
    id: "labels-above",
    name: "Labels On Top",
    description: "Small label above each icon, active tab tinted",
  },
  {
    id: "rounded-tiles",
    name: "Rounded Tiles",
    description: "Every tab its own rounded tile; the active one is tinted",
  },
  {
    id: "gradient-bar",
    name: "Gradient Bar",
    description: "Bar tinted with a gradient built from the accent colour",
  },
  {
    id: "capsule-active",
    name: "Active Capsule",
    description: "Flat bar; the active tab sits inside a filled capsule",
  },
];

const STYLE_KEY = "eamp.bottomNavStyle";
const STYLE_EVENT = "eamp:bottomnavstyle";
const DEFAULT_STYLE: BottomNavStyle = "floating-pill";

let state: BottomNavStyle = DEFAULT_STYLE;
let loaded = false;
const listeners = new Set<() => void>();

function isBottomNavStyle(value: unknown): value is BottomNavStyle {
  return BOTTOM_NAV_STYLE_OPTIONS.some((option) => option.id === value);
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(STYLE_KEY);
    if (isBottomNavStyle(saved)) state = saved;
  } catch {
    // Private mode / blocked storage — keep the default.
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);

  // Any writer of the shared key (this store, an older selector, another tab)
  // must push the new style into every mounted nav instantly.
  const sync = () => {
    let next = state;
    try {
      const saved = window.localStorage.getItem(STYLE_KEY);
      next = isBottomNavStyle(saved) ? saved : DEFAULT_STYLE;
    } catch {
      next = state;
    }
    if (next !== state) {
      state = next;
      emit();
    }
  };
  window.addEventListener(STYLE_EVENT, sync);
  window.addEventListener("storage", sync);
  return () => {
    listeners.delete(listener);
    window.removeEventListener(STYLE_EVENT, sync);
    window.removeEventListener("storage", sync);
  };
}

export function getBottomNavStyle(): BottomNavStyle {
  load();
  return state;
}

export function setBottomNavStyle(style: BottomNavStyle) {
  load();
  state = style;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STYLE_KEY, style);
    } catch {
      // Storage unavailable — the in-memory choice still applies this session.
    }
    window.dispatchEvent(new Event(STYLE_EVENT));
  }
  emit();
}

/**
 * Live bottom nav style — persisted per device, shared by Settings and every
 * mounted `FixedBottomNav`, so a selection re-renders the real nav everywhere
 * without a reload.
 */
export function useBottomNavStyle(): BottomNavStyle {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => DEFAULT_STYLE,
  );
}
