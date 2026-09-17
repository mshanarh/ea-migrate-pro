import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Loader2, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ExecutionToast from "@/components/app/ExecutionToast";
import ScanStepsOverlay from "@/components/app/ScanStepsOverlay";
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
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const { userPairs } = useTradingPairsStore();
  // The scanner only scans the user's own pairs (My Pairs), never the full table.
  const pairs = userPairs.filter((pair) => pair.userId === (app.email ?? "guest-device"));
  const scansLeft = DAILY_LIMIT - getScanCount(app.email ?? "guest-device");

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(String(reader.result));
      setScanning(true);
      window.setTimeout(() => {
        setScanning(false);
        toast.success("Scan complete — check your EA's signal setup.");
      }, 1400);
    };
    reader.readAsDataURL(file);
  };

  const handleScan = () => {
    if (pairs.length === 0) {
      toast.error("Add trading pairs first — the scanner only scans My Pairs.");
      window.location.assign("/app/trading-pairs");
      return;
    }
    const scan = registerScan(app.email ?? "guest-device");
    if (!scan.allowed) {
      setLimitOpen(true);
      return;
    }
    window.showBotStarted?.(app.robots[0]?.name ?? "EA");
    setStepsOpen(true);
  };

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pt-10 pb-36">
        <div>
          <h1 className="text-3xl font-black tracking-tight">AI Scanner</h1>
          <p className="mt-2 text-sm text-white/55">
            Upload a chart, pick one of your configured pairs and get an instant signal setup.
          </p>
        </div>

        <motion.label
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-[32px] border-2 border-dashed border-[#FFA500]/40 bg-white/[0.03] p-8 text-center transition-colors hover:border-[#FFA500]/70"
        >
          {preview ? (
            <img src={preview} alt="Chart preview" className="max-h-48 rounded-2xl object-contain" />
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#FFA500]/15">
                <Upload className="size-6 text-[#FFA500]" />
              </span>
              <span className="text-sm font-semibold text-white/70">Tap to upload a chart screenshot</span>
            </>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={(event) => readFile(event.target.files?.[0])} />
        </motion.label>

        <div>
          <p className="text-xs font-bold tracking-[0.22em] text-white/45 uppercase">My Pairs</p>
          {pairs.length === 0 ? (
            <p className="mt-3 text-sm text-white/45">No pairs yet — add them in Trading Pairs first.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {pairs.map((pair) => (
                <span key={pair.id} className="rounded-full border border-[#FFA500]/40 bg-[#FFA500]/10 px-4 py-1.5 text-xs font-bold text-[#FFA500]">
                  {pair.symbol} · lot {pair.lotSize}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-white/35">Scans today: {DAILY_LIMIT - scansLeft}/{DAILY_LIMIT} · resets 00:00 SAST</p>
        </div>

        <button
          type="button"
          disabled={!preview || scanning}
          onClick={handleScan}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-[28px] bg-gradient-to-b from-[#FFA500] to-[#CC7A00] text-base font-black text-black shadow-[0_12px_40px_rgba(255,165,0,0.35)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? <Loader2 className="size-5 animate-spin" /> : <ScanLine className="size-5" />}
          {scanning ? "SCANNING…" : "SCAN CHART"}
        </button>
      </main>
      </div>
      <FixedBottomNav />
      <ExecutionToast />
      <ScanStepsOverlay
        open={stepsOpen}
        eaName={app.robots[0]?.name ?? "EA"}
        pairs={pairs.map((pair) => ({ symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades }))}
        onClose={() => setStepsOpen(false)}
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
