import { useMemo, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, requireAppAccess, setRobotPairs, useAppState } from "@/lib/app-store";
import { requireVerifiedAccess } from "@/lib/payment-gate";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/app/trading-pairs")({
  ssr: false,
  beforeLoad: async () => {
    // Cloud-verified gates: no email → app login; a local "paid" record the
    // database does not confirm → Whop checkout.
    const access = await requireVerifiedAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "pay") throw redirect({ href: "/app/login?pay=1" });
  },
  head: () => ({
    meta: [
      { title: "Quotes — EA Migrate" },
      { name: "description", content: "Live quotes and per-symbol trade settings for your robot." },
    ],
  }),
  component: TradingPairsScreen,
});

function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

type PairDirection = "BOTH" | "BUY" | "SELL";

const DIRECTION_LABELS: Record<PairDirection, string> = {
  BOTH: "BOTH",
  BUY: "BUY ONLY",
  SELL: "SELL ONLY",
};

/**
 * Quotes for the ACTIVE robot — the symbols the EA's creator attached to this
 * EA, shown exactly as the bot added them. "Selected Quotes" are the switched-on
 * symbols with their trade settings (lot size, type, number of trades); the
 * "Allowed Quotes" tab lists the EA's remaining symbols ready to configure.
 * The scanner only scans Selected Quotes.
 */
