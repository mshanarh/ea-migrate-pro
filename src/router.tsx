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

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
