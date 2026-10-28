/**
 * THE ROBOT VIDEO SWITCH — one persisted state, three placement rules.
 *
 * The switch (`robotVideoAuto` in localStorage) is what the Settings → Back
 * Animation "Robot Video" row shows, what a double-press on the HOME tab
 * flips, and what the shared player (src/lib/shared-video.ts) reads:
 *
 *   • HOME                    → ALWAYS plays the video, whatever this switch
 *                               says: no button press, no gesture needed.
 *   • Settings and the other
 *     non-trading /app pages   → play the video as a see-through background
 *                               only while this switch is ON.
 *   • Metatrader, Scanner,
 *     Fundamentals             → never show the video at all (their route
 *                               mode is "none" — plain black, always).
 *
 * `setVideoActive` / `setRobotVideoAuto` / `toggleVideoPlayback` all write the
 * ONE persisted flag, so the HOME gesture, the play button and the Settings
 * row can never disagree about what is on. State survives navigation (module
 * state), and the muted inline <video> autoplays on iOS and Android alike.
 */
import { useSyncExternalStore } from "react";

const activeListeners = new Set<() => void>();
const autoListeners = new Set<() => void>();

const AUTO_KEY = "robotVideoAuto";

/** The persisted "Robot Video" switch (Settings → Back Animation). */
export function isRobotVideoAuto(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTO_KEY) === "true";
  } catch {
    return false;
  }
}

/** Live session state — seeded from the persisted switch. */
let videoActive = isRobotVideoAuto();

/** Write the ONE switch: persist it and wake every subscriber. */
function applyVideoSwitch(value: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(AUTO_KEY, value ? "true" : "false");
    } catch {
      /* storage blocked — the in-memory value still applies this session */
    }
  }
  const changed = videoActive !== value;
  videoActive = value;
  if (!changed) return;
  activeListeners.forEach((listener) => listener());
  autoListeners.forEach((listener) => listener());
}

/** HOME double-press / PLAY VIDEO: flip the switch (on → play, off → stop). */
export function toggleVideoPlayback(): void {
  applyVideoSwitch(!videoActive);
}

/** Direct setter (Settings → Robot Video row uses this). */
export function setVideoActive(value: boolean): void {
  applyVideoSwitch(value);
}

export function isVideoActive(): boolean {
  return videoActive;
}

export function subscribeVideoActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

/** Called whenever the Robot Video switch changes (on or off). */
export function notifyRobotVideoAutoChanged() {
  autoListeners.forEach((listener) => listener());
}

export function subscribeVideoAuto(listener: () => void): () => void {
  autoListeners.add(listener);
  return () => autoListeners.delete(listener);
}

/** Persisted "play the robot video as background" preference. */
export function setRobotVideoAuto(value: boolean): void {
  applyVideoSwitch(value);
}

/** React view of the persisted switch (live — a flip repaints subscribers). */
export function useRobotVideoAuto(): boolean {
  return useSyncExternalStore(subscribeVideoAuto, isRobotVideoAuto, () => false);
}
