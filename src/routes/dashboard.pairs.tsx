import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/PortalLayout";
import { addTradingPair, removeTradingPair, useTradingPairsStore } from "@/lib/trading-pairs-store";

export const Route = createFileRoute("/dashboard/pairs")({
  ssr: false,
  component: ManagePairs,
});

function ManagePairs() {
  const { tradingPairs, userPairs } = useTradingPairsStore();
  const [symbol, setSymbol] = useState("");
  const [minLot, setMinLot] = useState("0.01");

  const handleAdd = () => {
    const result = addTradingPair(symbol, Number(minLot));
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Added ${result.pair?.symbol} — live in the app's Available tab`);
    setSymbol("");
    setMinLot("0.01");
  };

  const handleDelete = (pair: { id: string; symbol: string }) => {
    if (!window.confirm(`Delete ${pair.symbol}? It will disappear from every user's app instantly.`)) return;
    removeTradingPair(pair.id);
    toast.success(`${pair.symbol} removed`);
  };

  return (
    <PortalLayout>
      <div>
        <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Quotes</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Manage Pairs / Quotes</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This is the source of truth for the app's Trading Pairs screen. Whatever you add or delete here
          instantly updates the Available tab for every user.
        </p>

        {/* Add pair form */}
        <div className="panel mt-8 p-6">
          <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">Add a pair</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              onKeyDown={(event) => event.key === "Enter" && handleAdd()}
              placeholder="SYMBOL (e.g. BTCUSD)"
              aria-label="Symbol"
              className="h-14 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-5 font-mono text-sm tracking-[0.14em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-white/30 focus:border-primary/70"
            />
            <input
              value={minLot}
              onChange={(event) => setMinLot(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleAdd()}
              inputMode="decimal"
              placeholder="Min lot"
              aria-label="Minimum lot"
              className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm text-white outline-none placeholder:text-white/30 focus:border-primary/70 sm:w-40"
            />
            <button
              type="button"
              onClick={handleAdd}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#FF3B30] px-8 text-sm font-black text-white shadow-[0_10px_30px_rgba(255,59,48,0.35)] transition-transform active:scale-[0.98]"
            >
              <Plus className="size-5" /> Add Pair
            </button>
          </div>
        </div>

        {/* Pairs grid */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-xl font-bold">All pairs</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-bold text-white/60">
            {tradingPairs.length} total · {userPairs.length} user selections
          </span>
        </div>

        {tradingPairs.length === 0 ? (
          <p className="panel mt-4 p-8 text-center text-sm text-muted-foreground">No pairs yet — add your first above.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {tradingPairs.map((pair) => {
              const selections = userPairs.filter((item) => item.symbol === pair.symbol).length;
              return (
                <div key={pair.id} className="panel flex flex-col gap-2 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-base font-black tracking-wide">{pair.symbol}</p>
                    <button
                      type="button"
                      aria-label={`Delete ${pair.symbol}`}
                      onClick={() => handleDelete(pair)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#FF3B30]/15 text-[#FF3B30] transition-colors hover:bg-[#FF3B30]/30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">min lot {pair.minLot}</p>
                  <p className="text-xs text-white/40">{selections} user{selections === 1 ? "" : "s"} added</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
