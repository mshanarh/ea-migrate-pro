import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { runForceReset } from "./lib/force-reset";

// One-time forced logout — runs on app mount, BEFORE any route loads, so
// every existing session is cleared and its owner is sent to /app/login.
runForceReset();

/**
 * Lazy routes import hashed chunks (assets/*.js) that a redeploy replaces.
 * A tab left open across deploys (the common way users re-open the app from
 * a phone home screen) then asks for an OLD chunk → 404 → the router's error
 * screen ("This page didn't load") even though the site is healthy. Vite
 * emits vite:preloadError for exactly this failure class — hard-reload once:
 * fresh HTML references the new chunks and the app comes back. One attempt
 * per URL per session keeps a genuinely broken deploy from reload-looping.
 */
function reloadForFreshAssets() {
  try {
    const flag = "eamp.chunk-reload";
    const entry = window.sessionStorage.getItem(flag);
    const stamp = `${Date.now()}|${window.location.pathname}`;
    if (entry === stamp) return; // already retried this URL this session
    window.sessionStorage.setItem(flag, stamp);
  } catch {
    /* storage blocked — reload anyway, the guard is best-effort */
  }
  window.location.replace(window.location.pathname + window.location.search);
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForFreshAssets();
  });
}

/**
 * THE COLD-BOOT SPLASH — the ONLY moment this is allowed on screen.
 *
 * On a cold start nothing has rendered yet, so the alternative is a blank
 * page while the first guard runs. That is the one case where a splash is
 * honest: there is no screen behind it to keep.
 *
 * It is never shown over a renderable screen: after the first navigation
 * resolves, `defaultPendingMs` is raised to Infinity (see `getRouter` below),
 * which makes the router keep presenting the CURRENT screen while the next
 * one loads. A tap therefore never replaces what the person is looking at —
 * with a cached access verdict the guard answers synchronously, so the new
 * screen arrives on the same frame anyway.
 */
function RoutePending() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-white">
      <img
        src="/logo.png"
        alt=""
        className="size-14 rounded-2xl border border-white/10 bg-white/5 object-contain p-1"
      />
      <span
        aria-hidden
        className="size-5 animate-spin rounded-full border-2 border-white/15 border-t-white"
      />
      <p className="text-sm font-semibold text-white/55">Loading…</p>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // PRELOAD ON INTENT — the moment a user touches/intends a tab, its route
    // chunk starts downloading, so the tap itself renders from an in-memory
    // module instead of a network round trip.
    defaultPreload: "intent",
    // COLD BOOT may show the splash after this long (the router's default is
    // 1000ms — a full second of blank screen). The minimum is 0, so a fast
    // first load never flashes it.
    defaultPendingMs: 150,
    defaultPendingMinMs: 0,
    defaultPendingComponent: RoutePending,
  });

  /**
   * NEVER COVER A RENDERED SCREEN WITH THE SPLASH.
   *
   * `offerPending` only swaps the presented lane for a pending one when the
   * delay is a finite number; `Infinity` makes it return without presenting,
   * so the PREVIOUS screen stays on screen until the new lane is ready —
   * exactly what an instant-feeling tap means. It is raised only after the
   * first navigation has resolved, so the cold-boot splash above is kept for
   * a genuinely empty first paint.
   */
  let paintedOnce = false;
  const stopWatching = router.subscribe("onResolved", () => {
    if (paintedOnce) return;
    paintedOnce = true;
    stopWatching();
    try {
      router.update({ ...router.options, defaultPendingMs: Infinity });
    } catch (error) {
      // A failed options update must never break navigation — the guards are
      // synchronous on a warm cache anyway, so the splash stays cold-boot-only
      // in practice.
      console.warn("[router] could not disable the pending splash:", error);
    }
  });

  return router;
};
