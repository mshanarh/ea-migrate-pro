/**
 * Double-tap-HOME video playback trigger.
 *
 * The user's uploaded robot video does NOT autoplay — the owner asked for a
 * deliberate gesture: pressing the HOME button twice starts playback. The nav
 * publishes a request here; every mounted RobotMedia subscribes and starts
 * playing wherever its media sits (picture slot on circle themes, background
 * on black themes).
 *
 * Deliberately not persisted: playback always starts from a real tap.
 */

const listeners = new Set<() => void>();

/** Called by the bottom nav when HOME is pressed twice in quick succession. */
export function requestVideoPlayback() {
  listeners.forEach((listener) => listener());
}

export function subscribeVideoRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
