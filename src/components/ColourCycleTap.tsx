import { useEffect } from "react";
import { toggleColourCycle } from "@/lib/color-cycle";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

/**
 * Centre-tap surface for the interface colour cycle.
 *
 * Installs ONE delegated click listener. A tap starts/stops the colour cycle
 * only when it landed on the plain background/centre area — never on buttons,
 * inputs, links, popups, the draggable bot popup, the bottom nav or any other
 * interactive element. Nothing is persisted; a reload starts with the cycle
 * off in the normal theme.
 */

/**
 * Anything that already has a meaning when tapped keeps it — the cycle never
 * hijacks a control, a popup or the navigation.
 */
const INTERACTIVE = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "nav",
  "[role='button']",
  "[role='link']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='navigation']",
  "[role='toolbar']",
  "[contenteditable]",
  "[data-state]",
  "[data-radix-collection-item]",
  "[data-eamp-no-cycle]",
  ".plat-card",
  "[class*='plat-nav']",
].join(",");

/** Centre zone: the middle 70% of the viewport (edges belong to chrome). */
function inCentreZone(x: number, y: number): boolean {
  return (
    Math.abs(x - window.innerWidth / 2) <= window.innerWidth * 0.35 &&
    Math.abs(y - window.innerHeight / 2) <= window.innerHeight * 0.3
  );
}

/** Mix a hex towards black — the "deep" companion stop for gradients. */
function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Publishes the LIVE accent as root CSS variables — the shared theme tokens
 * any screen can use without prop drilling:
 *
 *   --accent        the accent itself
 *   --accent-deep   darkened accent (gradient partners, pressed states)
 *   --accent-soft   the accent at ~35% alpha (glows, soft shadows)
 *
 * It reads `useCustomization()`, which already honours the tap-to-cycle
 * override, so the variables update on every cycle step AND on normal theme
 * changes — live, with nothing cached on mount. Screens opened mid-cycle
 * pick the current values up immediately.
 */
export function AccentVarSync() {
  const { color } = useCustomization();
  useEffect(() => {
    const accent = accentColorValue(color);
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-deep", shadeHex(accent, 0.35));
    root.style.setProperty("--accent-soft", `${accent}59`);
  }, [color]);
  return null;
}

export function ColourCycleTap() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Only a plain primary tap; modified clicks belong to the browser.
      if (event.button !== 0 || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!inCentreZone(event.clientX, event.clientY)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest(INTERACTIVE)) return;
      toggleColourCycle();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);
  return null;
}

export default ColourCycleTap;
