/**
 * THE ROBOT VIDEO SWITCHES — one persisted background switch, one session stop
 * gate, one quality switch.
 *
 * PLACEMENT (owned by src/lib/shared-video.ts):
 *   • HOME                    → ALWAYS plays the video, whatever the switches
 *                               say: no button press, no gesture needed.
 *   • Settings and the other
 *     non-trading /app pages   → the video plays as a see-through background
 *                               only while the persisted Robot Video switch is
 *                               ON (Settings → Back Animation).
 *   • Metatrader, Scanner,
 *     Fundamentals             → never show the video at all (their route mode
 *                               is "none" — plain black, always).
 *
 * STOP (this file's session gate):
 *   Double-pressing HOME stops the video EVERYWHERE — Home's big screen
 *   included — and it STAYS stopped (it never auto-resumes behind the user's
 *   back). Double-press again, or flip the Settings switch on, to play again.
 *   The stop is session state on purpose: it must not silently flip the
 *   customer's saved preference, and a reload starts fresh.
 *
 * QUALITY:
 *   "Ultra HD (4K)" (on by default) renders the video at full clarity — no
 *   blur, a slightly stronger contrast/saturation, and a clear see-through
 *   opacity behind content. Off keeps the softer wash.
 *
 * The muted inline <video> element itself lives in shared-video.ts and
 * autoplays on iOS and Android alike.
 */
import { useSyncExternalStore } from "react";

const activeListeners = new Set<() => void>();
const autoListeners = new Set<() => void>();
const stopListeners = new Set<() => void>();
const ultraListeners = new Set<() => void>();

const AUTO_KEY = "robotVideoAuto";
const ULTRA_KEY = "robotVideoUltra";

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    /* storage blocked — the in-memory value still applies this session */
  }
}

/* ── the persisted "play the video behind Settings" switch ───────────────── */

/** The persisted "Robot Video" switch (Settings → Back Animation). */
export function isRobotVideoAuto(): boolean {
  return readFlag(AUTO_KEY, false);
}

/** Persisted "play the robot video as background" preference. */
export function setRobotVideoAuto(value: boolean): void {
  writeFlag(AUTO_KEY, value);
  // Turning the switch ON is an explicit "play": it lifts a HOME double-press
  // stop so the switch always does what it says.
  if (value) setRobotVideoStopped(false);
  autoListeners.forEach((listener) => listener());
}

export function subscribeVideoAuto(listener: () => void): () => void {
  autoListeners.add(listener);
  return () => autoListeners.delete(listener);
}

/** React view of the persisted switch (live — a flip repaints subscribers). */
export function useRobotVideoAuto(): boolean {
  return useSyncExternalStore(subscribeVideoAuto, isRobotVideoAuto, () => false);
}

export function notifyRobotVideoAutoChanged(): void {
  autoListeners.forEach((listener) => listener());
}

/* ── the session stop gate (HOME double-press) ───────────────────────────── */

/**
 * Stopped by the user on this session. False until a double-press says
 * otherwise, so Home keeps autoplaying by itself.
 */
let playbackStopped = false;

/** True while the user has stopped the video — every screen honours this. */
export function isRobotVideoStopped(): boolean {
  return playbackStopped;
}

/** Stop (`true`) or resume (`false`) playback on every host at once. */
export function setRobotVideoStopped(value: boolean): void {
  if (playbackStopped === value) return;
  playbackStopped = value;
  stopListeners.forEach((listener) => listener());
}

export function subscribeRobotVideoStopped(listener: () => void): () => void {
  stopListeners.add(listener);
  return () => stopListeners.delete(listener);
}

export function useRobotVideoStopped(): boolean {
  return useSyncExternalStore(subscribeRobotVideoStopped, isRobotVideoStopped, () => false);
}

/** HOME double-press / PLAY VIDEO: stop a playing video, or start a stopped one. */
export function toggleVideoPlayback(): void {
  setRobotVideoStopped(!playbackStopped);
}

/** True while the video is allowed to play anywhere. */
export function isVideoActive(): boolean {
  return !playbackStopped;
}

/** Direct setter — `false` stops every screen, `true` plays again. */
export function setVideoActive(value: boolean): void {
  setRobotVideoStopped(!value);
}

export function subscribeVideoActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

/* ── the quality switch ──────────────────────────────────────────────────── */

/** Ultra HD (4K) rendering — ON unless the user turned it off. */
export function isRobotVideoUltra(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ULTRA_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setRobotVideoUltra(value: boolean): void {
  writeFlag(ULTRA_KEY, value);
  ultraListeners.forEach((listener) => listener());
}

export function subscribeRobotVideoUltra(listener: () => void): () => void {
  ultraListeners.add(listener);
  return () => ultraListeners.delete(listener);
}

export function useRobotVideoUltra(): boolean {
  return useSyncExternalStore(subscribeRobotVideoUltra, isRobotVideoUltra, () => true);
}
