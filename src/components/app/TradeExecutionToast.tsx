/**
 * THE EXECUTION STEPPER — the dark-glass card that runs before the analysis.
 *
 * Three stages, in this order and never at once:
 *   Connect  → "Loading symbol"            (0.8s)
 *   Terminal → "Linking broker terminal"   (1.2s)
 *   Execute  → "Executing trades to MetaTrader"
 *              → "Confirmed on MetaTrader" (when the bridge answers)
 *
 * The point of the card is ORDER: the run's Signal Analysis card is revealed
 * through `onComplete`, which fires when Execute begins, so the trader sees the
 * pipeline start before a wall of analysis appears on top of it.
 *
 * This component draws and narrates. It places no orders and grants nothing —
 * the execution itself lives in the scanner/auto-trade engines, and the only
 * input it takes from them is the `eamp:execution-result` event.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  botName: string;
  totalTrades: number;
  /** "auto" runs the full broker sequence; "scanner" narrates the scan. */
  mode?: "scanner" | "auto";
  symbol?: string;
  robotImage?: string | null | undefined;
  /** Called once, when the run reaches Execute — the parent opens the analysis. */
  onComplete?: () => void;
};

/** How long each of the first two stages is held before the line moves on. */
const CONNECT_MS = 800;
const TERMINAL_MS = 1_200;
/** How long the confirmed card stays on screen before it closes itself. */
const CONFIRMED_MS = 2_800;

const NODES = ["Connect", "Terminal", "Execute"] as const;

type Stage = 0 | 1 | 2;

