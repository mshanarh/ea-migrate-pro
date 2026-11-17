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
 * THE CARD DOES NOT CLOSE ITSELF. It used to walk off screen 2.8 s after the
 * fill (and 4 s after a refusal), so a trader who looked away came back to an
 * empty screen with no ticket and no reason. It now stays exactly where it is
 * until the X in the top-right corner is pressed — the person running the
 * trade is the one who decides when the report is finished.
 *
 * ITS COLOURS COME FROM THE THEME. The surfaces, ink, muted copy and borders
 * read the interface's own `--if-*` tokens (which White mode repaints to light
 * surfaces with dark ink — see lib/interface-themes.ts), and the progress bar,
 * stage dots and ring use the selected ACCENT. Nothing here is hardcoded white
 * or hardcoded black, so the card belongs to whichever theme is chosen.
 *
 * The direction is read, never assumed: it comes from the run's own plan (the
 * `direction` prop) and is corrected by the bridge's `eamp:execution-result`
 * payload (`side`), which is the only authority on what was really sent.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { useExecutionState } from "@/lib/execution-state";

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
const CONNECT_MS = 300;
const TERMINAL_MS = 400;

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
  // THE THEME IN USE — accent for the progress treatment, tokens for surfaces.
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  // The running plan already knows the side as soon as the candles are read, so
  // the card can show it without waiting for the first fill.
  const executionState = useExecutionState();
  const planSide = executionState.plan?.direction;

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

  // A fresh run every time the card opens. Nothing here schedules a close:
  // the only thing that ends this card is the X (or the caller's own state).
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

  /**
   * THE SIDE ARRIVES WHEN THE MARKET HAS BEEN READ.
   *
   * It can come from the caller (the scanner already knows it) or from the
   * running plan (Home learns it the moment the candles are analysed). Only a
   * real BUY or SELL is accepted — "BOTH" and an unknown plan say nothing about
   * the order that is about to be sent.
   */
  useEffect(() => {
    if (!isOpen) return;
    const candidate = direction ?? (planSide === "BUY" || planSide === "SELL" ? planSide : null);
    if (candidate === "BUY" || candidate === "SELL") setSide(candidate);
  }, [isOpen, direction, planSide]);

  const hasSignal = side === "BUY" || side === "SELL";

  /**
   * PACING — AND IT WAITS FOR A SIGNAL.
   *
   * A run that has not found a direction yet must not walk itself to Execute:
   * that is the card claiming a trade that does not exist. It sits on Connect
   * saying it is analysing, and only starts moving once a side is known.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
    if (!hasSignal) {
      setStage(0);
      return undefined;
    }
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
  }, [isOpen, stage, hasSignal]);

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
          status?: string;
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
      const status = typeof detail.status === "string" ? detail.status : "";
      /**
       * NARRATION IS NOT AN OUTCOME. "info" and "reanalysed" lines report what
       * the engine is thinking; confirming on them ended the card in the middle
       * of a run and closed it before the trade it was describing.
       */
      if (status === "info" || status === "reanalysed") return;
      if (detail.ok === true) {
        // Only a real fill confirms — not narration.
        if (detail.status === "info" || detail.status === "reanalysed") return;
        playExecuteSound();
        setStage(2);
        setConfirmed(true);
        setOutcome(null);
        return;
      }
      /**
       * A REFUSAL IS AN OUTCOME, A PROGRESS LINE IS NOT. The engine broadcasts
       * "CONNECTING TO BROKER…" on this same channel and treating that as a
       * result is how the old card announced a finish before an order existed.
       */
      if (/refus|failed|error|could not|no saved|not (?:found|sent)|no trade/i.test(message)) {
        setStage(2);
        setConfirmed(false);
        setOutcome(message || "Execution was refused");
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
          : hasSignal
            ? "Loading symbol"
            : "Reading broker candles...";

  const orderType = side === "SELL" ? "Sell order" : side === "BUY" ? "Buy order" : "Market order";
  const progress = stage === 0 ? "0%" : stage === 1 ? "50%" : "100%";
  const tone = outcome ? "#f87171" : confirmed ? "#34d399" : accent;

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
      className="if-card animate-[slideDown_0.3s_ease-out] fixed inset-x-0 top-3 z-[9999] mx-auto w-[95%] max-w-md rounded-[24px] border p-4 transition-all"
      style={{
        // THE THEME'S OWN PANEL: a light card in White mode, obsidian glass in
        // Black mode. `.if-card` (when the interface is styled) refines this
        // with the theme's radius, border, blur and shadow.
        backgroundColor: "var(--if-surface, rgba(18, 20, 26, 0.94))",
        borderColor: "var(--if-border, rgba(255, 255, 255, 0.12))",
        color: "var(--if-text, #f8fafc)",
        backdropFilter: "blur(22px) saturate(1.45)",
        WebkitBackdropFilter: "blur(22px) saturate(1.45)",
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45)",
        marginTop: "var(--sa-top)",
      }}
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
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{
                backgroundColor: "var(--if-surface-alt, rgba(255,255,255,0.08))",
                color: "var(--if-muted, rgba(226,232,240,0.75))",
              }}
            >
              ANALYZING
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold"
            style={{
              borderColor: "var(--if-border, rgba(255,255,255,0.14))",
              backgroundColor: "var(--if-surface-alt, rgba(255,255,255,0.06))",
              color: "var(--if-text, #f8fafc)",
            }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: tone, boxShadow: `0 0 8px ${tone}` }}
            />
            {outcome ? "FAILED" : confirmed ? "FILLED" : "READY"}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close execution steps"
          onClick={() => {
            clearTimers();
            onClose();
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors hover:opacity-80"
          style={{
            borderColor: "var(--if-border, rgba(255,255,255,0.16))",
            backgroundColor: "var(--if-surface-alt, rgba(255,255,255,0.08))",
            color: "var(--if-text, #f8fafc)",
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Row 2: symbol · order type · status | avatar ── */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-2xl font-black tracking-tight"
            style={{ color: "var(--if-text, #ffffff)" }}
          >
            {activeSymbol}
          </p>
          <p className="mt-0.5 text-xs font-semibold" style={{ color: "var(--if-muted, rgba(226,232,240,0.65))" }}>
            {orderType}
          </p>
          <p
            className="mt-2 flex items-center gap-1.5 text-xs font-bold"
            style={{ color: outcome ? "#f87171" : "var(--if-text, #e2e8f0)" }}
          >
            <span className="font-black" style={{ color: tone }} aria-hidden="true">
              {outcome ? "!" : "✓"}
            </span>
            <span className="min-w-0 truncate">{statusText}</span>
          </p>
        </div>
        <div
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 shadow-sm"
          style={{
            borderColor: `${accent}66`,
            backgroundColor: "var(--if-surface-alt, rgba(255,255,255,0.08))",
          }}
        >
          {robotImage ? (
            <img
              src={robotImage}
              alt={`${botName} robot`}
              className="size-full rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <Bot className="size-5" style={{ color: "var(--if-muted, rgba(255,255,255,0.7))" }} aria-hidden="true" />
          )}
        </div>
      </div>

      {/* ── Row 3: Connect ── Terminal ── Execute ── */}
      <div className="mt-5 mb-1 px-1">
        <div className="relative">
          <div
            className="absolute left-2 right-2 top-[5px] h-[2px] rounded-full"
            style={{ backgroundColor: "var(--if-border, rgba(255,255,255,0.14))" }}
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: progress, backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
            />
          </div>
          <ol className="relative flex items-start justify-between">
            {NODES.map((label, index) => {
              const reached = stage >= index;
              return (
                <li key={label} className="flex flex-1 flex-col items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full border"
                    style={
                      reached
                        ? { backgroundColor: accent, borderColor: accent, boxShadow: `0 0 10px ${accent}` }
                        : {
                            backgroundColor: "var(--if-surface-alt, rgba(255,255,255,0.08))",
                            borderColor: "var(--if-border, rgba(255,255,255,0.25))",
                          }
                    }
                  />
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: reached ? "var(--if-text, #e2e8f0)" : "var(--if-muted, rgba(226,232,240,0.55))" }}
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
