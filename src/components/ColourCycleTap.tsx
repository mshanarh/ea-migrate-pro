import { useEffect } from "react";
import { toggleColourCycle } from "@/lib/color-cycle";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { applyAccentTokens } from "@/lib/theme-tokens";

/**
 * Centre-tap surface for the interface colour cycle.
 *
 * ONE listener for the WHOLE app, registered once at the root in the CAPTURE
 * phase. The old version listened on `window` in the bubble phase and only
 * inside a small centre box, so any screen whose own handler stopped the event
 * (or whose card sat under the finger) never reached it — the gesture worked on
 * a few screens and did nothing on the rest.
 *
 * A tap only counts when it lands on the plain background: anything inside a
 * button, link, input, popup, dialog, card, the draggable bot or the bottom nav
 * is ignored, so controls keep their meaning.
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
].join(",");

/** Shells/backgrounds: reaching one of these means the tap was on open space. */
const SHELL =
  ".app-fullscreen, .app-scroll-area, main, body, canvas, [data-eamp-bg-host], [data-eamp-bg-layer]";

/**
 * Publishes the LIVE accent as root CSS variables — the shared theme tokens
 * any screen can use without prop drilling, and the single place that keeps
 * them in step with the theme AND the tap-to-cycle effect (the hook already
 * returns the cycling accent while it runs).
 */
export function AccentVarSync() {
  const { color } = useCustomization();
  useEffect(() => {
    applyAccentTokens(accentColorValue(color));
  }, [color]);
  return null;
}

/**
 * Did this tap land on plain background? Controls, popups, cards and the nav
 * all keep their own meaning; only open space belongs to the colour cycle.
 */
export function isPlainBackgroundTap(target: Element): boolean {
  if (target.closest(INTERACTIVE)) return false;

  // Walk up from the tapped node: the first genuinely painted box (a card,
  // panel, pill, table row…) means this was not the plain background.
  let node: Element | null = target;
  for (let depth = 0; node && depth < 8; depth += 1) {
    if (node.matches(SHELL)) return true;
    const style = window.getComputedStyle(node);
    const painted =
      style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      style.backgroundColor !== "transparent" &&
      style.backgroundColor !== "";
    const bordered = Number.parseFloat(style.borderTopWidth) > 0;
    const rounded = Number.parseFloat(style.borderTopLeftRadius) > 0;
    if (painted || (bordered && rounded)) return false;
    node = node.parentElement;
  }
  // Nothing painted between the tap and the document: plain background.
  return true;
}

export function ColourCycleTap() {
  useEffect(() => {
    const onTap = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // App screens only — marketing/portal pages keep their own clicks.
      if (!window.location.pathname.startsWith("/app")) return;
      if (!isPlainBackgroundTap(target)) return;
      toggleColourCycle();
    };
    // CAPTURE phase: no screen's own bubble-phase handler can swallow the tap.
    document.addEventListener("click", onTap, true);
    return () => document.removeEventListener("click", onTap, true);
  }, []);
  return null;
}

export default ColourCycleTap;
