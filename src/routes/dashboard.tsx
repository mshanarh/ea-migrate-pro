import { useEffect, useRef, useState } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Clock, LogOut, MessageCircle, Pause, Play, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { PortalLayout } from "@/components/PortalLayout";
import { OWNER_EMAILS, signOut, updateProfile, useCurrentAccount } from "@/lib/auth-store";
import {
  isPortalPaused,
  portalCloudConfigured,
  portalGetAccount,
  setPortalPaused,
} from "@/lib/portal-cloud";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mentor Dashboard — EA Migrate" },
      {
        name: "description",
        content:
          "Your EA Migrate mentor portal: licences, Expert Advisors, copy trading and website tools in one place.",
      },
      { property: "og:title", content: "Mentor Dashboard — EA Migrate" },
      {
        property: "og:description",
        content: "Manage licences, Expert Advisors, copy trading and your public website from your mentor portal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardLayout,
});

function DashboardLayout() {
  const account = useCurrentAccount();
  const navigate = useNavigate();

  useEffect(() => {
    if (!account) navigate({ to: "/signin" });
  }, [account, navigate]);

  // Live admin sync: the admin's decision (approve / reject / license limit)
  // lands on this device within seconds via the shared cloud store — the
  // mentor no longer has to sign out and back in to see the approval. Without
  // this poll a device kept its stale "pending" status forever.
  const accountRef = useRef(account);
  accountRef.current = account;
  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const pull = async () => {
      const current = accountRef.current;
      if (!current) return;
      // "PAUSE WORK" — a pending account has nothing to do but wait, and this
      // poll is the work. While it is paused we stop reading the cloud so a
      // person who stepped away is not holding a request every five seconds.
      // Resuming puts the account back on the very next tick (five seconds),
      // so a pause can never cost somebody their approval notice.
      if (isPortalPaused()) return;
      try {
        // Read the approval straight from the database. The old call went
        // through syncGetAccount, a TanStack server function whose route is not
        // served by the deployed build — it answered with the SPA shell, so the
        // poll silently did nothing and a mentor stayed "pending" after the
        // admin had already approved them.
        if (!portalCloudConfigured()) return;
        const result = await portalGetAccount(current.email);
        if (cancelled || !result.enabled || !result.account) return;
        const cloud = result.account;
        // The owner can only be upgraded by the poll, never downgraded — a
        // stale cloud record must not kick the admin off the console.
        const ownerUpgrade =
          OWNER_EMAILS.includes(cloud.email.toLowerCase())
            ? { role: "admin" as const, status: "approved" as const, licenseLimit: Math.max(cloud.licenseLimit, 2000) }
            : {};
        const next = { ...cloud, ...ownerUpgrade };
        if (next.status !== current.status || next.role !== current.role || next.licenseLimit !== current.licenseLimit) {
          updateProfile(current.id, { status: next.status, role: next.role, licenseLimit: next.licenseLimit });
        }
      } catch {
        /* transient network error — retried on the next tick */
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId]);

  if (!account) return null;

  if (account.status !== "approved") {
    return (
      <PortalLayout>
        <PendingPortal rejected={account.status === "rejected"} name={account.displayName} />
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <Outlet />
    </PortalLayout>
  );
}

/**
 * THE PENDING SCREEN — the whole portal for an account that has not been
 * approved.
 *
 * It leads with a TIMER because that is the honest picture: nothing here is
 * broken, something is being waited for. It also carries the only two actions
 * that mean anything in this state — Sign out, and Pause work (stop the live
 * check and come back to it later). The mentor navigation is not rendered
 * anywhere for this account; see PortalLayout.
 */
function PendingPortal({ rejected, name }: { rejected: boolean; name: string }) {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(isPortalPaused);
  // The timer keeps turning while the person is waiting and stops when they
  // pause — a paused screen should look paused.
  const spin = paused
    ? { duration: 0 }
    : { repeat: Infinity, ease: "linear" as const, duration: 8 };

  return (
    <div className="mx-auto max-w-lg py-6 text-center">
      <span className="glow-ring mx-auto flex size-24 items-center justify-center rounded-full border-2 border-primary/60 bg-primary/12">
        <motion.span
          animate={paused ? { opacity: 0.5 } : { rotate: 360 }}
          transition={spin}
          className="flex size-full items-center justify-center"
        >
          <Clock className="size-11 text-primary" aria-hidden="true" />
        </motion.span>
      </span>
      <h1 className="mt-6 text-3xl font-bold">
        {paused ? "Work paused" : rejected ? "Portal not approved" : "Portal pending approval"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {paused
          ? "We've stopped checking for your approval. Tap Resume work to pick it back up."
          : rejected
            ? "Your portal application was declined. Reach out to support and we'll look at it again."
            : `Thanks ${name}. Your mentor portal is waiting for an admin to approve it. You'll get full access to EAs, licences and signals as soon as it's approved.`}
      </p>

      <div className="panel mt-8 space-y-4 p-6 text-left">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">Verification in progress</p>
            <p className="text-sm text-muted-foreground">
              Every mentor portal is reviewed manually before licences are issued.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">Need it faster?</p>
            <p className="text-sm text-muted-foreground">
              Message support on WhatsApp with your registered email and we'll chase it up.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            const next = !paused;
            setPortalPaused(next);
            setPaused(next);
          }}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] text-sm font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? "Resume work" : "Pause work"}
        </button>
        <button
          type="button"
          onClick={() => {
            signOut();
            navigate({ to: "/signin" });
          }}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 text-sm font-semibold text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-300"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>

      <p className="mt-6 text-xs tracking-[0.2em] text-primary/80 uppercase">
        Status: {rejected ? "Rejected" : "Pending"}
      </p>
    </div>
  );
}
