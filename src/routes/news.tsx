import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /news — alias to the FUNDAMENTALS economic calendar page. Every old link
 * and bookmark lands on the same live calendar.
 */
export const Route = createFileRoute("/news")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ href: "/app/fundamentals", replace: true });
  },
});
