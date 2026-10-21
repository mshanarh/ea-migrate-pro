import { useSyncExternalStore } from "react";

/**
 * THE BACKGROUND PICTURE TOGGLE — ONE STATE, ONE KEY, EVERY SCREEN.
 *
 * The Settings switch used to live in its own little world: it wrote
 * `mediaDim` and dispatched an event, but the screens that paint a background
 * read the flag once on mount (or derived their switch state from the wrong
 * row), so flipping it appeared to do nothing. This module is now the single
 * source of truth: every component that paints a background subscribes
 * through `useBackgroundPicture()`, so a flip is visible on the SAME second on
 * the current screen and on every screen navigated to afterwards.
 *
 * One storage key only: `mediaDim` (kept from the original toggle so nobody's
 * saved choice is lost). Nothing else may invent a second place to save it.
 */

const KEY = "mediaDim";
/** Same-tab signal, kept so existing listeners (canvas effects) refresh too. */
const REFRESH_EVENT = "eamp:bg-effects";

/** Persisted state — OFF by default: solid black unless the person opts in. */
let on = false;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  on = readStored();
}

/** Follow a write made elsewhere (another tab, a legacy path) — one repaint. */
function syncFromStorage(): void {
  const stored = readStored();
  if (stored === on) return;
  loaded = true;
  on = stored;
  notify();
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** Turn the background picture on/off everywhere, immediately. */
export function setBackgroundPictureOn(value: boolean): void {
  load();
  if (on === value) return;
  on = value;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, on ? "true" : "false");
    } catch {
      /* storage blocked — keep the in-memory value, the toggle still works */
    }
    window.dispatchEvent(new Event(REFRESH_EVENT));
  }
  notify();
}

export function isBackgroundPictureOn(): boolean {
  load();
  return on;
}

export function toggleBackgroundPicture(): void {
  setBackgroundPictureOn(!isBackgroundPictureOn());
}

/** Window listeners are installed ONCE, not once per subscriber. */
let wired = false;
function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // Another tab (or a legacy write) changed it — follow along live, once per
  // actual change (the same-tab event fires alongside our own notify).
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) syncFromStorage();
  });
  window.addEventListener(REFRESH_EVENT, syncFromStorage);
}

export function subscribeBackgroundPicture(listener: () => void): () => void {
  load();
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBackgroundPicture(): boolean {
  return useSyncExternalStore(subscribeBackgroundPicture, isBackgroundPictureOn, () => false);
}
