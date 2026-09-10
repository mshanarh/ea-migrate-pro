import { createFileRoute } from "@tanstack/react-router";
import { useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/")({
  ssr: false,
  component: Overview,
});

function Overview() {
  const account = useCurrentAccount();
  if (!account) return null;

  const active = account.licenses.filter((l) => l.active).length;
  const stats = [
    { label: "Active keys", value: active, note: "Licence keys currently active." },
    { label: "Total keys", value: account.licenses.length, note: "Licence keys on your account." },
    {
      label: "Available",
      value: Math.max(0, account.licenseLimit - account.licenses.length),
      note: account.licenseLimit > 0 ? "Remaining from the allowance set by your admin." : "Your admin has not set a key allowance yet.",
    },
    { label: "Active EAs", value: account.eas.length, note: "Expert Advisors on your mentor account." },
  ];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <h1 className="text-3xl font-bold uppercase">Overview</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Welcome back, <span className="text-primary">{account.displayName}</span> · {today}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {stats.map((s) => (
          <div key={s.label} className="panel p-6 glow-ring">
            <p className="text-sm font-semibold text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-5xl font-bold text-primary">{s.value}</p>
            <p className="mt-3 text-sm text-muted-foreground">{s.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
