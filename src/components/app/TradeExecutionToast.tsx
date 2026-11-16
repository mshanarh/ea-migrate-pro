/**
 * THE EXECUTION CARD — one popup, the whole run.
 *
 * Three stages move on their own clock (Connect → Terminal → Execute) while the
 * card also carries what the trader actually needs to see: which way the order
 * is going, how many of the batch are in, and the robot that is doing it.
 *
 * There is deliberately NO second "analysis" popup. It repeated the symbol and
 * direction this card already shows and covered the pipeline while it ran.
 *
 * The direction is read, never assumed: it comes from the run's own plan (the
 * `direction` prop) and is corrected by the bridge's `eamp:execution-result`
 * payload (`side`), which is the only authority on what was really sent.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomization } from "@/lib/app-customization";

type Side = "BUY" | "SELL";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  botName: string;
  totalTrades: number;
  /** "auto" runs the full broker sequence; "scanner" narrates the scan. */
  mode?: "scanner" | "auto";
  symbol?: string;
  robotImage?: string | null | undefined;
  /** The direction the run is taking, when the plan already knows it. */
  direction?: Side | null;
  /** How many trades of the batch are already in. */
  currentTrade?: number;
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
  direction = null,
  currentTrade = 0,
}: Props) {
  const { appearanceMode } = useCustomization();
  const isDark = appearanceMode !== "white";

  const [stage, setStage] = useState<Stage>(0);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(direction);
  const [filled, setFilled] = useState(currentTrade);
  const [total, setTotal] = useState(totalTrades);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    setSide(direction);
    setFilled(currentTrade);
    setTotal(totalTrades);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // The run's own plan can arrive after the card is already open.
  useEffect(() => {
    if (!isOpen || !direction) return;
    setSide(direction);
  }, [isOpen, direction]);

  // Pacing: Connect → Terminal → Execute — and it stops there. The card waits
  // for the bridge to say what actually happened.
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
    return undefined;
  }, [isOpen, stage]);

  // The bridge's real answer, broadcast on the app event bus.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event: Event) => {
      const detail =
        (event as CustomEvent<{
          ok?: boolean;
          message?: string;
          side?: string;
          index?: number;
          total?: number;
        }>).detail ?? {};

      // DIRECTION AND COUNT come from the payload, not from a guess here.
      const nextSide = (detail.side ?? "").toUpperCase();
      if (nextSide === "BUY" || nextSide === "SELL") setSide(nextSide);
      if (typeof detail.index === "number" && Number.isFinite(detail.index)) {
        setFilled(Math.max(0, Math.floor(detail.index)));
      }
      if (typeof detail.total === "number" && Number.isFinite(detail.total) && detail.total > 0) {
        setTotal(Math.floor(detail.total));
      }

      const message = typeof detail.message === "string" ? detail.message : "";
      if (detail.ok === true) {
        playExecuteSound();
        setStage(2);
        setConfirmed(true);
        setOutcome(null);
        later(onClose, CONFIRMED_MS);
        return;
      }
      /**
       * A REFUSAL IS AN OUTCOME, A PROGRESS LINE IS NOT. The engine broadcasts
       * "CONNECTING TO BROKER…" on this same channel and treating that as a
       * result is how the old card announced a finish before an order existed.
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
  const currentIndex = Math.max(1, filled || 1);

  const statusText = outcome
    ? outcome
    : confirmed
      ? "Confirmed on MetaTrader"
      : stage === 2
        ? total > 1
          ? `Executing ${currentIndex} of ${total}`
          : "Executing trades to MetaTrader"
        : stage === 1
          ? "Linking broker terminal"
          : "Loading symbol";

  const orderType = side === "SELL" ? "Sell order" : side === "BUY" ? "Buy order" : "Market order";
  const progress = stage === 0 ? "0%" : stage === 1 ? "50%" : "100%";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${botName} execution — ${activeSymbol}, ${orderType}, ${Math.max(total, 0)} trade${total === 1 ? "" : "s"}`}
      data-mode={mode}
      data-symbol={activeSymbol}
      data-stage={stage}
      data-side={side ?? "none"}
      data-eamp-exec-card=""
      className={cn(
        // `dark` on the card itself activates the dark: variants below without
        // repainting the rest of the app for the sake of one popup.
        "fixed inset-x-0 top-3 z-[9999] mx-auto w-[95%] max-w-md rounded-[24px] border p-4 shadow-2xl backdrop-blur-2xl transition-all",
        "bg-white/95 text-slate-900 border-slate-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.12)]",
        "dark:bg-[#15171c]/95 dark:text-white dark:border-white/10 dark:shadow-[0_20px_50px_rgba(0,0,0,0.65)]",
        "animate-[slideDown_0.3s_ease-out]",
        isDark && "dark",
      )}
      style={{ marginTop: "var(--sa-top)" }}
    >
      {/* ── Row 1: side · READY · close ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {side === "SELL" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ef4444] px-2.5 py-1 text-[11px] font-black tracking-wide text-white shadow-sm">
              <span aria-hidden="true">↓</span> SELL
            </span>
          ) : side === "BUY" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#10b981] px-2.5 py-1 text-[11px] font-black tracking-wide text-white shadow-sm">
              <span aria-hidden="true">↑</span> BUY
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:bg-white/10 dark:text-slate-300">
              ANALYZING
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"
            />
            READY
          </span>
        </div>
        <button
          type="button"
          aria-label="Close execution steps"
          onClick={() => {
            clearTimers();
            onClose();
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-600 transition-colors hover:text-slate-900 dark:border-white/15 dark:bg-white/10 dark:text-slate-300 dark:hover:text-white"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Row 2: symbol · order type · status | avatar ── */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {activeSymbol}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {orderType}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <span className="font-black text-emerald-500" aria-hidden="true">
              ✓
            </span>
            <span className="min-w-0 truncate">{statusText}</span>
          </p>
        </div>
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 shadow-sm dark:border-white/15 dark:bg-white/10">
          {robotImage ? (
            <img
              src={robotImage}
              alt={`${botName} robot`}
              className="size-full rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <Bot className="size-5 text-slate-500 dark:text-white/70" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* ── Row 3: Connect ── Terminal ── Execute ── */}
      <div className="mt-5 mb-1 px-1">
        <div className="relative">
          <div
            className="absolute left-2 right-2 top-[5px] h-[2px] rounded-full bg-slate-200 dark:bg-white/10"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-blue-600 shadow-[0_0_8px_#2563eb] transition-all duration-700 ease-out"
              style={{ width: progress }}
            />
          </div>
          <ol className="relative flex items-start justify-between">
            {NODES.map((label, index) => {
              const reached = stage >= index;
              return (
                <li key={label} className="flex flex-1 flex-col items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      reached
                        ? "size-2.5 rounded-full bg-blue-600 shadow-[0_0_10px_#2563eb]"
                        : "size-2.5 rounded-full border border-slate-300 bg-slate-100 dark:border-white/25 dark:bg-[#1a1a1f]"
                    }
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
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
