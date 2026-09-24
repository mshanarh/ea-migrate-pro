import { useMemo, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { WHOP_CHECKOUT_URL, getAppState, requireAppAccess, setRobotPairs, useAppState } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

export const Route = createFileRoute("/app/trading-pairs")({
  ssr: false,
  beforeLoad: () => {
    // Same gates the /app login view enforces: no email → app login,
    // unpaid → Whop checkout. Paid/admin emails pass through.
    const access = requireAppAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "pay") throw redirect({ href: WHOP_CHECKOUT_URL });
  },
  head: () => ({
    meta: [
      { title: "Trading Pairs — EA Migrate Pro" },
      { name: "description", content: "Choose pairs, lot size and max trades for your robot." },
    ],
  }),
  component: TradingPairsScreen,
});

function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

/**
 * Quotes / Trading Pairs for the ACTIVE robot. "My Pairs" are the symbols the
 * EA's creator attached to this EA — nothing else. The Available tab lists the
 * EA's remaining symbols that are not switched on yet, so the user can only
 * ever trade what that specific EA was built for.
 */
function TradingPairsScreen() {
  const navigate = useNavigate();
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [tab, setTab] = useState<"mine" | "available">("mine");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  // The EA's own symbol universe — set while the EA was created in the portal.
  const eaSymbols = useMemo(
    () => (robot ? [...new Set(robot.symbols.map(symbolKey).filter(Boolean))] : []),
    [robot],
  );
  // My Pairs = the robot's active selection (lot size + max trades per symbol).
  const mine = useMemo(() => (robot?.pairs ?? []).map((pair) => ({ ...pair })), [robot]);
  const mineSymbols = useMemo(() => new Set(mine.map((pair) => symbolKey(pair.symbol))), [mine]);

  const matchesQuery = (symbol: string) => symbol.toLowerCase().includes(query.trim().toLowerCase());
  const mineFiltered = mine.filter((pair) => matchesQuery(pair.symbol));
  const available = eaSymbols
    .filter((symbol) => !mineSymbols.has(symbol))
    .filter((symbol) => matchesQuery(symbol));

  const activateSymbol = (symbol: string) => {
    if (!robot) return;
    setRobotPairs(robot.id, [...mine, { symbol, lotSize: app.settings.lotSize || "0.01", maxTrades: "0" }]);
    toast.success(`Added: ${symbol}`);
  };

  const removeSymbol = (symbol: string) => {
    if (!robot) return;
    setRobotPairs(
      robot.id,
      mine.filter((pair) => symbolKey(pair.symbol) !== symbolKey(symbol)),
    );
    toast.success(`Removed: ${symbol}`);
  };

  const updatePair = (symbol: string, patch: { lotSize?: string; maxTrades?: string }) => {
    if (!robot) return;
    setRobotPairs(
      robot.id,
      mine.map((pair) => (symbolKey(pair.symbol) === symbolKey(symbol) ? { ...pair, ...patch } : pair)),
    );
  };

  const handleRefresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const hasRobot = Boolean(robot);

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

          {robot && (
            <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>
              {robot.name}
            </p>
          )}

          {/* Tabs */}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setTab("mine")}
              className="flex h-11 items-center rounded-full px-5 text-sm font-bold transition-colors"
              style={tab === "mine" ? { backgroundColor: accent, color: "#000" } : { backgroundColor: "#1A1A1A", color: "rgba(255,255,255,0.5)" }}
            >
              My Pairs {mine.length}
            </button>
            <button
              type="button"
              onClick={() => setTab("available")}
              className="flex h-11 items-center rounded-full px-5 text-sm font-bold transition-colors"
              style={tab === "available" ? { backgroundColor: accent, color: "#000" } : { backgroundColor: "#1A1A1A", color: "rgba(255,255,255,0.5)" }}
            >
              Available {eaSymbols.length}
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
          {!hasRobot ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-[#1E1E1E] text-2xl">🤖</span>
              <p className="text-sm font-bold">No robot activated</p>
              <p className="max-w-[250px] text-xs text-white/45">
                Activate one of your EA keys on the Home screen — its pairs will show up here.
              </p>
            </div>
          ) : tab === "mine" ? (
            <div className="mt-4 flex flex-col gap-3">
              {mineFiltered.length === 0 ? (
                <div className="mt-16 flex flex-col items-center gap-3 text-center">
                  <span className="flex size-16 items-center justify-center rounded-full bg-[#1E1E1E] text-2xl">📊</span>
                  <p className="text-sm font-bold">No pairs yet</p>
                  <p className="max-w-[240px] text-xs text-white/45">
                    Switch on pairs from the Available tab — the scanner only scans pairs in My Pairs.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab("available")}
                    className="mt-2 rounded-full px-6 py-2.5 text-sm font-black text-black"
                    style={{ backgroundColor: accent }}
                  >
                    Browse Available
                  </button>
                </div>
              ) : (
                mineFiltered.map((pair) => (
                  <div key={pair.symbol} className="rounded-[20px] border border-[#2A2A2A] bg-[#1E1E1E] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-bold">{pair.symbol}</p>
                      <button
                        type="button"
                        aria-label={`Remove ${pair.symbol}`}
                        onClick={() => removeSymbol(pair.symbol)}
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
                          value={pair.lotSize}
                          onChange={(event) => updatePair(pair.symbol, { lotSize: event.target.value })}
                          inputMode="decimal"
                          className="mt-2 h-12 w-full rounded-xl bg-[#111] text-center text-lg font-bold text-white outline-none"
                        />
                      </div>
                      <div>
                        <p className="text-center text-xs text-white/45">Max Trades ?</p>
                        <input
                          value={pair.maxTrades}
                          onChange={(event) => updatePair(pair.symbol, { maxTrades: event.target.value })}
                          inputMode="numeric"
                          className="mt-2 h-12 w-full rounded-xl bg-[#111] text-center text-lg font-bold text-white outline-none"
                        />
                        <p className="mt-1.5 text-center text-[11px] text-white/35">0 = unlimited</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {available.length === 0 ? (
                <p className="col-span-2 mt-12 text-center text-sm text-white/45">
                  No available pairs match "{query}".
                </p>
              ) : (
                available.map((symbol) => (
                  <div key={symbol} className="rounded-[20px] border border-[#2A2A2A] bg-[#1E1E1E] p-4">
                    <p className="text-base font-bold">{symbol}</p>
                    <p className="mt-1 text-xs text-white/45">min {app.settings.lotSize || "0.01"}</p>
                    <button
                      type="button"
                      aria-label={`Add ${symbol}`}
                      onClick={() => activateSymbol(symbol)}
                      className="mt-4 flex size-9 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: accent }}
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
