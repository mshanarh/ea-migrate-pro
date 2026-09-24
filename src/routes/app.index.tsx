import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /app is a pure redirect to the login page — /app/login is the app's first
 * page, where the email is entered. The Whop checkout returns users to
 * /app?success=true, so the query is forwarded to keep that flow working.
 */
export const Route = createFileRoute("/app/")({
  ssr: false,
  beforeLoad: ({ location }) => {
    const success = new URLSearchParams(location.search).get("success");
    throw redirect({ href: success ? `/app/login?success=true` : "/app/login" });
  },
  component: () => null,
});
