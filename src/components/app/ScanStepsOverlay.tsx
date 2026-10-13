import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type ScanStepPair = {
  symbol: string;
  lotSize: number;
  maxTrades: number;
};

type Props = {
  open: boolean;
  eaName: string;
  pairs: ScanStepPair[];
  onClose: () => void;
};

/**
 * Execution steps overlay, shown at the TOP of the screen. Used after the AI
 * Scanner finishes scanning: it narrates each pair from My Pairs, honouring
 * the Max Trades value the user set for that pair (0 = 2 trades preview).
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
    <div className="fixed inset-x-0 top-0 z-[99998] flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-[#2A2A2A] bg-[#0D0D0D] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.75)]"
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
            aria-label="Close execution steps"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#1A1A1A]">
          <div
            className="h-full rounded-full bg-[#22C55E] transition-all duration-700"
            style={{ width: `${(Math.min(stepIndex + 1, steps.length) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