function TradingPairsScreen() {
  const navigate = useNavigate();
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [tab, setTab] = useState<"selected" | "allowed">("selected");
  // The symbol being configured + its draft settings (the Configure modal).
  const [configSymbol, setConfigSymbol] = useState<string | null>(null);
  const [draftLot, setDraftLot] = useState("0.01");
  const [draftTrades, setDraftTrades] = useState("1");
  const [draftDirection, setDraftDirection] = useState<PairDirection>("BOTH");
  const [typeOpen, setTypeOpen] = useState(false);

  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  // The EA's own symbol universe — set while the EA was created in the portal,
  // displayed exactly as the bot added it.
  const eaSymbols = useMemo(
    () => (robot ? [...new Set(robot.symbols.map(symbolKey).filter(Boolean))] : []),
    [robot],
  );
  // Selected Quotes = the robot's active selection (settings per symbol).
  const mine = useMemo(() => (robot?.pairs ?? []).map((pair) => ({ ...pair })), [robot]);
  const mineSymbols = useMemo(() => new Set(mine.map((pair) => symbolKey(pair.symbol))), [mine]);
  const allowed = eaSymbols.filter((symbol) => !mineSymbols.has(symbol));

  const openConfig = (symbol: string, existing?: { lotSize: string; maxTrades: string; direction?: PairDirection }) => {
    setConfigSymbol(symbol);
    setDraftLot(existing?.lotSize || app.settings.lotSize || "0.01");
    setDraftTrades(existing?.maxTrades || "1");
    setDraftDirection(existing?.direction ?? "BOTH");
    setTypeOpen(false);
  };

  const saveConfig = () => {
    if (!robot || !configSymbol) return;
    const exists = mineSymbols.has(symbolKey(configSymbol));
    const entry = {
      symbol: configSymbol,
      lotSize: draftLot.trim() || "0.01",
      maxTrades: draftTrades.trim() || "0",
      direction: draftDirection,
    };
    setRobotPairs(
      robot.id,
      exists
        ? mine.map((pair) => (symbolKey(pair.symbol) === symbolKey(configSymbol) ? { ...pair, ...entry } : pair))
        : [...mine, entry],
    );
    toast.success(exists ? `${configSymbol} updated` : `${configSymbol} added to Selected Quotes`);
    // After configuring, jump back to Allowed Quotes — that is the list the
    // user picks the next symbol from.
    setTab("allowed");
    setConfigSymbol(null);
  };

  const removeSymbol = () => {
    if (!robot || !configSymbol) return;
    setRobotPairs(
      robot.id,
      mine.filter((pair) => symbolKey(pair.symbol) !== symbolKey(configSymbol)),
    );
    toast.success(`Removed: ${configSymbol}`);
    setConfigSymbol(null);
  };

  const tabButton = (key: "selected" | "allowed", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className="flex h-12 flex-1 items-center justify-center rounded-full border px-5 text-sm font-bold transition-colors"
      style={
        tab === key
          ? { borderColor: accent, color: accent, backgroundColor: `${accent}14` }
          : { borderColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.5)", backgroundColor: "transparent" }
      }
    >
      {label}
    </button>
  );

  const typeLabel = (direction?: PairDirection) => DIRECTION_LABELS[direction ?? "BOTH"];
  const tradesLabel = (maxTrades: string) => (maxTrades === "0" ? "unlimited" : maxTrades);

  const hasRobot = Boolean(robot);

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
        <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pt-safe pb-safe-nav">
          {/* Header — back, robot avatar, name, accent subtitle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Go back"
              onClick={() => (window.history.length > 1 ? window.history.back() : void navigate({ to: "/app/home" }))}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-white/80"
            >
              <ArrowLeft className="size-5" />
            </button>
            {robot?.image ? (
              <img src={robot.image} alt="" className="size-11 shrink-0 rounded-full border border-white/10 object-cover" />
            ) : (
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-base font-black text-black"
                style={{ backgroundColor: accent }}
              >
                {(robot?.name ?? "E")[0]?.toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black leading-tight">{robot?.name ?? "Quotes"}</h1>
              <p className="text-sm font-bold" style={{ color: accent }}>
                {eaSymbols.length} symbols on this EA
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex gap-3">
            {tabButton("selected", "Selected Quotes")}
            {tabButton("allowed", "Allowed Quotes")}
          </div>

          {/* Content */}
          {!hasRobot ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-[#1E1E1E] text-2xl">🤖</span>
              <p className="text-sm font-bold">No robot activated</p>
              <p className="max-w-[250px] text-xs text-white/45">
                Activate one of your EA keys on the Home screen — its quotes will show up here.
              </p>
            </div>
          ) : tab === "selected" ? (
            <div className="mt-5 flex flex-col gap-4">
              {mine.length === 0 ? (
                <p className="mt-14 px-6 text-center text-base text-white/45">
                  No saved symbols yet. Save a symbol from Allowed Quotes.
                </p>
              ) : (
                mine.map((pair) => (
                  <button
                    key={pair.symbol}
                    type="button"
                    onClick={() => openConfig(pair.symbol, pair)}
                    className="flex w-full items-center gap-4 rounded-[32px] border p-4 text-left transition-colors hover:bg-white/[0.05]"
                    style={{ borderColor: `${accent}59`, backgroundColor: "rgba(255,255,255,0.03)" }}
                  >
                    <span
                      className="flex size-12 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: accent }}
                    >
                      <ArrowRight className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xl font-black">{pair.symbol}</span>
                      <span className="mt-0.5 block text-sm text-white/50">
                        {pair.lotSize} lots • {typeLabel(pair.direction)} • {tradesLabel(pair.maxTrades)} trades
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              {eaSymbols.length === 0 ? (
                <p className="mt-14 px-6 text-center text-base text-white/45">
                  No symbols on this EA yet — your mentor adds them on the portal.
                </p>
              ) : allowed.length === 0 ? (
                <p className="mt-14 px-6 text-center text-base text-white/45">
                  Every symbol on this EA is already selected.
                </p>
              ) : (
                allowed.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => openConfig(symbol)}
                    className="flex w-full items-center gap-4 rounded-[32px] border p-4 text-left transition-colors hover:bg-white/[0.05]"
                    style={{ borderColor: `${accent}59`, backgroundColor: "rgba(255,255,255,0.03)" }}
                  >
                    <span
                      className="flex size-12 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: accent }}
                    >
                      <Plus className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xl font-black">{symbol}</span>
                      <span className="mt-0.5 block text-sm text-white/50">Tap to configure</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </main>
      </div>
      <DraggableBotPopup />
      <FixedBottomNav />

      {/* Per-symbol Configure modal */}
      <Dialog
        open={configSymbol !== null}
        onOpenChange={(next) => {
          if (!next) setConfigSymbol(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[28px] border border-white/10 bg-[#0b0b0d] p-6 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate text-2xl font-black">{configSymbol}</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-5">
            <div>
              <p className="text-sm font-bold text-white/80">Lot Size (Volume)</p>
              <input
                value={draftLot}
                onChange={(event) => setDraftLot(event.target.value)}
                inputMode="decimal"
                className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base text-white outline-none placeholder:text-white/35 focus:border-white/25"
                placeholder="0.01"
              />
            </div>

            <div>
              <p className="text-sm font-bold text-white/80">Type</p>
              <button
                type="button"
                onClick={() => setTypeOpen((open) => !open)}
                className="mt-2 flex h-14 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-5"
              >
                <span className="text-base font-black" style={{ color: accent }}>
                  {DIRECTION_LABELS[draftDirection]}
                </span>
                <ChevronDown className={`size-5 text-white/50 transition-transform ${typeOpen ? "rotate-180" : ""}`} />
              </button>
              {typeOpen && (
                <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
                  {(Object.keys(DIRECTION_LABELS) as PairDirection[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setDraftDirection(value);
                        setTypeOpen(false);
                      }}
                      className="flex w-full items-center justify-between border-b border-white/[0.06] px-5 py-4 last:border-b-0 transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="text-base font-black">{DIRECTION_LABELS[value]}</span>
                      <span
                        className="flex size-5 items-center justify-center rounded-full border-2"
                        style={draftDirection === value ? { borderColor: accent } : { borderColor: "rgba(255,255,255,0.35)" }}
                      >
                        {draftDirection === value && <span className="size-2.5 rounded-full" style={{ backgroundColor: accent }} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-sm font-bold text-white/80">Number Of Trades</p>
              <input
                value={draftTrades}
                onChange={(event) => setDraftTrades(event.target.value)}
                inputMode="numeric"
                className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base text-white outline-none placeholder:text-white/35 focus:border-white/25"
                placeholder="1"
              />
              <p className="mt-1.5 text-xs text-white/35">0 = unlimited</p>
            </div>

            <button
              type="button"
              onClick={saveConfig}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-black text-black transition-opacity hover:opacity-90"
              style={{ backgroundColor: accent }}
            >
              <Check className="size-5" />
              Configure
            </button>

            {configSymbol && mineSymbols.has(symbolKey(configSymbol)) && (
              <button
                type="button"
                onClick={removeSymbol}
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-red-400/30 text-sm font-bold text-red-300 transition-colors hover:bg-red-400/10"
              >
                Remove from Selected Quotes
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
