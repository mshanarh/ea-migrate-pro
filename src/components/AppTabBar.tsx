import { Link, useRouterState } from "@tanstack/react-router";
import { House, ScanLine, Wallet } from "lucide-react";

const tabs = [
  { to: "/app/home", label: "Home", icon: House },
  { to: "/app/scanner", label: "AI Scanner", icon: ScanLine },
  { to: "/app/metatrader", label: "MetaTrader", icon: Wallet },
] as const;

export function AppTabBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex h-20 w-full max-w-md items-center justify-around rounded-[40px] bg-[#FFA500] px-3 shadow-[0_10px_40px_rgba(255,165,0,0.35)]">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = path === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className="flex min-w-20 flex-col items-center justify-center gap-1 py-1"
            >
              <span
                className={`flex size-11 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-white text-[#E07B00]" : "text-black/55"
                }`}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              </span>
              <span className={`text-[11px] font-bold ${active ? "text-white" : "text-black/50"}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
