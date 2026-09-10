import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/app/activate")({ ssr: false, component: LegacyActivationRedirect });

function LegacyActivationRedirect() {
  const navigate = useNavigate();
  useEffect(() => { navigate({ to: "/app", replace: true }); }, [navigate]);
  return null;
}
