import { useEffect, useState } from "react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { getBridgeUrl } from "@/lib/bridge-client";
import { formatLot, formatPrice, type ExecutionSide } from "@/lib/execution-events";
import { recordExecutionResult, useExecutionState } from "@/lib/execution-state";
import { useAppState } from "@/lib/app-store";
import type { Robot } from "@/lib/app-store";

/**
 * AI TRADE ANALYSIS — the card that shows what the bot is trading RIGHT NOW.
 *
 * Everything on it is real:
 *  • the symbol is the symbol the bot was started on;
 *  • the direction badge is the direction that was analysed — and, once a
 *    fill lands, the direction the BROKER confirmed;
 *  • the READY chip reflects the real bridge state, not a decoration;
 *  • Entry / SL / TP are the broker's own numbers once the order filled,
 *    and the analysed levels before that — never a made-up example;
 *  • the status line is the bot's real stage, the same line the floating
 *    bot popup narrates;
 *  • the last line repeats the real stop loss and take profit.
 *
 * The card floats near the top of the screen, ABOVE the robot card, and it
 * never swallows a tap: the wrapper is click-through and only the close
 * button takes input.
 */

type TradeAnalysisPopupProps = {
  /** Whether the card should be on screen. */
  isOpen: boolean;
  /** Dismiss the card. */
  onClose: () => void;
  /** The robot the run belongs to. When omitted the active robot is used. */
  robot?: Robot | undefined;
  /** True on the scanner screen, false on the home dashboard. */
  scannerMode?: boolean;
  /** The id of the active robot, so the card can resolve "ready" without a
   *  guessed Robot reference. */
  activeRobotId?: string;
};

/** How often the real bridge state is re-read while the card is open. */
const BRIDGE_POLL_MS = 20_000;

/**
 * Read the bridge's real health. The bridge answers /health without a key,
 * so this is a genuine round trip to the machine that places the orders —
 * the READY chip never pretends to know more than it does.
 */
