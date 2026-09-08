import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LineChart, Settings } from "lucide-react";

const items = [
  { to: "/app/metatrader", label: "Metatrader", icon: LineChart },
  { to: "/app/home", label: "Home", icon: Home },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

export function AppFrame({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pt-6 pb-32">
      <div className="flex-1">{children}</div>

      <nav className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(24rem,calc(100%-2rem))] items-center justify-between rounded-full border border-border/60 bg-card/80 p-2 backdrop-blur-xl">
        {items.map(({ to, label, icon: Icon }) => {
          const active = path === to || (to === "/app/settings" && path.startsWith("/app/settings"));
          return (
            <Link
              key={to}
              to={to}
              className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground glow-ring"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
