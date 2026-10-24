import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  BarChart3,
  Bot,
  ChevronRight,
  CircleUserRound,
  Clock,
  Globe2,
  KeyRound,
  LayoutGrid,
  Pause,
  Play,
  RefreshCcw,
  LogOut,
  Menu,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import { Send } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { signOut, updateProfile, useCurrentAccount, type PortalStatus } from "@/lib/auth-store";
import { isPortalPaused, portalCloudConfigured, portalEnsureMentorId, setPortalPaused } from "@/lib/portal-cloud";
import { mirrorAccount } from "@/routes/dashboard.eas";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; badge?: boolean; mentorOnly?: boolean; adminOnly?: boolean };

const sections: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
      { to: "/dashboard/licenses", label: "Generate Key", icon: KeyRound },
      { to: "/dashboard/reactivate", label: "Re-activate Client", icon: RefreshCcw, adminOnly: true },
      { to: "/dashboard/eas", label: "Manage EAs", icon: Bot },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/dashboard/broadcast", label: "Broadcast", icon: Send },
      { to: "/dashboard/stats", label: "Key Stats", icon: BarChart3 },
      { to: "/dashboard/profile", label: "Profile", icon: CircleUserRound },
      { to: "/admin", label: "Admin Portal", icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    label: "Trading",
    items: [{ to: "/dashboard/signals", label: "Copy Trading", icon: ArrowLeftRight, badge: true }],
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
    <img src="/logo.png" alt="EA Migrate" className={`${size} shrink-0 rounded-full object-contain`} />
  );
}

/**
 * THE MENTOR ID BADGE — the three-digit number this mentor is known by.
 *
 * It sits in the sticky header, so it is on EVERY portal page and is the first
 * thing a mentor sees. The number is what a customer quotes back to support, so
 * it has to be readable at a glance and copyable by hand: three digits, always
 * zero-padded, in a monospaced face so "047" cannot be misread as "470".
 *
 * IT IS ASSIGNED ON ARRIVAL, NOT AT SIGNUP. Accounts created before mentor IDs
 * existed have none, and a mentor who signs in on a new device must not have to
 * wait for a fresh signup to be given their number — so the layout asks the
 * cloud for one on first sight and shows it as soon as it lands.
 *
 * While there is no ID yet, nothing is rendered: a placeholder like "—" beside
 * "MENTOR ID" would look like an assigned number, and a mentor who quotes an
 * empty one to a customer is worse off than one who simply has not been shown
 * it yet.
 */
function MentorIdBadge({
  email,
  mentorId,
  accountId,
}: {
  email: string;
  mentorId?: string | undefined;
  accountId?: string | undefined;
}) {
  const [id, setId] = useState<string | undefined>(mentorId);

  // The account arrives from the cloud poll, so the ID can show up after the
  // first render — adopt it whenever it changes.
  useEffect(() => {
    if (mentorId) setId(mentorId);
  }, [mentorId]);

  useEffect(() => {
    if (id || !email || !portalCloudConfigured()) return;
    let cancelled = false;
    void portalEnsureMentorId(email).then((result) => {
      if (cancelled || !result.ok || !result.mentorId) return;
      setId(result.mentorId);
      // Keep the rest of the portal in step — the sidebar card and the profile
      // page read the same account, and they should all show the same number.
      // `updateProfile` takes the ACCOUNT ID, not the email.
      if (accountId) updateProfile(accountId, { mentorId: result.mentorId });
    });
    return () => {
      cancelled = true;
    };
  }, [email, id, accountId]);

  if (!id) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2"
      title="Your unique mentor ID — quote this to support."
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">Mentor ID</span>
      <span className="font-mono text-base leading-none font-black tracking-[0.18em] text-primary tabular-nums">
        {id}
      </span>
    </div>
  );
}

/**
 * THE PENDING MENU — what the three-horizontal-lines button opens for an
 * account that has not been approved yet.
 *
 * It is the ONLY thing in that sheet. A pending signup used to be handed the
 * full mentor navigation — Generate Key, Manage EAs, Copy Trading, Wallet,
 * Website — none of which it can use, and every one of which leads to an empty
 * screen or a "not set yet" error. So the menu for an unapproved account shows
 * the waiting state itself: a timer, the sentence that says what is happening,
 * and the two things somebody in that state can actually do — sign out, or
 * pause the work while they wait.
 */
