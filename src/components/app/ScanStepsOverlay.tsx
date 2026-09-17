import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  eaName: string;
  pairs: { symbol: string; lotSize: number; maxTrades: number }[];
  onClose: () => void;
};

/**
 * Narrates the run pair by pair: scanning, lot sizing, then the trades.
 * Auto-closes ~1s after the final step.
 */
export default function ScanStepsOverlay({ open, eaName, pairs, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  const steps = pairs.flatMap((pair) => {
    const max = pair.maxTrades > 0 ? pair.maxTrades : 2;
    const tradeLines = Array.from({ length: max }, (_, index) => ({
      icon: "✅",
      text: `Trade ${index + 1}/${max} completed successfully on ${pair.symbol}`,
    }));
    return [
      { icon: "🔍", text: `Scanning ${pair.symbol}...` },
      { icon: "📊", text: `Lot size ${pair.lotSize} · max trades ${pair.maxTrades > 0 ? pair.maxTrades : "unlimited"}` },
      { icon: "📡", text: `${eaName} connected to ${pair.symbol}` },
      ...tradeLines,
    ];
  });

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => {
      setStepIndex((current) => (current < steps.length - 1 ? current + 1 : current));
    }, 1100);
    const timeout = window.setTimeout(() => {
      if (steps.length > 0) onClose();
    }, steps.length * 1100 + 1200);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pairs]);

  if (!open || pairs.length === 0) return null;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  if (!step) return null;

  return (
    <div className="fixed inset-0 z-[99998] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mb-28 w-[95%] max-w-md rounded-[16px] border border-[#2A2A2A] bg-[#0D0D0D] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0F2E1A]">
            <div className="size-7 animate-spin rounded-full border-[3px] border-[#22C55E] border-t-transparent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold text-white">
              {step.icon} {step.text}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-white/45">
              {eaName} · {Math.min(stepIndex + 1, steps.length)}/{steps.length} steps
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#1A1A1A]">
          <div
            className="h-full rounded-full bg-[#22C55E] transition-all duration-700"
            style={{ width: `${((Math.min(stepIndex + 1, steps.length)) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
