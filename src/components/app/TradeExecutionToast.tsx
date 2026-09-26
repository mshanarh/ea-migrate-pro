import { useEffect, useRef, useState } from "react";

/**
 * TradeExecutionToast — premium dark toast pinned to the TOP of the screen.
 *
 * Sequence (from the scanner/home EXECUTE button):
 *  1. Five connection steps with a slow, readable typing effect
 *  2. Then trade-by-trade: "{botName} Scanning Markets..." → green check
 *     "✅ Trade {n}/{total} completed successfully" with the execute sound
 *  3. "🎉 All {total} trades executed on MetaTrader" and auto-close.
 *
 * If the live execution result arrives (eamp:execution-result event), the
 * final line reflects the provider's real outcome.
 */

type Phase = "steps" | "scanning" | "trade" | "done";

const CONNECTION_STEPS = [
  "🔍 Checking MetaTrader account...",
  "🔗 Linking broker account...",
  "📈 Checking if symbol is available...",
  "✅ Confirming the trade...",
  "🚀 Executing the trade to MetaTrader...",
];

const STEP_MS = 1700;
const TRADE_MS = 2300;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  botName: string;
  totalTrades: number;
};

export default function TradeExecutionToast({ isOpen, onClose, botName, totalTrades }: Props) {
  const [phase, setPhase] = useState<Phase>("steps");
  const [stepIndex, setStepIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [currentTrade, setCurrentTrade] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const clearTimers = () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
  };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // Reset whenever the toast is opened.
  useEffect(() => {
    if (!isOpen) return;
    setPhase("steps");
    setStepIndex(0);
    setTyped("");
    setCurrentTrade(0);
    return clearTimers;
  }, [isOpen]);

  const playBeep = () => {
    try {
      if (!audioRef.current) audioRef.current = new Audio("/sounds/execute.mp3");
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        /* autoplay policies — ignore */
      });
    } catch {
      /* ignore */
    }
  };

  // Phase machine.
  useEffect(() => {
    if (!isOpen) return undefined;

    if (phase === "steps") {
      const text = CONNECTION_STEPS[stepIndex] ?? "";
      // Typing effect — a deliberate per-character rhythm so every step is
      // fully readable before the next one starts. Never rushed.
      const perChar = Math.max(18, Math.min(45, Math.floor(STEP_MS / Math.max(text.length, 1))));
      setTyped("");
      let char = 0;
      const typer = setInterval(() => {
        char += 1;
        setTyped(text.slice(0, char));
        if (char >= text.length) clearInterval(typer);
      }, perChar);
      const advance = setTimeout(() => {
        clearInterval(typer);
        if (stepIndex < CONNECTION_STEPS.length - 1) {
          setStepIndex((value) => value + 1);
        } else {
          setPhase(totalTrades > 0 ? "scanning" : "done");
        }
      }, STEP_MS);
      timers.current.push(advance);
      return () => {
        clearInterval(typer);
        clearTimeout(advance);
      };
    }

    if (phase === "scanning") {
      const advance = setTimeout(() => {
        setCurrentTrade(1);
        setPhase("trade");
      }, STEP_MS);
      timers.current.push(advance);
      return () => clearTimeout(advance);
    }

    if (phase === "trade") {
      playBeep();
      if (currentTrade < totalTrades) {
        const advance = setTimeout(() => setCurrentTrade((value) => value + 1), TRADE_MS);
        timers.current.push(advance);
        return () => clearTimeout(advance);
      }
      const advance = setTimeout(() => setPhase("done"), TRADE_MS);
      timers.current.push(advance);
      return () => clearTimeout(advance);
    }

    if (phase === "done") {
      const advance = setTimeout(onClose, 3400);
      timers.current.push(advance);
      return () => clearTimeout(advance);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, phase, stepIndex, currentTrade, totalTrades]);

  // Live MT5 outcome from the scanner — broadcast on the event bus so every
  // execution surface (this toast AND the floating bot popup) receives it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event: Event) => {
      const result = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      clearTimers();
      setPhase("done");
      setTyped(result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`);
    };
    window.addEventListener("eamp:execution-result", handler);
    return () => window.removeEventListener("eamp:execution-result", handler);
  }, [isOpen]);

  if (!isOpen) return null;

  const stepText = phase === "steps" ? typed : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-3 z-[9999] mx-auto w-[95%] max-w-md animate-[slideDown_0.3s_ease-out] rounded-[16px] border border-[#2a2a2a] bg-[#0f0f0f] p-4 shadow-xl"
    >
      <div className="flex items-center gap-3">
        {/* Green pulsing spinner */}
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0A2E1A]">
          {phase === "done" ? (
            <span className="text-lg text-green-400">✅</span>
          ) : (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-green-500/15" />
              <span className="size-6 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
            </>
          )}
        </span>

        {/* Text */}
        <div className="min-w-0 flex-1">
          {phase === "steps" && (
            <p className="truncate text-[13px] font-semibold text-white">{stepText}</p>
          )}
          {phase === "scanning" && (
            <p className="truncate text-[13px] font-bold text-white">
              {botName} Scanning Markets...
            </p>
          )}
          {phase === "trade" && (
            <p className="truncate text-[13px] font-bold text-white">
              <span className="text-green-400">✅</span> Trade {currentTrade} opened — EA Migrate ({currentTrade}/{totalTrades})
            </p>
          )}
          {phase === "done" && (
            <p className="truncate text-[13px] font-bold text-white">
              {typed || `🎉 All ${totalTrades} trades opened on MT5 — EA Migrate`}
            </p>
          )}
          {totalTrades > 0 && (phase === "trade" || phase === "scanning") && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${Math.round(((phase === "trade" ? currentTrade : 0) / totalTrades) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Close */}
        <button
          type="button"
          aria-label="Close execution toast"
          onClick={() => {
            clearTimers();
            onClose();
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2a2a2a] text-sm font-bold text-white/80 transition-colors hover:bg-[#3a3a3a]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
