/**
 * THE MENTOR PORTAL IS NOT THE APP.
 *
 * The app's customization (Settings font picker, interface styles, the
 * tap-to-cycle accent) is published to <html> as CSS custom properties by
 * root-level components — `InterfaceThemeSync`, `AccentVarSync`,
 * `ColourCycleTap`. Because those live in the ROOT route they also ran on the
 * mentor portal, so a font or accent chosen inside the Android app repainted
 * the portal: a glitch typeface and yellow/orange headings on a design that was
 * always dark with a blue accent.
 *
 * The portal must keep its own tokens — its own font, its own blue accent —
 * and it must never read the app's saved settings. This module draws that line:
 *
 *   • `isPortalPath` says which routes belong to the portal.
 *   • `applyShellScope` stamps `data-portal` on <html> (so CSS can hold the
 *     portal's own hardcoded tokens) and, when entering the portal, CLEARS the
 *     app's inline overrides so the stylesheet's defaults apply again.
 *
 * The app side is untouched: nothing here changes what the app writes while the
 * user is in the app.
 */
import { clearFontStack } from "./app-customization";
import { applyInterfaceDefinition } from "./interface-themes";
import { clearAccentTokens } from "./theme-tokens";

/** Route prefixes that belong to the mentor portal (and its auth screens). */
export const PORTAL_PREFIXES = ["/dashboard", "/admin", "/mentor", "/signin", "/signup"] as const;

/** True when this pathname is part of the portal, never the app. */
export function isPortalPath(pathname: string): boolean {
  const path = (pathname || "/").split(/[?#]/, 1)[0] ?? "/";
  return PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Put the document into the right shell.
 *
 * On the portal: every app customization token this same page load may have
 * published is removed — font, accent/primary/chart/glow colours, and the
 * interface-style tokens — so the portal paints itself with the values in
 * `src/styles.css` and nothing else.
 *
 * In the app: the attribute is removed and the app's own sync components (which
 * are mounted for app routes only) re-publish the user's choices.
 */
export function applyShellScope(portal: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!portal) {
    root.removeAttribute("data-portal");
    return;
  }
  root.setAttribute("data-portal", "true");
  clearFontStack();
  clearAccentTokens();
  applyInterfaceDefinition(null);
}
