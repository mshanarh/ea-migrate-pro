/**
 * STARTUP TIMING — measure each boot step in milliseconds.
 *
 * Usage: START.timing(label) marks a point, START.report() dumps the delta log.
 * Call START.report() once at a known "done" point (e.g. after first screen render)
 * to see the full timeline. All values are absolute timestamps (Date.now() when called).
 *
 * The first call to START() seeds the base time. Subsequent calls record deltas.
 * Works in both browser and Node (SSR). No dependencies.
 */
const START = (function () {
  let base: number | null = null;
  const marks: Map<string, number> = new Map();

  function now(): number {
    return typeof window !== "undefined" ? Date.now() : Date.now();
  }

  function start(label: string): void {
    // First call seeds the base time so all deltas are relative to app launch
    if (base === null) {
      base = now();
    }
    marks.set(label, now());
  }

  function report(): void {
    if (base === null) {
      console.log("[startup] no timing marks recorded");
      return;
    }
    const elapsed = now() - base;
    const lines: string[] = [];
    lines.push(`[startup] total elapsed: ${elapsed}ms`);
    for (const [label, mark] of marks) {
      const delta = mark - base;
      lines.push(`[startup]  ${label}: ${delta}ms`);
    }
    console.log(lines.join("\n"));
  }

  function reset(): void {
    base = null;
    marks.clear();
  }

  return { start, report, reset };
})();

export { START };

// Auto-report on navigation end for SPAs — this captures the initial boot timeline
// when the root route settles. It runs after the first paint so it doesn't block
// anything, and it only fires once per app launch (the first time the root route
// stabilises).
if (typeof window !== "undefined") {
  let reported = false;
  const once = () => {
    if (!reported) {
      reported = true;
      START.report();
    }
  };
  // When TanStack Router fires the final navigation settle, report timing.
  // We listen on the global router state change; the root route's beforeLoad
  // + component mount is a reliable signal the boot is done.
  // THE TIMING HOOK MUST NEVER BE ABLE TO BREAK BOOT.
  //
  // THE DOM HISTORY OBJECT HAS pushState/replaceState — NOT push/replace.
  // Patching `history.push` used to throw `Cannot read properties of undefined
  // (reading 'bind')` at module load, which took down every importer (this
  // module is pulled in by app-store, i.e. the whole boot graph) and left the
  // black "Loading…" splash up forever — exactly what production showed. This
  // block is a DIAGNOSTIC, so every step of it is best-effort: a browser
  // without the History API (or one that refuses the assignment) now loses the
  // timing marks and nothing else.
  try {
    if (typeof window.history?.pushState === "function") {
      const origPushState = window.history.pushState.bind(window.history);
      window.history.pushState = (...args: Parameters<History["pushState"]>) => {
        origPushState(...args);
        once();
      };
    }
    if (typeof window.history?.replaceState === "function") {
      const origReplaceState = window.history.replaceState.bind(window.history);
      window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
        origReplaceState(...args);
        once();
      };
    }
  } catch (error) {
    console.warn("[startup] history timing hook unavailable:", error);
  }
}