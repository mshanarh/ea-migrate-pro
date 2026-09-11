import { useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LineChart, Settings } from "lucide-react";

const items = [
  { to: "/app/metatrader", label: "Metatrader", icon: LineChart },
  { to: "/app/home", label: "Home", icon: Home },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

export function AppFrame({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const homeHoldTimer = useRef<number | null>(null);
  const startHomeHold = () => {
    if (typeof window === "undefined") return;
    homeHoldTimer.current = window.setTimeout(() => window.dispatchEvent(new Event("eamp:home-hold")), 650);
  };
  const stopHomeHold = () => {
    if (homeHoldTimer.current !== null) window.clearTimeout(homeHoldTimer.current);
    homeHoldTimer.current = null;
  };

  return <div className="flex min-h-screen w-full flex-col bg-[#0A0A0A] text-white">
    <main className="min-h-0 flex-1">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-16 w-full items-center justify-around border-t border-white/10 bg-[#0A0A0A] px-4">
      {items.map(({ to, label, icon: Icon }) => {
        const active = path === to || (to === "/app/home" && path === "/app/pairs") || (to === "/app/settings" && path.startsWith("/app/settings"));
        const isHome = to === "/app/home";
        return <Link key={to} to={to} onPointerDown={isHome ? startHomeHold : undefined} onPointerUp={isHome ? stopHomeHold : undefined} onPointerLeave={isHome ? stopHomeHold : undefined} onPointerCancel={isHome ? stopHomeHold : undefined} className={active ? "flex min-w-20 flex-col items-center justify-center gap-1 px-2 py-2 text-[#38BDF8]" : "flex min-w-20 flex-col items-center justify-center gap-1 px-2 py-2 text-white/50"}><Icon className="size-5" /><span className="text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span></Link>;
      })}
    </nav>
  </div>;
}
