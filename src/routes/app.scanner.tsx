import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ChartScanner from "@/components/app/ChartScanner";
import ExecutionToast from "@/components/app/ExecutionToast";
import ScanStepsOverlay, { type ScanStepPair } from "@/components/app/ScanStepsOverlay";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { useAppState } from "@/lib/app-store";
import { DAILY_LIMIT, getScanCount, registerScan, useTradingPairsStore } from "@/lib/trading-pairs-store";

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
  const { userPairs } = useTradingPairsStore();
  // The scanner only scans the user's own pairs (My Pairs), never the full table.
  const pairs = userPairs.filter((pair) => pair.userId === (app.email ?? "guest-device"));
  const scansLeft = DAILY_LIMIT - getScanCount(app.email ?? "guest-device");

  // Register one of the 5 daily SAST scans. Returns false (and shows the limit
  // modal) when the user has used all of today's scans.
  const handleScanStart = () => {
    const scan = registerScan(app.email ?? "guest-device");
    if (!scan.allowed) {
      setLimitOpen(true);
      return false;
    }
    return true;
  };

  // Fire the execution steps overlay at the top of the screen with exactly
  // the chosen trades count, then narrate through the scan-step pairs.
  const handleExecute = ({ symbol, lot, trades }: { symbol: string; lot: string; trades: number }) => {
    window.showBotStarted?.(app.robots[0]?.name ?? "EA");
    setDetails({ symbol, lot, trades });
  };

  const stepPairs: ScanStepPair[] = details
    ? pairs
        .filter((pair) => pair.symbol === details.symbol)
        .map((pair) => ({
          symbol: pair.symbol,
          lotSize: Number(details.lot) || pair.lotSize,
          maxTrades: details.trades,
        }))
    : [];

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
        <ChartScanner
          pairs={pairs.map((pair) => ({ id: pair.id, symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades }))}
          accent={accent}
          eaName={app.robots[0]?.name ?? "EA"}
          scansLeft={scansLeft}
          onScanStart={handleScanStart}
          onExecute={handleExecute}
          onGoToPairs={() => window.location.assign("/app/trading-pairs")}
        />
      </div>
      <FixedBottomNav />
      <ExecutionToast />
      <ScanStepsOverlay
        open={stepPairs.length > 0}
        eaName={app.robots[0]?.name ?? "EA"}
        pairs={stepPairs}
        onClose={() => setDetails(null)}
      />
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
