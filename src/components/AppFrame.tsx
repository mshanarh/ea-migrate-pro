import { useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LineChart, Settings } from "lucide-react";
import { useAppState } from "@/lib/app-store";

const items = [
  { to: "/app/metatrader", label: "Metatrader", icon: LineChart },
  { to: "/app/home", label: "Home", icon: Home },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

function accentRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((part) => part + part).join("") : clean;
  const number = Number.parseInt(value, 16);
  if (!Number.isFinite(number)) return "rgba(110,168,255," + alpha + ")";
  return "rgba(" + ((number >> 16) & 255) + "," + ((number >> 8) & 255) + "," + (number & 255) + "," + alpha + ")";
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { settings } = useAppState();
  const accent = settings.accentColor;
  const effectStyle = settings.background === "Neon Grid"
    ? { backgroundImage: "linear-gradient(" + accentRgba(accent, 0.09) + " 1px, transparent 1px), linear-gradient(90deg, " + accentRgba(accent, 0.09) + " 1px, transparent 1px)", backgroundSize: "34px 34px" }
    : undefined;
  const fontFamily = {
    Normal: "ui-sans-serif, system-ui, sans-serif",
    Inter: "Inter, ui-sans-serif, system-ui, sans-serif",
    "Fugaz One": "'Fugaz One', Trebuchet MS, sans-serif",
    Rajdhani: "'Rajdhani', Arial Narrow, sans-serif",
    "Black Ops One": "'Black Ops One', Impact, sans-serif",
    Audiowide: "'Audiowide', Trebuchet MS, sans-serif",
    "Rubik Glitch": "'Rubik Glitch', fantasy",
  }[settings.font] || "ui-sans-serif, system-ui, sans-serif";
  const shellStyle = {
    "--primary": accent,
    "--ring": accent,
    "--chart-1": accent,
    "--glow": "0 0 40px " + accentRgba(accent, 0.35),
    "--glow-soft": "0 0 24px " + accentRgba(accent, 0.2),
    fontFamily,
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

  return <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden px-5 pt-6 pb-28" style={shellStyle}>
    {settings.background !== "None" && <div className="pointer-events-none fixed inset-0 opacity-60" style={effectStyle} />}
    <div className="relative flex-1">{children}</div>
    <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[5.5rem] w-full max-w-md items-end justify-around border-t border-primary/40 bg-background/95 px-4 pb-3 pt-2 backdrop-blur-xl">
      {items.map(({ to, label, icon: Icon }) => {
        const active = path === to || (to === "/app/settings" && path.startsWith("/app/settings"));
        const isHome = to === "/app/home";
        return <Link key={to} to={to} onPointerDown={isHome ? startHomeHold : undefined} onPointerUp={isHome ? stopHomeHold : undefined} onPointerLeave={isHome ? stopHomeHold : undefined} onPointerCancel={isHome ? stopHomeHold : undefined} className={isHome && active ? "relative -mt-10 flex size-16 flex-col items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-glow" : active ? "flex min-w-20 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-primary" : "flex min-w-20 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-muted-foreground"}><Icon className={isHome && active ? "size-7" : "size-5"} /><span className={isHome && active ? "mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary" : "text-[10px] font-bold uppercase tracking-[0.1em]"}>{label}</span></Link>;
      })}
    </nav>
  </div>;
}
