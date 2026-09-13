import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Save, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/dashboard/signals")({
  ssr: false,
  component: CopyTrading,
});

function CopyTrading() {
  const [enabled, setEnabled] = useState(false);
  const [strategy, setStrategy] = useState("Balanced");
  const [allocation, setAllocation] = useState("10");
  const [risk, setRisk] = useState("Medium");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("eamp.copy-trading.v1") || "{}") as Partial<{
        enabled: boolean;
        strategy: string;
        allocation: string;
        risk: string;
      }>;
      if (typeof stored.enabled === "boolean") setEnabled(stored.enabled);
      if (stored.strategy) setStrategy(stored.strategy);
      if (stored.allocation) setAllocation(stored.allocation);
      if (stored.risk) setRisk(stored.risk);
    } catch {
      // Ignore invalid local settings and keep the safe defaults.
    }
  }, []);

  const save = () => {
    localStorage.setItem("eamp.copy-trading.v1", JSON.stringify({ enabled, strategy, allocation, risk }));
    setSaved(true);
  };

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Broadcast</p>
      <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold"><Copy className="size-7 text-primary" /> Copy Trading</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Control whether connected clients can mirror your strategy and set the default risk profile.
      </p>

      <div className="panel mt-6 space-y-6 p-6">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <div>
            <p className="font-semibold">Copy trading status</p>
            <p className="mt-1 text-sm text-muted-foreground">{enabled ? "Clients can mirror eligible trades." : "Copy trading is currently paused."}</p>
          </div>
          <button type="button" onClick={() => { setEnabled((current) => !current); setSaved(false); }} className={`relative h-8 w-14 rounded-full transition ${enabled ? "bg-primary" : "bg-secondary"}`} aria-pressed={enabled} aria-label="Toggle copy trading">
            <span className={`absolute top-1 size-6 rounded-full bg-white transition ${enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
        <label className="block"><span className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Strategy</span><select value={strategy} onChange={(event) => { setStrategy(event.target.value); setSaved(false); }} className="mt-2 h-12 w-full rounded-2xl border border-border/70 bg-background/60 px-4 text-sm outline-none focus:border-primary"><option>Balanced</option><option>Conservative</option><option>Aggressive</option></select></label>
        <label className="block"><span className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Default allocation (%)</span><input type="number" min="1" max="100" value={allocation} onChange={(event) => { setAllocation(event.target.value); setSaved(false); }} className="mt-2 h-12 w-full rounded-2xl border border-border/70 bg-background/60 px-4 text-sm outline-none focus:border-primary" /></label>
        <label className="block"><span className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Risk profile</span><select value={risk} onChange={(event) => { setRisk(event.target.value); setSaved(false); }} className="mt-2 h-12 w-full rounded-2xl border border-border/70 bg-background/60 px-4 text-sm outline-none focus:border-primary"><option>Low</option><option>Medium</option><option>High</option></select></label>
        <button type="button" onClick={save} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-primary-foreground glow-ring"><Save className="size-4" /> Save copy-trading settings</button>
        {saved && <p className="flex items-center justify-center gap-2 text-center text-sm text-emerald-300"><ShieldCheck className="size-4" /> Copy-trading settings saved on this device.</p>}
      </div>
    </div>
  );
}
