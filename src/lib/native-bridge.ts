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
  showBubble?: (image: string) => void;
  hideBubble?: () => void;
  pushLog?: (line: string) => void;
  reportError?: (message: string) => void;
  openUrl?: (url: string) => void;
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
