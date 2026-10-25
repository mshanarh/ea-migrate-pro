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
  const origPush = history.push.bind(history);
  const origReplace = history.replace.bind(history);
  history.push = (...args) => {
    const result = origPush(...args);
    once();
    return result;
  };
  history.replace = (...args) => {
    const result = origReplace(...args);
    once();
    return result;
  };
}