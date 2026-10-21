/**
 * Tap-to-cycle INTERFACE colours — a session-only theme effect (never
 * persisted; a reload starts back in the user's normal theme).
 *
 * Tapping the plain background (see ColourCycleTap) starts the cycle through
 * EVERY colour Settings offers — the full Color palette, in the order the
 * picker shows it — and tapping again stops it, restoring the stored theme.
 *
 * The override lives at the theme source: `useCustomization()` returns the
 * cycling accent INSTEAD of the stored one while the effect runs, so every
 * screen and every colour token derived from the theme (buttons, borders,
 * glows, text accents, active nav item, charts, progress bars, popup borders
 * and the root CSS variables applied by AccentVarSync) shifts together from
 * ONE interval. The BACKGROUND (picture / black) is not touched.
 */

import { ACCENT_COLORS } from "./app-customization";

/** Every colour the Color section offers, in picker order (resolved lazily:
 *  app-customization imports this module, so the palette is read at call time,
 *  after both modules have finished initialising). */
let cachedIds: string[] | null = null;
function cycleIds(): string[] {
  if (!cachedIds) cachedIds = ACCENT_COLORS.map((entry) => entry.id);
  return cachedIds;
}

/** How long each colour is shown — 2s, with a ~0.4s ease between steps. */
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
  const ids = cycleIds();
  return ids[step % ids.length] ?? ids[0] ?? null;
}

/** Start/stop the cycle. Called by the global tap handler. */
export function toggleColourCycle(): void {
  active = !active;
  step = 0;
  if (active) {
    if (typeof document !== "undefined") {
      document.body.classList.add(BODY_CLASS);
    }
    timer = setInterval(() => {
      step = (step + 1) % cycleIds().length;
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
