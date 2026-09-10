import { createFileRoute } from "@tanstack/react-router";
import { useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/stats")({
  ssr: false,
  component: KeyStats,
});

function KeyStats() {
  const account = useCurrentAccount();
  if (!account) return null;

  const active = account.licenses.filter((l) => l.active).length;
  const rows = [
    { label: "Licences issued", value: account.licenses.length },
    { label: "Active licences", value: active },
    { label: "Paused licences", value: account.licenses.length - active },
    { label: "Portal status", value: account.status },
  ];

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Insights</p>
      <h1 className="mt-1 text-3xl font-bold">Key Stats</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A quick read on how your licence keys are being used.
      </p>

      <div className="panel mt-6 divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between p-5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className="text-lg font-bold text-primary capitalize">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
