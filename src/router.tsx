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
 * THE GUARD SPLASH — what a route shows while its `beforeLoad` is still
 * waiting on the access check.
 *
 * Without this the router has nothing to render while the guard runs: the
 * previous screen just sits there frozen (or the page is blank on a cold
 * start), which reads as "the app hung" even when the check is healthy. The
 * splash appears as soon as a navigation is pending for `defaultPendingMs`
 * and is replaced by the screen the moment the guard answers.
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
    // GUARDS MUST FEEL ALIVE. `defaultPendingMs` is how long a route may be
    // pending before the splash above renders (the router's default is 1000ms,
    // which is a full second of frozen screen); `defaultPendingMinMs` keeps it
    // from flashing on navigations that resolve immediately — which is most of
    // them now that a warm access cache answers without any network call.
    defaultPendingMs: 150,
    defaultPendingMinMs: 400,
    defaultPendingComponent: RoutePending,
  });

  return router;
};
