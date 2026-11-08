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

/** How long each colour is shown — 2s, then an instant swap to the next. */
const STEP_MS = 2000;

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
    // NO BODY CLASS, NO TRANSITION — a step is one instant colour swap. The
    // class this used to toggle existed only to switch on a global
    // `* { transition }` rule, which froze the whole document at the moment
    // the cycle was started and then re-animated every coloured element on
    // every step (the reported jam). See the note in styles.css.
    timer = setInterval(() => {
      step = (step + 1) % cycleIds().length;
      notify();
    }, STEP_MS);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
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
