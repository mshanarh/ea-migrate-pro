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
    // NOTE ON THE 8-SECOND GUARANTEE: `defaultSplashMs` /
    // `defaultSplashTimeoutMs` are NOT options in @tanstack/react-router
    // 1.170 — passing them is rejected by the type checker and ignored at
    // runtime. The hard stop therefore lives in the boot path, where it can
    // produce a real screen: the gate's own deadline (see below) and the
    // inline watchdog in __root.tsx. Nothing here reloads the page.
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
  /**
   * NO RELOAD WATCHDOG HERE — IT USED TO MAKE THE SPLASH PERMANENT.
   *
   * This used to `window.location.replace("/app/login")` after 8s whenever the
   * first navigation had not resolved. A reload cannot show a retry screen: it
   * restarts the whole boot, so a gate that legitimately needed longer than 8s
   * (the access check alone is allowed up to 15s, and the device-binding read
   * after it another 15s) was cut off at 8s, reloaded, and cut off again — the
   * black "Loading…" splash, forever, with no state that could ever recover.
   *
   * The 8s guarantee lives where it can actually produce a screen instead:
   * `requireVerifiedAccess` resolves with its `retry` verdict on a deadline
   * (BOOT_ACCESS_DEADLINE_MS in @/lib/payment-gate), so the guard lands on
   * /app/login with the retry line, and the inline boot watchdog in __root.tsx
   * replaces the splash if the bundle itself never gets as far as rendering.
   */
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
