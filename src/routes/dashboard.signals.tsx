import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Radio, Send, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/AuthShell";

export const Route = createFileRoute("/dashboard/signals")({
  ssr: false,
  component: Signals,
});

function Signals() {
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [sent, setSent] = useState("");

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Broadcast</p>
      <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold">
        <Radio className="size-7 text-primary" /> Signals
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Send manual trade signals to all connected clients.
      </p>

      <form
        className="panel mt-6 space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setSent("Signal queued — connecting live clients comes with the app build.");
        }}
      >
        <p className="flex items-center gap-2 font-semibold">
          <Send className="size-4 text-primary" /> Send signal to clients
        </p>

        <Field label="Send to EA">
          <Input placeholder="Choose an Expert Advisor" className="h-12 rounded-full px-5" />
        </Field>
        <Field label="Symbol">
          <Input placeholder="e.g. XAUUSD" className="h-12 rounded-full px-5" />
        </Field>

        <div className="space-y-2">
          <span className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Direction</span>
          <div className="grid grid-cols-2 gap-3">
            {(["buy", "sell"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`flex h-12 items-center justify-center gap-2 rounded-full border text-sm font-bold uppercase ${
                  direction === d
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {d === "buy" ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Take profit">
            <Input placeholder="e.g. 105000" className="h-12 rounded-full px-5" />
          </Field>
          <Field label="Stop loss">
            <Input placeholder="e.g. 98000" className="h-12 rounded-full px-5" />
          </Field>
        </div>

        <Button type="submit" size="lg" className="h-12 w-full rounded-full">
          <Send className="size-4" /> Send signal
        </Button>
        {sent && <p className="text-center text-sm text-primary">{sent}</p>}
      </form>
    </div>
  );
}
