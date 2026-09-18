/**
 * Double-tap-HOME video playback trigger.
 *
 * The user's uploaded robot video does NOT autoplay — the owner asked for a
 * deliberate gesture: pressing the HOME button twice starts playback. The nav
 * publishes a request here; every mounted RobotMedia subscribes and starts
 * playing wherever its media sits (picture slot on circle themes, background
 * on black themes).
 *
 * Navigation-safe: the first HOME press can mount the home screen (its
 * RobotMedia instances did not exist when the second press fires), so the
 * request timestamp is kept and freshly-mounted media checks it on mount.
 *
 * The "Robot Video" toggle in Settings → Back Animation uses the same bus,
 * plus a persisted auto flag so the video keeps playing on later visits.
 */

const listeners = new Set<() => void>();
const autoListeners = new Set<() => void>();

let lastRequestAt = 0;
const RECENT_WINDOW_MS = 1600;

const AUTO_KEY = "robotVideoAuto";

/** Called by the bottom nav when HOME is pressed twice in quick succession. */
export function requestVideoPlayback() {
  lastRequestAt = Date.now();
  listeners.forEach((listener) => listener());
}

/** Called whenever the Robot Video auto flag changes (on or off). */
export function notifyRobotVideoAutoChanged() {
  autoListeners.forEach((listener) => listener());
}

export function subscribeVideoAuto(listener: () => void): () => void {
  autoListeners.add(listener);
  return () => autoListeners.delete(listener);
}

/** True when a playback request fired moments ago (covers navigation remounts). */
export function wasPlaybackRequestedRecently(): boolean {
  return Date.now() - lastRequestAt < RECENT_WINDOW_MS;
}

/** Persisted "play the robot video as background" preference. */
export function isRobotVideoAuto(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTO_KEY) === "true";
  } catch {
    return false;
  }
}

export function setRobotVideoAuto(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
  notifyRobotVideoAutoChanged();
}

export function subscribeVideoRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
