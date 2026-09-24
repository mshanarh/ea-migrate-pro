import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { runForceReset } from "./lib/force-reset";

// One-time forced logout — runs on app mount, BEFORE any route loads, so
// every existing session is cleared and its owner is sent to /app/login.
runForceReset();

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
