import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bot, Infinity as InfinityIcon, KeyRound, ShieldCheck, UserCheck } from "lucide-react";
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
    { label: "Total Licences", value: account.licenses.length, note: "All time EA users", icon: KeyRound, gradient: "from-[#1d4ed8] to-[#38bdf8]", chip: "bg-white/20" },
    { label: "Active Subscriptions", value: activeSubscriptions, note: "App users subscribed via your Mentor ID", icon: UserCheck, gradient: "from-[#047857] to-[#10b981]", chip: "bg-emerald-300/25" },
    { label: "Total EAs", value: account.eas.length, note: "EAs you are licencing", icon: Bot, gradient: "from-[#b45309] to-[#f59e0b]", chip: "bg-amber-200/25" },
    { label: "Maximum Licences", value: account.licenseLimit, note: "Total licences you can generate", icon: InfinityIcon, gradient: "from-[#b91c1c] to-[#ef4444]", chip: "bg-red-200/25" },
  ];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Mentor portal</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Welcome back, <span className="text-primary">{account.username}</span>!
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Today · {today}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-300">
          <ShieldCheck className="size-4" /> All systems running smoothly
        </span>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, note, icon: Icon, gradient, chip }) => (
          <div
            key={label}
            className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${gradient} p-6 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)]`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-[0.14em] text-white/90">{label}</p>
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${chip} text-white`}>
                <Icon className="size-6" />
              </span>
            </div>
            <p className="mt-4 text-6xl font-black leading-none text-white">{value}</p>
            <p className="mt-4 text-sm font-medium text-white/80">{note}</p>
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
            Your admin set your account to generate up to {account.licenseLimit} licences. Generated keys are enabled by default.
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
