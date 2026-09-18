import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ChartScanner from "@/components/app/ChartScanner";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import TradeExecutionToast from "@/components/app/TradeExecutionToast";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { useAppState } from "@/lib/app-store";
import { executeLiveTrade } from "@/lib/metaapi";
import { DAILY_LIMIT, getScanCount, isUnlimitedScanner, registerScan } from "@/lib/trading-pairs-store";

export const Route = createFileRoute("/app/scanner")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI Scanner — EA Migrate Pro" },
      { name: "description", content: "Scan a chart and get an instant signal setup." },
    ],
  }),
  component: AppScanner,
});

function AppScanner() {
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [limitOpen, setLimitOpen] = useState(false);
  const [details, setDetails] = useState<{ symbol: string; lot: string; trades: number } | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const unlimited = isUnlimitedScanner(app.email);
  const scansLeft = unlimited ? Infinity : DAILY_LIMIT - getScanCount(app.email ?? "guest-device");

  // The active robot — its symbols come from the mentor portal (EA creation).
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];
  // Per-symbol lot/max trades saved on the robot itself (mentor defaults, user-editable).
  const robotPairs = robot?.pairs ?? [];

  // Register one of the 5 daily SAST scans (unlimited for admins). Returns
  // false (and shows the limit modal) when the user has used all of today's scans.
  const handleScanStart = () => {
    const scan = registerScan(app.email ?? "guest-device");
    if (!scan.allowed) {
      setLimitOpen(true);
      return false;
    }
    return true;
  };

  // Execute pressed — show the TOP execution toast, fire the real trade(s) on
  // the connected MT5 account via MetaApi AND stream the logs into the
  // floating bot popup. The toast's final line reflects the provider outcome.
  const handleExecute = ({ symbol, lot, trades }: { symbol: string; lot: string; trades: number }) => {
    window.triggerExecutionToast?.(robot?.name, robot?.image, {
      symbol,
      lot_size: lot,
      max_trades: trades,
    });
    setDetails(null);
    setToastTrades(Math.max(1, Math.min(trades, 20)));
    setToastOpen(true);

    const count = Math.max(1, Math.min(trades, 20));
    if (!app.mt?.mcAccountId) {
      toast.error("Connect your MT5 account first — MetaTrader page.");
      window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message: "No connected MT5 account — link it on the MetaTrader page" } }));
      return;
    }
    Promise.all(
      Array.from({ length: count }, () =>
        executeLiveTrade({
          data: {
            accountId: app.mt?.mcAccountId ?? "",
            eaName: robot?.name ?? "EA",
            symbol,
            direction: "SELL",
            lotSize: lot,
          },
        }),
      ),
    )
      .then((results) => {
        const ok = results.filter((item) => item.ok).length;
        if (ok === count) {
          toast.success(`${ok}/${count} ${symbol} trades executed on MT5`);
          window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: true, message: `${ok}/${count} trades executed on MT5` } }));
        } else {
          const reason = results.find((item) => !item.ok)?.message ?? "Execution failed";
          toast.error(`${ok}/${count} executed — ${reason}`);
          window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message: reason } }));
        }
      })
      .catch(() => {
        toast.error("Could not reach the execution provider.");
        window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message: "Could not reach the execution provider." } }));
      });
  };

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
        <ChartScanner
          symbols={robot?.symbols ?? []}
          pairs={robotPairs.map((pair) => ({ symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades }))}
          accent={accent}
          scansLeft={scansLeft}
          onScanStart={handleScanStart}
          onExecute={handleExecute}
        />
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
      <TradeExecutionToast isOpen={toastOpen} onClose={() => setToastOpen(false)} botName={robot?.name ?? "EA"} totalTrades={toastTrades} />
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="max-w-sm rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 text-center text-white sm:max-w-sm">
          <p className="text-5xl">⛔</p>
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Daily Scan Limit</DialogTitle>
            <DialogDescription className="text-sm text-white/55">
              You have used {DAILY_LIMIT}/{DAILY_LIMIT} scans today. Your limit resets at 00:00 SAST.
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            onClick={() => setLimitOpen(false)}
            className="mt-1 flex h-12 w-full items-center justify-center rounded-2xl bg-white/10 text-sm font-black text-white"
          >
            GOT IT
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
