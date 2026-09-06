import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  LayoutGrid,
  Code2,
  Radio,
  KeyRound,
  BarChart3,
  Wallet,
  UserCircle2,
  LogOut,
  PanelLeft,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { signOut, useCurrentAccount } from "@/lib/auth-store";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/dashboard/eas", label: "Manage EAs", icon: Code2 },
  { to: "/dashboard/signals", label: "Signals", icon: Radio },
  { to: "/dashboard/licenses", label: "Licenses", icon: KeyRound },
  { to: "/dashboard/stats", label: "Key Stats", icon: BarChart3 },
  { to: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { to: "/dashboard/profile", label: "Profile", icon: UserCircle2 },
] as const;

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const account = useCurrentAccount();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const menu = (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map(({ to, label, icon: Icon }) => {
        const active = path === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={() => setOpen(false)}
            className={`flex h-12 items-center gap-3 rounded-full px-4 text-sm font-semibold transition-colors ${
              active
                ? "bg-primary text-primary-foreground glow-ring"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon className="size-4" /> {label}
          </Link>
        );
      })}
      <button
        onClick={() => {
          signOut();
          navigate({ to: "/signin" });
        }}
        className="flex h-12 items-center gap-3 rounded-full px-4 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <LogOut className="size-4" /> Logout
      </button>
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open portal menu"
                className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card/60 lg:hidden"
              >
                <PanelLeft className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-border/60 bg-background/98 p-0 pt-14">
              <SheetTitle className="px-5 text-base font-bold">
                EA <span className="text-primary">Migrate</span> Pro
              </SheetTitle>
              {menu}
              <div className="mt-auto border-t border-border/60 p-5 text-xs text-muted-foreground">
                {account?.displayName ?? "Guest"}
                <br />© 2026 EA Migrate Pro
              </div>
            </SheetContent>
          </Sheet>

          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 glow-ring">
              <Bot className="size-4 text-primary" />
            </span>
            <span className="text-base font-bold tracking-tight uppercase">
              EA <span className="text-primary">Migrate</span> Pro
            </span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="hidden w-64 shrink-0 border-r border-border/60 lg:block">
          <div className="sticky top-16">{menu}</div>
        </aside>
        <main className="min-w-0 flex-1 px-5 py-8">{children}</main>
      </div>
    </div>
  );
}
