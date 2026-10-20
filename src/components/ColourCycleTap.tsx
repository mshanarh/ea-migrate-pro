import { useEffect } from "react";
import { toggleColourCycle } from "@/lib/color-cycle";

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
