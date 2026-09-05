import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/builder")({
  head: () => ({
    meta: [
      { title: "EA Builder — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Compose entry, exit and risk rules and generate a custom MT4/MT5 Expert Advisor.",
      },
      { property: "og:title", content: "EA Builder — EA Migrate Pro" },
      {
        property: "og:description",
        content: "Compose your strategy rules and generate a custom Expert Advisor.",
      },
    ],
  }),
  component: Builder,
});

type Rule = { id: number; indicator: string; condition: string; value: string };

const indicators = ["Moving Average", "RSI", "MACD", "Bollinger Bands", "ATR", "Stochastic"];
const conditions = ["crosses above", "crosses below", "is greater than", "is less than"];

let nextId = 3;

function Builder() {
  const [name, setName] = useState("My First EA");
  const [pair, setPair] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState("M15");
  const [lot, setLot] = useState("0.10");
  const [sl, setSl] = useState("40");
  const [tp, setTp] = useState("80");
  const [rules, setRules] = useState<Rule[]>([
    { id: 1, indicator: "Moving Average", condition: "crosses above", value: "50" },
    { id: 2, indicator: "RSI", condition: "is less than", value: "70" },
  ]);

  const addRule = () =>
    setRules((r) => [
      ...r,
      { id: nextId++, indicator: "RSI", condition: "is greater than", value: "30" },
    ]);
  const removeRule = (id: number) => setRules((r) => r.filter((x) => x.id !== id));
  const patch = (id: number, key: keyof Rule, v: string) =>
    setRules((r) => r.map((x) => (x.id === id ? { ...x, [key]: v } : x)));

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-bold sm:text-4xl">
          EA <span className="text-primary">Builder</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Set your market, define entry rules and risk limits, then preview the Expert
          Advisor you are about to generate.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Basics</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ea-name">EA name</Label>
                  <Input
                    id="ea-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pair">Symbol</Label>
                  <Input id="pair" value={pair} onChange={(e) => setPair(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Timeframe</Label>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["M1", "M5", "M15", "H1", "H4", "D1"].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot">Lot size</Label>
                  <Input id="lot" value={lot} onChange={(e) => setLot(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="panel p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Entry rules</h2>
                <Button size="sm" variant="outline" className="rounded-full" onClick={addRule}>
                  <Plus className="size-4" /> Add rule
                </Button>
              </div>

              <div className="mt-5 space-y-3">
                {rules.map((r) => (
                  <div
                    key={r.id}
                    className="grid items-end gap-3 rounded-xl border border-border/70 bg-background/40 p-4 sm:grid-cols-[1fr_1fr_90px_auto]"
                  >
                    <Select
                      value={r.indicator}
                      onValueChange={(v) => patch(r.id, "indicator", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {indicators.map((i) => (
                          <SelectItem key={i} value={i}>
                            {i}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={r.condition}
                      onValueChange={(v) => patch(r.id, "condition", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {conditions.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={r.value}
                      onChange={(e) => patch(r.id, "value", e.target.value)}
                      aria-label="Value"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove rule"
                      onClick={() => removeRule(r.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {rules.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No rules yet — add one to define when the EA opens a trade.
                  </p>
                )}
              </div>
            </section>

            <section className="panel p-6">
              <h2 className="text-lg font-semibold">Risk management</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sl">Stop loss (pips)</Label>
                  <Input id="sl" value={sl} onChange={(e) => setSl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tp">Take profit (pips)</Label>
                  <Input id="tp" value={tp} onChange={(e) => setTp(e.target.value)} />
                </div>
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="panel p-6 glow-ring">
              <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                Strategy summary
              </p>
              <h2 className="mt-3 text-xl font-bold">{name || "Untitled EA"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pair} · {timeframe} · {lot} lots
              </p>

              <ul className="mt-5 space-y-2 text-sm">
                {rules.map((r, i) => (
                  <li key={r.id} className="text-muted-foreground">
                    <span className="text-primary">{i === 0 ? "IF" : "AND"}</span>{" "}
                    {r.indicator} {r.condition} {r.value}
                  </li>
                ))}
                <li className="text-muted-foreground">
                  <span className="text-primary">THEN</span> open trade · SL {sl} · TP {tp}
                </li>
              </ul>

              <Button className="mt-6 w-full rounded-full">
                <Sparkles className="size-4" /> Generate EA
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Generation and backtesting go live once your account is connected.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
