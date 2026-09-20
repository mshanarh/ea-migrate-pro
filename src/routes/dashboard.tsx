import { useEffect, useRef } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Clock, ShieldCheck, MessageCircle } from "lucide-react";
import { PortalLayout } from "@/components/PortalLayout";
import { updateProfile, useCurrentAccount } from "@/lib/auth-store";
import { syncGetAccount } from "@/lib/account-sync.server";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mentor Dashboard — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Your EA Migrate Pro mentor portal: licences, Expert Advisors, copy trading and website tools in one place.",
      },
      { property: "og:title", content: "Mentor Dashboard — EA Migrate Pro" },
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
      try {
        const result = await syncGetAccount({ data: { email: current.email } });
        if (cancelled || !result.enabled || !result.account) return;
        const cloud = result.account;
        if (cloud.status !== current.status || cloud.role !== current.role || cloud.licenseLimit !== current.licenseLimit) {
          updateProfile(current.id, { status: cloud.status, role: cloud.role, licenseLimit: cloud.licenseLimit });
        }
      } catch {
        /* transient network error — retried on the next tick */
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 4000);
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

function PendingPortal({ rejected, name }: { rejected: boolean; name: string }) {
  return (
    <div className="mx-auto max-w-lg py-6 text-center">
      <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/12 glow-ring">
        <Clock className="size-9 text-primary" />
      </span>
      <h1 className="mt-6 text-3xl font-bold">
        {rejected ? "Portal not approved" : "Portal pending approval"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {rejected
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

      <p className="mt-6 text-xs tracking-[0.2em] text-primary/80 uppercase">Status: {rejected ? "Rejected" : "Pending"}</p>
    </div>
  );
}
