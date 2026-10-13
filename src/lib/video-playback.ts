/**
 * Double-tap-HOME video playback — now a TOGGLE.
 *
 * The robot's picture always shows in the interface slots; the uploaded video
 * plays only as the full-screen background layer. Pressing HOME twice starts
 * it, pressing HOME twice again stops it (both iOS and Android — the muted
 * inline <video> is allowed to play on both). The nav publishes the toggle
 * here; the VideoBackdrop layers subscribe.
 *
 * State survives navigation (module state): toggled on while on another tab,
 * the video is already playing when the user returns home. The "Robot Video"
 * toggle in Settings → Back Animation persists via the auto flag — with it
 * on, playback starts by itself on later visits.
 */

const activeListeners = new Set<() => void>();
const autoListeners = new Set<() => void>();

const AUTO_KEY = "robotVideoAuto";

/** Persisted "play the robot video as background" preference (Settings toggle). */
export function isRobotVideoAuto(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTO_KEY) === "true";
  } catch {
    return false;
  }
}

/** Session playback state — starts on when the persisted auto flag is set. */
let videoActive = isRobotVideoAuto();

/** HOME double-press: play the background video — or stop it if playing. */
export function toggleVideoPlayback(): void {
  videoActive = !videoActive;
  activeListeners.forEach((listener) => listener());
}

/** Direct state setter (Settings → Robot Video toggle uses this). */
export function setVideoActive(value: boolean): void {
  if (videoActive === value) return;
  videoActive = value;
  activeListeners.forEach((listener) => listener());
}

export function isVideoActive(): boolean {
  return videoActive;
}

export function subscribeVideoActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

/** Called whenever the Robot Video auto flag changes (on or off). */
export function notifyRobotVideoAutoChanged() {
  autoListeners.forEach((listener) => listener());
}

export function subscribeVideoAuto(listener: () => void): () => void {
  autoListeners.add(listener);
  return () => autoListeners.delete(listener);
}

/** Persisted "play the robot video as background" preference. */
export function setRobotVideoAuto(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
  notifyRobotVideoAutoChanged();
}
