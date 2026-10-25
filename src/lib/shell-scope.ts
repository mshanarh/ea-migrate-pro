/**
 * THREE SHELLS, THREE DESIGNS — app, mentor portal, public marketing.
 *
 * The app's customization (Settings font picker, interface styles, the
 * tap-to-cycle accent) is published to <html> as CSS custom properties by
 * root-level components — `InterfaceThemeSync`, `AccentVarSync`. Because those
 * live in the ROOT route they used to run EVERYWHERE, which is how the public
 * landing page ended up wearing the app's saved theme: its headings rendered in
 * the saved face (the default is Orbitron) and every `text-primary` / `bg-primary`
 * surface took the saved accent (the default is solar orange) instead of the
 * brand blue the stylesheet defines. The mentor portal was repainted the same
 * way, which is why it needed its own block in src/styles.css.
 *
 * This module draws the lines:
 *
 *   • `isPortalPath`  — /dashboard, /admin, /mentor and the portal's auth pages.
 *   • `isAppPath`     — /app/... : the ONLY place the user's customization shows.
 *   • everything else — the public marketing site, which keeps the stylesheet's
 *     own fonts and colours, exactly as it did before the app's tokens were
 *     published at the document root.
 *
 * `applyShellScope` then stamps the document for that shell and, outside the
 * app, CLEARS every inline token the app published so the stylesheet's values
 * apply again. The app side is untouched: nothing here changes what the app
 * writes while the user is in the app, and the saved preferences in storage are
 * never modified — so stepping into the portal (or the landing page) and back
 * cannot change the chosen font or theme.
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
 * True for the signed-in app (`/app/home`, `/app/settings`, …).
 *
 * This is the ONLY shell where the user's chosen font, interface style and
 * accent are published. A marketing page is not the app, and it must not look
 * like somebody's saved theme.
 */
export function isAppPath(pathname: string): boolean {
  const path = (pathname || "/").split(/[?#]/, 1)[0] ?? "/";
  return path === "/app" || path.startsWith("/app/");
}

export type ShellScope = "app" | "portal" | "marketing";

/** Which design owns this route. */
export function shellScopeFor(pathname: string): ShellScope {
  if (isPortalPath(pathname)) return "portal";
  if (isAppPath(pathname)) return "app";
  return "marketing";
}

/**
 * Put the document into the right shell.
 *
 *   app       — the app's own sync components (mounted for /app routes only)
 *               re-publish the user's choices; nothing is cleared here.
 *   portal    — `data-portal` is stamped so the portal's hardcoded tokens in
 *               src/styles.css apply, and every app token is removed.
 *   marketing — `data-marketing` is stamped and every app token is removed, so
 *               the landing page paints with the stylesheet's own fonts and
 *               brand colours (Inter, `--primary: #00a8ff`, `--ring: #38bdf8`).
 *
 * Clearing removes only INLINE properties on <html>; the saved preferences stay
 * in storage, so returning to the app restores exactly what the user picked.
 */
export function applyShellScope(scope: ShellScope): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (scope === "app") {
    root.removeAttribute("data-portal");
    root.removeAttribute("data-marketing");
    return;
  }

  if (scope === "portal") {
    root.setAttribute("data-portal", "true");
    root.removeAttribute("data-marketing");
  } else {
    root.removeAttribute("data-portal");
    root.setAttribute("data-marketing", "true");
  }

  // Not the app: the user's font, accent and interface tokens must not leak.
  clearFontStack();
  clearAccentTokens();
  applyInterfaceDefinition(null);
}
