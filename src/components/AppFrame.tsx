import { useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LineChart, Settings } from "lucide-react";
import { useAppState } from "@/lib/app-store";

const items = [
  { to: "/app/metatrader", label: "Metatrader", icon: LineChart },
  { to: "/app/home", label: "Home", icon: Home },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

export function AppFrame({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { settings } = useAppState();
  const effectStyle = settings.background === "Neon Grid"
    ? { backgroundImage: "linear-gradient(rgba(110,168,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(110,168,255,0.08) 1px, transparent 1px)", backgroundSize: "34px 34px" }
    : undefined;
  const shellStyle = {
    "--primary": settings.accentColor,
    "--ring": settings.accentColor,
    "--chart-1": settings.accentColor,
  } as React.CSSProperties;
  const homeHoldTimer = useRef<number | null>(null);
  const startHomeHold = () => {
    if (typeof window === "undefined") return;
    homeHoldTimer.current = window.setTimeout(() => window.dispatchEvent(new Event("eamp:home-hold")), 650);
  };
  const stopHomeHold = () => {
    if (homeHoldTimer.current !== null) window.clearTimeout(homeHoldTimer.current);
    homeHoldTimer.current = null;
  };

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden px-5 pt-6 pb-32" style={shellStyle}>
      {settings.background !== "None" && <div className="pointer-events-none fixed inset-0 opacity-60" style={effectStyle} />}
      <div className="relative flex-1">{children}</div>

      <nav className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(24rem,calc(100%-2rem))] items-center justify-between rounded-full border border-border/60 bg-card/80 p-2 backdrop-blur-xl">
        {items.map(({ to, label, icon: Icon }) => {
          const active = path === to || (to === "/app/settings" && path.startsWith("/app/settings"));
          return (
            <Link
              key={to}
              to={to}
              onPointerDown={to === "/app/home" ? startHomeHold : undefined}
              onPointerUp={to === "/app/home" ? stopHomeHold : undefined}
              onPointerLeave={to === "/app/home" ? stopHomeHold : undefined}
              onPointerCancel={to === "/app/home" ? stopHomeHold : undefined}
              className={active ? "flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground glow-ring" : "flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-muted-foreground"}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
