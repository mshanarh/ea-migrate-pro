import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { addUserPair, removeUserPair, updateUserPair, useTradingPairsStore } from "@/lib/trading-pairs-store";
import { useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/trading-pairs")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trading Pairs — EA Migrate Pro" },
      { name: "description", content: "Choose pairs, lot size and max trades for your robot." },
    ],
  }),
  component: TradingPairsScreen,
});

const RED = "#FF3B30";

function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

function TradingPairsScreen() {
  const navigate = useNavigate();
  const app = useAppState();
  const { tradingPairs, userPairs } = useTradingPairsStore();
  const [tab, setTab] = useState<"mine" | "available">("mine");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const userId = app.email ?? "guest-device";
  const mine = useMemo(
    () => userPairs.filter((pair) => pair.userId === userId),
    [userPairs, userId],
  );
  const mineSymbols = useMemo(() => new Set(mine.map((pair) => symbolKey(pair.symbol))), [mine]);

  const matchesQuery = (symbol: string) => symbol.toLowerCase().includes(query.trim().toLowerCase());
  const availableAll = tradingPairs.filter((pair) => pair.active);
  const available = availableAll.filter((pair) => !mineSymbols.has(symbolKey(pair.symbol)) && matchesQuery(pair.symbol));
  const mineFiltered = mine.filter((pair) => matchesQuery(pair.symbol));

  const handleAdd = (pair: { symbol: string; minLot: number }) => {
    const result = addUserPair(userId, pair.symbol, pair.minLot, 0);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Added: ${pair.symbol}`);
    setTab("mine");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  };

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
        <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pt-6 pb-36">
          {/* Header */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Go back"
              onClick={() => (window.history.length > 1 ? window.history.back() : void navigate({ to: "/app/home" }))}
              className="flex size-10 items-center justify-center rounded-full bg-[#1A1A1A] text-white/80"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h1 className="text-lg font-bold">Trading Pairs</h1>
            <button
              type="button"
              aria-label="Refresh"
              onClick={handleRefresh}
              className="flex size-10 items-center justify-center rounded-full bg-[#1A1A1A] text-white/80"
            >
              <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setTab("mine")}
              className="flex h-11 items-center rounded-full px-5 text-sm font-bold transition-colors"
              style={tab === "mine" ? { backgroundColor: RED, color: "#000" } : { backgroundColor: "#1A1A1A", color: "rgba(255,255,255,0.5)" }}
            >
              My Pairs {mine.length}
            </button>
            <button
              type="button"
              onClick={() => setTab("available")}
              className="flex h-11 items-center rounded-full px-5 text-sm font-bold transition-colors"
              style={tab === "available" ? { backgroundColor: RED, color: "#000" } : { backgroundColor: "#1A1A1A", color: "rgba(255,255,255,0.5)" }}
            >
              Available {availableAll.length}
            </button>
          </div>

          {/* Search */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#1A1A1A] px-4 py-3.5">
            <Search className="size-5 shrink-0 text-white/40" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search symbols"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>

          {/* Content */}
          {tab === "mine" ? (
            <div className="mt-4 flex flex-col gap-3">
              {mineFiltered.length === 0 ? (
                <div className="mt-16 flex flex-col items-center gap-3 text-center">
                  <span className="flex size-16 items-center justify-center rounded-full bg-[#1E1E1E] text-2xl">📊</span>
                  <p className="text-sm font-bold">No pairs yet</p>
                  <p className="max-w-[240px] text-xs text-white/45">
                    Add pairs from the Available tab — the scanner only scans pairs in My Pairs.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab("available")}
                    className="mt-2 rounded-full px-6 py-2.5 text-sm font-black text-black"
                    style={{ backgroundColor: RED }}
                  >
                    Browse Available
                  </button>
                </div>
              ) : (
                mineFiltered.map((pair) => {
                  const minLot = tradingPairs.find((item) => item.symbol === symbolKey(pair.symbol))?.minLot ?? 0.01;
                  return (
                    <div key={pair.id} className="rounded-[20px] border border-[#2A2A2A] bg-[#1E1E1E] p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-base font-bold">{pair.symbol}</p>
                        <button
                          type="button"
                          aria-label={`Remove ${pair.symbol}`}
                          onClick={() => {
                            removeUserPair(userId, pair.symbol);
                            toast.success(`Removed: ${pair.symbol}`);
                          }}
                          className="flex size-8 items-center justify-center rounded-full bg-[#111] text-white/60"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="relative mt-4 grid grid-cols-2 gap-6">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-[#2A2A2A]" />
                        <div>
                          <p className="text-center text-xs text-white/45">Lot Size</p>
                          <input
                            value={String(pair.lotSize)}
                            onChange={(event) => updateUserPair(userId, pair.symbol, { lotSize: Number(event.target.value) || 0 })}
                            inputMode="decimal"
                            className="mt-2 h-12 w-full rounded-xl bg-[#111] text-center text-lg font-bold text-white outline-none"
                          />
                          <p className="mt-1.5 text-center text-[11px] text-white/35">min {minLot}</p>
                        </div>
                        <div>
                          <p className="text-center text-xs text-white/45">Max Trades ?</p>
                          <input
                            value={String(pair.maxTrades)}
                            onChange={(event) => updateUserPair(userId, pair.symbol, { maxTrades: Number(event.target.value) || 0 })}
                            inputMode="numeric"
                            className="mt-2 h-12 w-full rounded-xl bg-[#111] text-center text-lg font-bold text-white outline-none"
                          />
                          <p className="mt-1.5 text-center text-[11px] text-white/35">0 = unlimited</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {available.length === 0 ? (
                <p className="col-span-2 mt-12 text-center text-sm text-white/45">
                  No available pairs match "{query}".
                </p>
              ) : (
                available.map((pair) => (
                  <div key={pair.id} className="rounded-[20px] border border-[#2A2A2A] bg-[#1E1E1E] p-4">
                    <p className="text-base font-bold">{pair.symbol}</p>
                    <p className="mt-1 text-xs text-white/45">min {pair.minLot}</p>
                    <button
                      type="button"
                      aria-label={`Add ${pair.symbol}`}
                      onClick={() => handleAdd(pair)}
                      className="mt-4 flex size-9 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: RED }}
                    >
                      <Plus className="size-5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </main>
      </div>
      <FixedBottomNav />
    </div>
  );
}
