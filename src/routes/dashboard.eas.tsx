import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Code2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/dashboard/eas")({
  ssr: false,
  component: ManageEAs,
});

type EA = { id: string; name: string; symbol: string };

function ManageEAs() {
  const [eas, setEas] = useState<EA[]>([]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Expert Advisors</h1>
      <p className="mt-2 text-sm text-muted-foreground">Build, deploy and manage your trading bots.</p>

      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setEas((v) => [...v, { id: `${Date.now()}`, name: name.trim(), symbol: symbol.trim() || "XAUUSD" }]);
          setName("");
          setSymbol("");
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="EA name" className="h-12 rounded-full px-5" />
        <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (e.g. XAUUSD)" className="h-12 rounded-full px-5" />
        <Button type="submit" size="lg" className="h-12 rounded-full">
          <Plus className="size-4" /> New EA
        </Button>
      </form>

      <h2 className="mt-8 text-lg font-semibold">
        Your EAs <span className="text-muted-foreground">({eas.length})</span>
      </h2>

      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <Code2 className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No EAs yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first Expert Advisor to start deploying it to your trading terminals.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {eas.map((ea) => (
            <li key={ea.id} className="panel flex items-center justify-between p-5">
              <div>
                <p className="font-semibold">{ea.name}</p>
                <p className="text-sm text-muted-foreground">{ea.symbol}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${ea.name}`}
                onClick={() => setEas((v) => v.filter((x) => x.id !== ea.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
