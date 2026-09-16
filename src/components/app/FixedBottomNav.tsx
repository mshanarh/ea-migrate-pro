import { Link, useRouterState } from "@tanstack/react-router";
import { House, Server, Settings } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

const tabs = [
  { to: "/app/metatrader", label: "METATRADER", icon: Server },
  { to: "/app/home", label: "HOME", icon: House },
  { to: "/app/settings", label: "SETTINGS", icon: Settings },
] as const;

/**
 * The one and only bottom navigation for the EA Migrate Pro app.
 * It never changes with the interface theme — themes only swap the top content.
 */
export function FixedBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  return (
    <nav
      aria-label="App navigation"
      className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div
        className="flex h-20 w-full max-w-[430px] items-center justify-around rounded-[50px] px-4"
        style={{ backgroundColor: accent, boxShadow: `0 12px 44px ${accent}59` }}
      >
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