export function TradeExecutionToast({
  isOpen,
  onClose,
  botName,
  totalTrades,
  mode = "auto",
  symbol,
  robotImage,
  onComplete,
}: Props) {
  const [stage, setStage] = useState<Stage>(0);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completedRef = useRef(false);
  const completeRef = useRef(onComplete);

  // The latest callback without restarting the run mid-flight.
  completeRef.current = onComplete;

  const clearTimers = () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
  };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const playExecuteSound = () => {
    try {
      if (!audioRef.current) audioRef.current = new Audio("/sounds/execute.mp3");
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        /* autoplay policy — the sound is a bonus, never a blocker */
      });
    } catch {
      /* no Audio constructor on this surface */
    }
  };

  // A fresh run every time the card opens.
  useEffect(() => {
    if (!isOpen) return undefined;
    setStage(0);
    setConfirmed(false);
    setOutcome(null);
    completedRef.current = false;
    return clearTimers;
  }, [isOpen]);

  // Pacing: Connect → Terminal → Execute → onComplete.
  useEffect(() => {
    if (!isOpen) return undefined;
    if (stage === 0) {
      const timer = setTimeout(() => setStage(1), CONNECT_MS);
      timers.current.push(timer);
      return () => clearTimeout(timer);
    }
    if (stage === 1) {
      const timer = setTimeout(() => setStage(2), TERMINAL_MS);
      timers.current.push(timer);
      return () => clearTimeout(timer);
    }
    /**
     * EXECUTE — the analysis is revealed HERE, not when the card opened and
     * not after the run finishes: the trader has watched the line reach the
     * last node, which is the moment "execution began" means to them.
     */
    if (!completedRef.current) {
      completedRef.current = true;
      completeRef.current?.();
    }
    return undefined;
  }, [isOpen, stage]);

  // The bridge's real answer, broadcast on the app event bus.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean; message?: string }>).detail ?? {};
      const message = typeof detail.message === "string" ? detail.message : "";
      const ok = detail.ok === true;

      if (ok) {
        // A fill really happened: the confirmation sound belongs to this moment.
        playExecuteSound();
        setStage(2);
        setConfirmed(true);
        setOutcome(null);
        later(onClose, CONFIRMED_MS);
        return;
      }
      /**
       * A REFUSAL IS AN OUTCOME, A PROGRESS LINE IS NOT.
       *
       * The engine broadcasts its own progress on this same channel
       * ("CONNECTING TO BROKER…"), and treating those as a result is what made
       * the old card announce a finish before a single order existed. Only a
       * failure-shaped answer ends the run, and it says why.
       */
      if (/refus|failed|error|could not|no saved|not (?:found|sent)/i.test(message)) {
        setStage(2);
        setConfirmed(false);
        setOutcome(message || "Execution was refused");
        later(onClose, CONFIRMED_MS + 1_200);
      }
    };
    window.addEventListener("eamp:execution-result", handler);
    return () => window.removeEventListener("eamp:execution-result", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const activeSymbol = (symbol ?? "").trim() || "XAUUSD.m";

  const statusText = outcome
    ? outcome
    : confirmed
      ? "Confirmed on MetaTrader"
      : stage === 0
        ? "Loading symbol"
        : stage === 1
          ? "Linking broker terminal"
          : "Executing trades to MetaTrader";

  const progress = stage === 0 ? 0 : stage === 1 ? 50 : 100;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${botName} execution — ${activeSymbol}, ${Math.max(totalTrades, 0)} trade${totalTrades === 1 ? "" : "s"}`}
      data-mode={mode}
      data-symbol={activeSymbol}
      data-stage={stage}
      className="fixed inset-x-0 top-3 z-[9999] mx-auto w-[95%] max-w-md overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(160deg,rgba(24,26,30,.96),rgba(10,11,13,.98))] p-4 shadow-[0_18px_50px_rgba(0,0,0,.65)] backdrop-blur-xl animate-[slideDown_0.3s_ease-out]"
      style={{ marginTop: "var(--sa-top)" }}
    >
      {/* ── Top row: READY capsule · avatar · close ── */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-wider text-white">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"
          />
          READY
        </span>

        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10">
            {robotImage ? (
              <img
                src={robotImage}
                alt={`${botName} robot`}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <Bot className="size-5 text-white/70" aria-hidden="true" />
            )}
          </span>
          <button
            type="button"
            aria-label="Close execution steps"
            onClick={() => {
              clearTimers();
              /**
               * DISMISSING THE PIPELINE IS NOT CANCELLING THE RUN. If the
               * trader closes the card early the analysis still has to be
               * reachable, or the signal detail becomes invisible to somebody
               * who tapped ✕ — which is worse than the order they disliked.
               */
              if (!completedRef.current) {
                completedRef.current = true;
                completeRef.current?.();
              }
              onClose();
            }}
            className="flex size-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/70 transition-colors hover:text-white"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Symbol · subtitle · live stage ── */}
      <p className="mt-2 text-[22px] font-black leading-none tracking-tight text-white">
        {activeSymbol}
      </p>
      <p className="mt-1 text-[12px] font-medium text-white/50">Chart scan</p>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400">
        <span aria-hidden="true">✓</span>
        <span className="min-w-0 truncate">{statusText}</span>
      </p>

      {/* ── Stepper ── */}
      <div className="mt-5 mb-1 px-1">
        <div className="relative">
          {/* Track + fill sit behind the dots and run between the first and
              last node centres. */}
          <div className="absolute left-2 right-2 top-[5px] h-[2px] rounded-full bg-white/10" aria-hidden="true">
            <div
              className="h-full rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="relative flex items-start justify-between">
            {NODES.map((label, index) => {
              const reached = stage >= index;
              const current = stage === index;
              return (
                <li key={label} className="flex flex-1 flex-col items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      reached
                        ? `size-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]${current ? " animate-pulse" : ""}`
                        : "size-2.5 rounded-full border border-white/25 bg-[#1a1a1f]"
                    }
                  />
                  <span
                    className={
                      reached
                        ? "text-[10px] font-bold uppercase tracking-wider text-white"
                        : "text-[10px] font-medium uppercase tracking-wider text-white/40"
                    }
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default TradeExecutionToast;
