import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  BarChart3,
  Bot,
  ChevronRight,
  CircleUserRound,
  Globe2,
  KeyRound,
  LayoutGrid,
  ListOrdered,
  LogOut,
  Menu,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { signOut, useCurrentAccount } from "@/lib/auth-store";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; badge?: boolean; mentorOnly?: boolean; adminOnly?: boolean };

const sections: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
      { to: "/dashboard/licenses", label: "Generate Key", icon: KeyRound },
      { to: "/dashboard/eas", label: "Manage EAs", icon: Bot },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/dashboard/stats", label: "Key Stats", icon: BarChart3 },
      { to: "/dashboard/profile", label: "Profile", icon: CircleUserRound },
      { to: "/admin", label: "Admin console", icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    label: "Trading",
    items: [
      { to: "/dashboard/pairs", label: "Manage Pairs", icon: ListOrdered },
      { to: "/dashboard/signals", label: "Copy Trading", icon: ArrowLeftRight, badge: true },
    ],
  },
  {
    label: "My Wallet",
    items: [{ to: "/dashboard/wallet", label: "Wallet", icon: Wallet }],
  },
  {
    label: "Sales Page",
    items: [{ to: "/dashboard/website", label: "Website", icon: Globe2, badge: true, mentorOnly: true }],
  },
];

function BrandMark({ size = "size-9" }: { size?: string }) {
  return (
    <img src="/botlogic-mascot.png" alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  );
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [bright, setBright] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("eamp.portal.bright") === "1");
  const account = useCurrentAccount();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("portal-bright", bright);
    window.localStorage.setItem("eamp.portal.bright", bright ? "1" : "0");
  }, [bright]);

  const pageBg = bright ? "bg-[#10151c]" : "bg-[#0A0A0A]";
  const surfaceBg = bright ? "bg-[#151b23]" : "bg-[#0A0A0A]";

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.mentorOnly && account?.role !== "mentor") return false;
        if (item.adminOnly && account?.role !== "admin") return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  const sidebar = (
    <div className={`${surfaceBg} flex h-full flex-col overflow-y-auto`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <BrandMark />
        <p className="text-xl font-black tracking-tight">
          EA <span className="text-primary">Migrate</span> Pro
        </p>
      </div>

      <div className="px-4 py-4">
        <Link
          to="/dashboard/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/40"
        >
          <span className="flex size-12 items-center justify-center rounded-xl border-2 border-primary/70 text-primary">
            <CircleUserRound className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{account?.username ?? "Guest"}</span>
            <span className="block text-xs font-semibold capitalize text-primary">{account?.role ?? "mentor"}</span>
          </span>
          <ChevronRight className="size-4 text-white/40" />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 px-4 pb-4">
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.label ?? "main"} className={sectionIndex === 0 ? "space-y-1" : "space-y-1"}>
            {section.label && (
              <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white/35">{section.label}</p>
            )}
            {section.items.map(({ to, label, icon: Icon, badge }) => {
              const active = path === to || (to !== "/dashboard" && path.startsWith(to));
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={`flex h-12 items-center gap-3 rounded-2xl px-4 text-sm font-semibold transition-colors ${
                    active
                      ? "border border-primary/40 bg-primary/10 text-primary"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge && <span className="rounded-md bg-red-500 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">NEW!</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <button
          onClick={() => {
            signOut();
            navigate({ to: "/signin" });
          }}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 text-sm font-semibold text-white/70 transition-colors hover:border-red-400/40 hover:text-red-300"
        >
          <LogOut className="size-4" /> Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${pageBg} text-white`}>
      <header className={`sticky top-0 z-50 border-b border-white/10 ${pageBg} bg-gradient-to-r from-primary/35 via-primary/10 to-transparent`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  aria-label="Open portal menu"
                  className="flex size-11 items-center justify-center rounded-xl border border-white/15 bg-black/40"
                >
                  <Menu className="size-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 border-white/10 p-0">
                <SheetTitle className="sr-only">Portal menu</SheetTitle>
                {sidebar}
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
              <BrandMark size="size-8" />
              <span className="text-base font-black tracking-tight">
                EA <span className="text-primary">Migrate</span> Pro
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/dashboard/wallet"
              aria-label="Open wallet"
              className="flex size-11 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-primary transition-colors hover:bg-primary/20"
            >
              <Wallet className="size-5" />
            </Link>
            <button
              type="button"
              aria-label={bright ? "Dim the portal" : "Brighten the portal"}
              onClick={() => setBright((value) => !value)}
              className="flex size-11 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-primary transition-colors hover:bg-primary/20"
            >
              <Sun className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 lg:block">
          <div className="sticky top-16 h-[calc(100vh-4rem)]">{sidebar}</div>
        </aside>
        <main className="min-w-0 flex-1 px-5 py-8">
          {children}
          <footer className="mt-14 border-t border-white/10 pt-6">
            <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <BrandMark size="size-8" />
                <p className="text-sm font-black">
                  EA <span className="text-primary">Migrate</span> Pro
                  <span className="ml-3 font-normal text-white/45">© 2026 All rights reserved.</span>
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-300">
                <span className="size-2 rounded-full bg-emerald-400" /> Systems Online
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