function PendingMenu({
  status,
  surfaceBg,
  onSignOut,
}: {
  status: PortalStatus;
  surfaceBg: string;
  onSignOut: () => void;
}) {
  const [paused, setPaused] = useState(isPortalPaused);
  const rejected = status === "rejected";
  // The timer keeps turning while the person is waiting and stops when they
  // pause — a paused screen should look paused.
  const spin = paused
    ? { duration: 0 }
    : { repeat: Infinity, ease: "linear" as const, duration: 8 };

  return (
    <div className={`${surfaceBg} flex h-full flex-col`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <BrandMark />
        <p className="text-xl font-black tracking-tight">
          EA <span className="text-primary">Migrate</span>
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <span className="glow-ring flex size-24 items-center justify-center rounded-full border-2 border-primary/60 bg-primary/10">
          <motion.span
            animate={paused ? { opacity: 0.55 } : { rotate: 360 }}
            transition={spin}
            className="flex size-full items-center justify-center"
          >
            <Clock className="size-11 text-primary" aria-hidden="true" />
          </motion.span>
        </span>

        <h2 className="mt-6 text-xl font-black tracking-tight">
          {paused ? "Work paused" : rejected ? "Application declined" : "Waiting for approval"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/60">
          {paused
            ? "We stopped checking for you. Tap Resume work whenever you want to pick it back up."
            : rejected
              ? "Your portal application was declined. Reach out to support and we'll look at it again."
              : "Your account is in the queue. An admin reviews every signup by hand, and the moment it's approved this menu becomes the real dashboard."}
        </p>

        <div className="mt-8 flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setPortalPaused(!paused);
              setPaused(!paused);
            }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] text-sm font-bold text-white/80 transition-colors hover:border-primary/40 hover:text-primary"
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {paused ? "Resume work" : "Pause work"}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 text-sm font-semibold text-white/70 transition-colors hover:border-red-400/40 hover:text-red-300"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
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

  // CLOUD EA MIRROR — re-publish the mentor's account (EAs with their
  // pictures included) once per browser session, from ANY portal page.
  // This is what puts the real robot picture into the cloud so clients'
  // phones can show it (robot card, floating bubble). Deduped per session
  // so navigating the portal doesn't spam writes.
  useEffect(() => {
    if (!account || account.eas.length === 0) return;
    if (sessionStorage.getItem("eamp.ea-mirror.done")) return;
    sessionStorage.setItem("eamp.ea-mirror.done", "1");
    void mirrorAccount(account);
  }, [account?.email, account?.eas.length]);

  const pageBg = bright ? "bg-[#10151c]" : "bg-[#0A0A0A]";
  const surfaceBg = bright ? "bg-[#151b23]" : "bg-[#0A0A0A]";

  // AN UNAPPROVED ACCOUNT GETS NO NAVIGATION AT ALL. Not a disabled one, not a
  // filtered one — none. Every item in `sections` leads to a page that needs an
  // approval this account does not have, so showing the menu meant showing a
  // list of doors that all fail. The hamburger and the desktop sidebar both
  // fall back to the pending screen instead.
  const pendingStatus: PortalStatus | null =
    account && account.status !== "approved" ? account.status : null;

  const signOutNow = () => {
    signOut();
    navigate({ to: "/signin" });
  };

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
          EA <span className="text-primary">Migrate</span>
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
            {/* The same ID as the header badge, so the desktop sidebar carries
                it too — this card is where a mentor looks when support asks. */}
            {account?.mentorId ? (
              <span className="mt-0.5 block font-mono text-[11px] font-bold tracking-[0.16em] text-primary/90 tabular-nums">
                ID {account.mentorId}
              </span>
            ) : null}
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
          onClick={signOutNow}
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
                {pendingStatus ? (
                  <PendingMenu
                    status={pendingStatus}
                    surfaceBg={surfaceBg}
                    onSignOut={signOutNow}
                  />
                ) : (
                  sidebar
                )}
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
              <BrandMark size="size-8" />
              <span className="text-base font-black tracking-tight">
                EA <span className="text-primary">Migrate</span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* THE MENTOR ID, at the top of the portal on every page. */}
            {account ? <MentorIdBadge email={account.email} mentorId={account.mentorId} accountId={account.id} /> : null}
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
        {pendingStatus ? null : (
          <aside className="hidden w-72 shrink-0 border-r border-white/10 lg:block">
            <div className="sticky top-16 h-[calc(100vh-4rem)]">{sidebar}</div>
          </aside>
        )}
        <main className="min-w-0 flex-1 px-5 py-8">
          {children}
          <footer className="mt-14 border-t border-white/10 pt-6">
            <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <BrandMark size="size-8" />
                <p className="text-sm font-black">
                  EA <span className="text-primary">Migrate</span>
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