async function readBridgeOnline(): Promise<boolean> {
  const url = getBridgeUrl();
  try {
    const response = await fetch(`${url}/health`, { cache: "no-store" });
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => null)) as { status?: string } | null;
    const status = (payload?.status ?? "").toLowerCase();
    return status === "online" || status === "ok";
  } catch (error) {
    // Say WHICH address was polled — a stale URL and an offline bridge look
    // identical from the UI otherwise.
    console.warn(
      `[bridge] health check failed at ${url}/health:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export function TradeAnalysisPopup({
  isOpen,
  onClose,
  robot,
  scannerMode = false,
  activeRobotId,
}: TradeAnalysisPopupProps) {
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const execution = useExecutionState();
  const appState = useAppState();
  const [bridgeOnline, setBridgeOnline] = useState(false);

  // The confirmed fills arrive on the shared execution bus — the same bus
  // the top toast and the floating bot popup read.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event: Event) => {
      recordExecutionResult((event as CustomEvent).detail);
    };
    window.addEventListener("eamp:execution-result", handler);
    return () => window.removeEventListener("eamp:execution-result", handler);
  }, [isOpen]);

  // The real bridge state, re-read while the card is open.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const check = async () => {
      const online = await readBridgeOnline();
      if (!cancelled) setBridgeOnline(online);
    };
    void check();
    const timer = window.setInterval(() => void check(), BRIDGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen]);

  // Prefer the caller-supplied robot, then the active robot from the store.
  const robotForReady =
    robot ??
    appState?.robots.find(
      (candidate) =>
        candidate.id === (activeRobotId ?? appState?.activeRobotId),
    ) ??
    null;

  if (!isOpen) return null;

  const plan = execution.plan;
  const last = execution.last;

  // The confirmed fill wins over the plan: those are the broker's numbers.
  const symbol = last?.symbol || plan?.symbol || "";
  const side: ExecutionSide | null = last?.side ?? plan?.direction ?? null;
  const digits = last?.digits ?? plan?.digits ?? null;
  const entry = last?.entry ?? plan?.entry ?? null;
  const stopLoss = last?.stopLoss ?? plan?.stopLoss ?? null;
  const takeProfit = last?.takeProfit ?? plan?.takeProfit ?? null;
  const lotSize = last?.lotSize ?? plan?.lotSize ?? null;
  const totalTrades =
    last?.index !== null
      ? last?.total ?? null
      : last?.total ?? plan?.totalTrades ?? null;

  // READY = the bridge is really up AND the bot is really set to trade.
  // On the scanner a run is its own trade, so the live run is enough; on the
  // dashboard the robot has to be running. The active run always counts.
  const botSetToTrade =
    scannerMode
      ? execution.active
      : (robotForReady?.running ??
          false) || execution.active;
  const ready = bridgeOnline && botSetToTrade;

  const isBuy = side === "BUY";
  const badgeClasses = isBuy
    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
    : side === "SELL"
      ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
      : "border-white/10 bg-white/5 text-white/45";
  const directionClasses = isBuy
    ? "text-emerald-400"
    : side === "SELL"
      ? "text-rose-400"
      : "text-white/45";

  const entryText = formatPrice(entry, digits);
  const stopText = formatPrice(stopLoss, digits);
  const targetText = formatPrice(takeProfit, digits);
  const lotText = formatLot(lotSize);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[9998] mx-auto w-[95%] max-w-md"
      style={{ top: "calc(var(--sa-top) + 92px)" }}
    >
      <div
        role="status"
        aria-live="polite"
        className="if-card animate-[slideDown_0.3s_ease-out] rounded-[20px] border p-4 shadow-2xl backdrop-blur"
        style={{
          borderColor: `${accent}44`,
          boxShadow: `0 18px 40px rgba(0,0,0,0.55), 0 0 26px ${accent}1f`,
        }}
      >
        {/* Badge · symbol · READY · close */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black tracking-wide ${badgeClasses}`}
          >
            <span aria-hidden>{isBuy ? "↑" : side === "SELL" ? "↓" : "•"}</span>
            {side ?? "—"}
          </span>
          {symbol ? (
            <span className="if-text text-[15px] font-black">{symbol}</span>
          ) : null}
          <span className="flex-1" />
          {ready ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
              READY
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Close trade analysis"
            onClick={onClose}
            className="pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Source label */}
        <p className="if-header mt-2.5 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
          AI trade
        </p>

        {/* The bot's real stage */}
        {execution.stage ? (
          <p className="if-text mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold leading-snug">
            <span aria-hidden style={{ color: accent }}>✓</span>
            <span className="min-w-0 break-words">{execution.stage}</span>
          </p>
        ) : (
          <p className="if-muted mt-1.5 text-[12px] font-semibold">Waiting for the broker…</p>
        )}

        {/* The analysis box */}
        <div className="if-well mt-3 overflow-hidden rounded-[14px] border">
          <p
            className="border-b border-white/10 px-3 py-1.5 text-[10px] font-black tracking-[0.16em] text-white/45"
            style={{ color: `${accent}cc` }}
          >
            AI TRADE ANALYSIS
          </p>
          <div className="space-y-1.5 px-3 py-2.5">
            <p className={`text-[13px] font-black tracking-wide ${directionClasses}`}>
              {symbol || "—"} {side ?? ""}
            </p>
            {entryText || stopText || targetText ? (
              <p className="if-num if-text text-[12px] font-bold">
                {entryText ? `Entry ${entryText}` : "Entry —"}
                {" · "}
                {stopText ? `SL ${stopText}` : "SL —"}
                {" · "}
                {targetText ? `TP ${targetText}` : "TP —"}
              </p>
            ) : (
              <p className="if-muted text-[12px]">
                Waiting for the broker&apos;s own levels — nothing is shown until they arrive.
              </p>
            )}
            {/* ENTRY CONTEXT, MEASURED. Trend and extension in ATR(14) are
                shown when the analysis reported them. They are context only:
                the short-term direction trades immediately, and the only
                refusals are the hard safety blocks named elsewhere. */}
            {plan?.entryReason || typeof plan?.extensionAtr === "number" || plan?.trend ? (
              <div className="space-y-0.5 rounded-[10px] border border-white/10 px-2 py-1.5">
                <p className="if-num if-text text-[12px] font-bold">
                  Trend {plan?.trend ?? side ?? "—"}
                  {typeof plan?.extensionAtr === "number"
                    ? ` · Extension ${plan.extensionAtr.toFixed(2)} ATR`
                    : ""}
                </p>
                {plan?.entryReason ? (
                  <p className="if-muted text-[11px] leading-snug">{plan.entryReason}</p>
                ) : null}
              </div>
            ) : null}
            {lotText ? (
              <p className="if-muted text-[12px]">Lot size {lotText}</p>
            ) : null}
            {totalTrades ? (
              <p className="if-muted text-[12px]">Trades in this run: {totalTrades}</p>
            ) : null}
            <p className="if-muted text-[11px] leading-snug">
              {stopText ? `SL: ${stopText}, ` : ""}
              {targetText ? `TP: ${targetText}. ` : ""}
              Use proper position sizing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TradeAnalysisPopup;
