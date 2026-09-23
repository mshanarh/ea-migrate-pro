import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ChartScanner from "@/components/app/ChartScanner";
import type { ExecutionOutcome, ExecutionPlan } from "@/components/app/ChartScanner";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import TradeExecutionToast from "@/components/app/TradeExecutionToast";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { useAppState } from "@/lib/app-store";
import { executeLiveTradeOnDemand } from "@/lib/metaapi";
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
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const unlimited = isUnlimitedScanner(app.email);
  const scansLeft = unlimited ? Infinity : DAILY_LIMIT - getScanCount(app.email ?? "guest-device");

  // The active robot — its symbols come from the mentor portal (EA creation).
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

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

  /**
   * Execute pressed (after the user CONFIRMED in the popup) — the server
   * opens the broker connection ONLY for this order: deploy → verify the
   * live session → send the order(s) with the analyzed SL/TP → ALWAYS
   * undeploy. Statuses stream to the UI as Offline → Connecting → Connected
   * → Executing → Trade Executed / error → Disconnected.
   */
  const handleExecute = async (
    plan: ExecutionPlan,
    onProgress: (message: string) => void,
  ): Promise<ExecutionOutcome> => {
    const { symbol, lot, trades, direction, stopLoss, takeProfit } = plan;

    if (!app.mt?.mcAccountId) {
      toast.error("Save your MT5 details first — MetaTrader page.");
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message: "No saved MT5 details — save them on the MetaTrader page" },
        }),
      );
      return { ok: false, message: "No saved MT5 details — save them on the MetaTrader page first." };
    }

    // Top execution toast + floating bot popup get the REAL analyzed values.
    window.triggerExecutionToast?.(robot?.name, robot?.image, {
      symbol,
      lot_size: lot,
      max_trades: Math.max(1, Math.min(trades, 20)),
      direction,
      ...(stopLoss ? { stopLoss } : {}),
      ...(takeProfit ? { takeProfit } : {}),
    });
    setToastTrades(Math.max(1, Math.min(trades, 20)));
    setToastOpen(true);
    onProgress("Connecting to broker...");
    window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message: "CONNECTING TO BROKER..." } }));

    try {
      const outcome = await executeLiveTradeOnDemand({
        data: {
          accountId: app.mt.mcAccountId,
          eaName: robot?.name ?? "EA",
          symbol,
          direction,
          lotSize: lot,
          ...(stopLoss ? { stopLoss } : {}),
          ...(takeProfit ? { takeProfit } : {}),
          ...(app.mt.environment ? { region: app.mt.environment } : {}),
          tradeCount: Math.max(1, Math.min(trades, 20)),
        },
      });
      onProgress("Disconnecting...");
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: {
            ok: outcome.ok,
            message: outcome.ok
              ? outcome.message.toUpperCase()
              : `${outcome.message.toUpperCase()} — CONNECTION CLOSED`,
          },
        }),
      );
      return outcome;
    } catch {
      const message = "Could not reach the execution service.";
      window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message } }));
      return { ok: false, message };
    }
  };

  return (
    <div className="app-fullscreen bg-[#07090b] text-white">
      <div className="app-scroll-area">
        <ChartScanner
          symbols={robot?.symbols ?? []}
          pairs={(robot?.pairs ?? []).map((pair) => ({ symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades }))}
          {...(app.mt?.mcAccountId ? { accountId: app.mt.mcAccountId } : {})}
          {...(app.mt?.environment ? { region: app.mt.environment } : {})}
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
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-amber-400/40 text-amber-300" aria-hidden="true">
            <span className="text-xl font-black">!</span>
          </div>
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
