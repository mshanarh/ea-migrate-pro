/**
 * Safe access to the Android wrapper's native bridge (window.EAMigrate).
 *
 * The injected Java bridge object can go STALE: when the Android activity is
 * recreated (bubble tap re-opening the app, process restore) or the renderer
 * outlives the native side, the previously injected object throws
 * "Java bridge method can't be invoked on a non-injected object" on ANY call.
 * That exception used to escape effect cleanups in the bot popup and crash
 * the whole dashboard ("Dashboard didn't load").
 *
 * Rules baked in here:
 *  - window.EAMigrate is resolved FRESH on every call — never cached across
 *    renders/effects (a recreated activity injects a brand-new object).
 *  - Every invocation is try/caught: the bridge only powers nice-to-haves
 *    (PiP, chat-head bubble, log streaming, error reporting) and must never
 *    take the app down. A stale bridge degrades to "no native features".
 */
type NativeBridge = {
  canPip?: () => boolean;
  enterPip?: () => void;
  setAutoPip?: (on: boolean) => void;
  canOverlay?: () => boolean;
  /** Opens Android's "Display over other apps" settings for this app (v1.4+ wrappers). */
  requestOverlayPermission?: () => void;
  showBubble?: (image: string, name?: string) => void;
  hideBubble?: () => void;
  pushLog?: (line: string) => void;
  reportError?: (message: string) => void;
  openUrl?: (url: string) => void;
  /**
   * Post a "trade executed" heads-up. The Android side owns the channel and
   * the notification id, so the web app only supplies what to say.
   */
  showTradeNotification?: (eaName: string, text: string) => void;
  /**
   * False when Android 13+ has notifications switched off for this app, in which
   * case showTradeNotification is silently dropped by the OS. Callers use this
   * to tell the user WHY no alert arrived instead of appearing to be broken.
   */
  canPostNotifications?: () => boolean;
  /**
   * Opens this app's notification settings. Needed because a denied runtime
   * prompt is sticky: Android will not ask a second time, so the settings screen
   * is the only way back.
   */
  openNotificationSettings?: () => void;
};

function currentBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  try {
    const bridge = (window as unknown as { EAMigrate?: NativeBridge }).EAMigrate;
    return bridge && typeof bridge === "object" ? bridge : null;
  } catch {
    return null;
  }
}

/**
 * True when the web app runs inside the Android wrapper (a native bridge is
 * injected). Used to suppress WEB-side floating UI that would duplicate the
 * NATIVE chat-head bubble — inside the app there must be exactly ONE popup:
 * the native one that floats over MetaTrader.
 */
export function hasNativeBridge(): boolean {
  return currentBridge() !== null;
}

/**
 * Call a fire-and-forget bridge method. Returns true when the method ran;
 * false when the bridge is missing, stale, or the method doesn't exist —
 * callers treat false as "native feature unavailable", never as an error.
 */
export function callNative<K extends keyof NativeBridge>(
  method: K,
  ...args: Parameters<NonNullable<NativeBridge[K]>>
): boolean {
  try {
    const fn = currentBridge()?.[method];
    if (typeof fn !== "function") return false;
    (fn as (...callArgs: unknown[]) => void)(...args);
    return true;
  } catch {
    // Stale / non-injected bridge object — nothing native we can do. Ignore.
    return false;
  }
}

/**
 * Turn a web image reference into something the NATIVE bubble can actually
 * decode.
 *
 * The Java side reads two forms: a base64 data URL and an http(s) URL. The
 * app's own default bot picture is "/logo.png" — a site-RELATIVE path, which
 * the browser resolves against the origin but Java cannot, so the bubble fell
 * back to the app icon instead of the robot's face. That is now an absolute
 * URL.
 *
 * A blob: URL is worse: it only exists inside the WebView's own storage and
 * is unreachable from Java, so it is drawn onto a canvas here and handed over
 * as a data URL instead.
 */
export async function toNativeImage(src: string): Promise<string> {
  const value = (src ?? "").trim();
  if (!value) return value;
  if (value.startsWith("data:image") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (value.startsWith("blob:")) {
    try {
      const response = await fetch(value);
      const blob = await response.blob();
      return await new Promise<string>((resolve) => {
        const img = new Image();
        const done = (result: string) => resolve(result);
        img.onload = () => {
          try {
            // 320px is plenty for a chat-head avatar and keeps the payload
            // well inside the size Android will accept across the bridge.
            const size = Math.min(320, Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round((img.width / Math.max(img.width, img.height)) * size));
            canvas.height = Math.max(1, Math.round((img.height / Math.max(img.width, img.height)) * size));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              done(value);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const encoded = canvas.toDataURL("image/jpeg", 0.85);
            done(encoded.startsWith("data:image/") ? encoded : value);
          } catch {
            done(value);
          }
        };
        img.onerror = () => done(value);
        img.src = value;
      });
    } catch {
      return value;
    }
  }
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

/**
 * Query a bridge method that returns a value (canPip, canOverlay).
 * Returns null when the bridge is missing/stale so callers can distinguish
 * "no answer" from a real `false`.
 */
export function queryNative<K extends keyof NativeBridge>(
  method: K,
  ...args: Parameters<NonNullable<NativeBridge[K]>>
): ReturnType<NonNullable<NativeBridge[K]>> | null {
  try {
    const fn = currentBridge()?.[method];
    if (typeof fn !== "function") return null;
    return (fn as (...callArgs: unknown[]) => unknown)(...args) as ReturnType<NonNullable<NativeBridge[K]>>;
  } catch {
    return null;
  }
}
