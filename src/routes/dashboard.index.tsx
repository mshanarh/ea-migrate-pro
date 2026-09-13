import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, ShieldCheck } from "lucide-react";
import { useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/")({
  ssr: false,
  component: Overview,
});

function Overview() {
  const account = useCurrentAccount();
  if (!account) return null;

  const activeSubscriptions = account.licenses.filter((license) => license.active).length;
  const stats = [
    { label: "Total Licences", value: account.licenses.length, note: "Licence keys issued from your account." },
    { label: "Active Subscriptions", value: activeSubscriptions, note: "Licence keys currently enabled." },
    { label: "Total EAs", value: account.eas.length, note: "Expert Advisors available for your clients." },
    { label: "Maximum Licences", value: account.licenseLimit, note: "Maximum keys set by your admin." },
  ];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-primary uppercase">
            <Activity className="size-4" /> System status
          </p>
          <h1 className="mt-2 text-3xl font-bold">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Welcome back, <span className="font-semibold text-primary">{account.displayName}</span>!
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-300">
          <ShieldCheck className="size-4" /> All systems running smoothly
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Today · {today}
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel p-6 glow-ring">
            <p className="text-sm font-semibold text-muted-foreground">{s.label}</p>
            <p className="mt-3 text-4xl font-bold text-primary">{s.value}</p>
            <p className="mt-3 text-sm text-muted-foreground">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-6">
          <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">Licence capacity</p>
          <h2 className="mt-2 text-xl font-bold">
            {Math.max(0, account.licenseLimit - account.licenses.length)} keys remaining
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account can generate up to {account.licenseLimit} licences. Generated keys are enabled by default.
          </p>
          <Link
            to="/dashboard/licenses"
            className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
          >
            Generate a key <ArrowRight className="size-4" />
          </Link>
        </div>
        {account.role === "admin" && (
          <div className="panel border-primary/30 bg-primary/5 p-6">
            <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">Admin controls</p>
            <h2 className="mt-2 text-xl font-bold">Manage mentor allowances</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Approve mentors and set the maximum number of keys each account can generate.
            </p>
            <Link
              to="/admin"
              className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
            >
              Open admin console <ArrowRight className="size-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
