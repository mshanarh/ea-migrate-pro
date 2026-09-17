import { Link, useRouterState } from "@tanstack/react-router";
import { House, Server, ScanLine } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

const tabs = [
  { to: "/app/metatrader", label: "METATRADER", icon: Server },
  { to: "/app/home", label: "HOME", icon: House },
  { to: "/app/scanner", label: "SCANNER", icon: ScanLine },
] as const;

/**
 * The one and only bottom navigation for the EA Migrate Pro app.
 * Native app style: docked edge-to-edge at the bottom, rounded top corners only.
 * It never changes with the interface theme — themes only swap the top content.
 */
export function FixedBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  return (
    <nav
      aria-label="App navigation"
      className="fixed inset-x-0 bottom-0 z-50 w-full"
      style={{ paddingTop: "env(safe-area-inset-bottom)", backgroundColor: accent, boxShadow: `0 -8px 40px ${accent}73`, borderRadius: "32px 32px 0 0" }}
    >
      <div className="flex h-[80px] w-full items-center justify-around px-6">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = path === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className="flex min-w-[76px] flex-col items-center justify-center gap-1.5"
            >
              <span
                className={`flex size-12 items-center justify-center rounded-full transition-transform duration-200 ${active ? "scale-105" : ""}`}
                style={active ? { backgroundColor: "#ffffff", color: accent } : { color: "rgba(0,0,0,0.55)" }}
              >
                <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
              </span>
              <span
                className="text-[11px] font-black tracking-[0.14em]"
                style={{ color: active ? "#ffffff" : "rgba(0,0,0,0.5)" }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
