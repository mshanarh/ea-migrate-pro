import { useSyncExternalStore } from "react";

/**
 * Platform-adaptive UI — automatic device detection.
 *
 * The presentation layer reads this and switches between a Material-style
 * (Android) and an iOS-style rendering of the SAME screens: navigation,
 * dialogs/sheets, field shapes, corner radii, typography and safe-area
 * handling. No functional surface ever depends on it.
 *
 * Detection rules:
 *  - Chromium `navigator.userAgentData.platform` is authoritative when present
 *    ("Android" / "iOS" / "macOS").
 *  - iPadOS 13+ masquerades as desktop Safari ("Macintosh" UA), so a Mac UA
 *    with multi-touch is treated as iOS.
 *  - Classic UA strings are the fallback (iPhone / iPad / iPod / Android).
 *  - Everything else (desktop browsers) renders the Material-style variant,
 *    which matches the app's existing Android-first design.
 *
 * The pre-paint script injected in __root.tsx mirrors this exact logic and
 * stamps `platform-android` / `platform-ios` on <html> before first paint, so
 * the CSS layer (fonts, radii, safe areas) is correct with zero flash.
 */

export type Platform = "android" | "ios";

let cached: Platform | null = null;

type NavigatorUADataLike = {
  platform?: string;
};

function detect(): Platform {
  if (typeof navigator === "undefined") return "android";
  if (cached) return cached;

  let result: Platform = "android";
  try {
    const ua = navigator.userAgent ?? "";
    const uaData = (navigator as Navigator & { userAgentData?: NavigatorUADataLike }).userAgentData;
    const classicIos = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports a Mac UA — multi-touch gives it away.
    const ipadAsMac = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
    const isIos = classicIos || ipadAsMac || /^ios$/i.test(uaData?.platform ?? "") || (uaData?.platform === "macOS" && navigator.maxTouchPoints > 1);
    result = isIos ? "ios" : "android";
  } catch {
    result = "android";
  }

  cached = result;
  return result;
}

/** Plain (non-hook) read — safe on the server, always returns "android" there. */
export function getPlatform(): Platform {
  return detect();
}

/** CSS class stamped on <html> by the pre-paint script (see __root.tsx). */
export function platformHtmlClass(platform: Platform): string {
  return platform === "ios" ? "platform-ios" : "platform-android";
}

const listeners = new Set<() => void>();

/**
 * React hook for components. Hydration-safe: the server snapshot is always
 * "android" (the app's default presentation); client-only app routes resolve
 * the real platform from the very first render.
 */
export function usePlatform(): Platform {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => detect(),
    () => "android" as Platform,
  );
}
