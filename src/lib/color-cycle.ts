/**
 * Tap-to-cycle INTERFACE colours — a session-only theme effect (never
 * persisted; a reload starts back in the user's normal theme).
 *
 * Tapping the plain centre/background area (see ColourCycleTap) starts the
 * accent cycling red → blue → green → purple → orange every few seconds;
 * tapping again stops it and the interface returns to the stored theme. The
 * BACKGROUND (picture / black) is not touched — only interface colours.
 *
 * The override lives at the theme source: `useCustomization()` reads this
 * store and returns the cycling accent INSTEAD of the stored one while the
 * effect runs, so every screen that derives its accent from the theme
 * changes together — one interval, one store, no per-screen colour code and
 * no re-render storms (the interval fires once every few seconds).
 */

/**
 * The route the accent travels — real accent ids from ACCENT_COLORS, so every
 * token derived from the theme (accents, borders, glows, text accents,
 * canvas tint) shifts together.
 */
const CYCLE_ACCENT_IDS = [
  "inferno-red", // red
  "electric-blue", // blue
  "neon-green", // green
  "royal-purple", // purple
  "solar-orange", // orange
] as const;

/** How long each colour is shown — brisk (2s) and light on the battery. */
const STEP_MS = 2000;
/** Body flag while running — styles.css eases the colour shift under it. */
const BODY_CLASS = "eamp-colour-cycle";

let active = false;
let step = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** True when the cycle is running. */
export function isColourCycling(): boolean {
  return active;
}

/** The cycling accent id, or null when the effect is off (normal theme). */
export function colourCycleAccentId(): string | null {
  if (!active) return null;
  return CYCLE_ACCENT_IDS[step % CYCLE_ACCENT_IDS.length] ?? CYCLE_ACCENT_IDS[0] ?? null;
}

/** Start/stop the cycle. Called by the centre-tap handler. */
export function toggleColourCycle(): void {
  active = !active;
  step = 0;
  if (active) {
    if (typeof document !== "undefined") {
      document.body.classList.add(BODY_CLASS);
    }
    timer = setInterval(() => {
      step = (step + 1) % CYCLE_ACCENT_IDS.length;
      notify();
    }, STEP_MS);
  } else {
    if (typeof document !== "undefined") {
      document.body.classList.remove(BODY_CLASS);
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  notify();
}

/** Subscribe to cycle changes (stable identity for useSyncExternalStore). */
export function subscribeColourCycle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
