import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { hasNativeBridge, callNative } from "@/lib/native-bridge";
import { executeAnalysedSignal, readMtCredentials, resolveTradeDirection } from "@/lib/auto-trade";
import { getAppState } from "@/lib/app-store";
import { sideForCurrency } from "@/lib/event-symbols";
import { peekPendingSignal } from "@/lib/pending-signal";
import type { FundamentalsOrderResult } from "@/lib/mt5-bridge.server";

/**
 * ANALYZE → EXECUTE, one card, used by BOTH entry points:
 *   • the Quotes (symbols list) detail view — tap a symbol, press Analyze;
 *   • the Fundamentals event detail — tap an event, press Analyze.
 *
 * The rules this card enforces:
 *  1. The direction is TAKEN FROM THE ANALYSIS ONLY. It is displayed, never
 *     edited — there is no side toggle to flip.
 *  2. The analysis comes from live broker candles through the bridge
 *     (last completed M15 bars, the same engine the auto-trader uses). Nothing
 *     on this card is hardcoded: no sample symbol, no example price.
 *     It runs IN THE BROWSER, like the bot's own analysis: the deployed app is
 *     a static client site, so the MT5 password saved on this device (see
 *     readMtCredentials) is what signs the candle call. It used to run in a
 *     TanStack server function, which this deployment does not serve — the
 *     request came back as the SPA shell and Analyze could never answer.
 *  3. Execution is BLOCKED, with the exact reason shown, when the analysis is
 *     stale, missing, or produced no tradeable direction.
 *  4. A fill is only reported as CONFIRMED when MT5 answered with a ticket and
 *     a price. A refusal is shown in red with the broker's own error text.
 */

export type AnalyzedSignal = {
  symbol: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  livePrice: number;
  analysedAt: number;
  reason: string;
  /** Where the SIDE came from — the event's day, or the live candles. */
  sideSource?: "event" | "candles";
  /** One line naming that source, in the trader's words. */
  sideNote?: string;
};

/** The analysis is only executable for this long after it was produced. */
export const ANALYSIS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * THE BOT NAME THIS DEVICE WOULD PLACE A TRADE UNDER.
 *
 * A trade started from a symbol page is the same trade the bot would send, so
 * it must carry the same MT5 comment: the ACTIVE ROBOT'S NAME. Only
 * Fundamentals is allowed to say otherwise, because an economic-release order
 * is a different thing and the trader asked for it to be recognisable.
 *
 * Falls back to the app's own name when no robot is active — never to an empty
 * comment, which some brokers reject outright.
 */
function activeRobotName(): string {
  const state = getAppState();
  const active = state.robots.find((robot) => robot.id === state.activeRobotId);
  return (active?.name ?? "").trim() || "EA Migrate";
}

export function formatPrice(value: number | null | undefined, digits?: number | null): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  if (typeof digits === "number" && digits >= 0 && digits <= 8) return value.toFixed(digits);
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

export function formatLot(value: number | string | null | undefined): string {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(num) || num <= 0) return "0.01";
  // Brokers quote 0.01 style lots; trim a trailing zero-heavy float.
  return String(Number(num.toFixed(4)));
}

/** True when this analysis is still fresh enough to execute. */
export function isSignalFresh(signal: AnalyzedSignal | null, now = Date.now()): boolean {
  if (!signal) return false;
  return now - signal.analysedAt <= ANALYSIS_MAX_AGE_MS;
}

/**
 * How stale an analysis is, in words, for the block message.
 */
export function stalenessText(signal: AnalyzedSignal, now = Date.now()): string {
  const ageMs = Math.max(0, now - signal.analysedAt);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return `${Math.round(ageMs / 1000)}s old`;
  return `${minutes}m old`;
}

export type AnalyzeExecuteCardProps = {
  /** Signed-in email — the server reads the MT5 record for this user. */
  userId: string | null;
  /** The symbol to analyse. Empty renders a "pick a symbol" state. */
  symbol: string | null;
  /** Pre-filled from the bot's configured defaults. */
  defaultLot: string;
  defaultTrades: string;
  /** Optional heading override (e.g. the event's own label). */
  contextLabel?: string | undefined;
  /**
   * THE EVENT'S READ, when this card was opened from an economic release.
   *
   * `direction` is what the release says about `currency` for its own day; the
   * card turns it into THIS symbol's side (see sideForCurrency) so the analysis
   * is the event's direction and not a candle guess. Left undefined on the
   * symbols list, where the live candles are the only source. Passed as null
   * for an event that has not released yet — there is no read to honour. */
  eventRead?: { currency: string; direction: "BUY" | "SELL" } | null | undefined;
  /** Which event day the read belongs to, shown on the card. */
  eventLabel?: string | undefined;
  /**
   * THE MT5 ORDER COMMENT FOR THIS ENTRY POINT.
   *
   * Fundamentals passes "Ea migrate news" — a news-event order is identifiable
   * as such in the broker's history, by the trader's own request. Everywhere
   * else it is left out and the order carries the ACTIVE ROBOT'S NAME, exactly
   * like a trade the bot placed itself (see `activeRobotName`). One card, two
   * entry points, two honest comments: the account's history never claims a
   * news trade was a bot trade, or the other way round.
   */
  orderComment?: string | undefined;
  /** Called once per finished batch, with MT5's confirmed fills. */
  onResult?: ((result: FundamentalsOrderResult, signal: AnalyzedSignal) => void) | undefined;
};

export function AnalyzeExecuteCard({
  userId,
  symbol,
  defaultLot,
  defaultTrades,
  contextLabel,
  eventRead,
  eventLabel,
  orderComment,
  onResult,
}: AnalyzeExecuteCardProps) {
  const [signal, setSignal] = useState<AnalyzedSignal | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [lot, setLot] = useState(defaultLot);
  const [trades, setTrades] = useState(defaultTrades);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<FundamentalsOrderResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  /** No MT5 account on this device — the one thing that stops both steps. */
  const NO_ACCOUNT_MESSAGE =
    "No MT5 account is saved on this device — add your login, password and server on the MetaTrader page first.";

  // A new symbol — or a different event day — is a new analysis. Never carry
  // the previous one over: its side belongs to the read it was made from.
  const eventKey = eventRead ? `${eventRead.currency}:${eventRead.direction}` : "";
  useEffect(() => {
    setSignal(null);
    setAnalyzeError(null);
    setResult(null);
    setFormError(null);
    setLot(defaultLot);
    setTrades(defaultTrades);
  }, [symbol, defaultLot, defaultTrades, eventKey]);

  /**
   * Publish the analysed signal to the NATIVE floating card when the app runs
   * inside the Android wrapper, so the trader can read it (and tap Execute)
   * while MetaTrader is in front. A wrapper without the feature simply returns
   * false and the in-app card stays the single source of truth.
   *
   * THE RUNNING BOT'S HELD SIGNAL OWNS THE FLOATING CARD. While one is waiting
   * for the trader (see pending-signal.ts), this card must not push its own
   * analysis over it — there is only one floating card, and the signal the
   * trader is on their way to read is the one that belongs there.
   */
  useEffect(() => {
    if (!hasNativeBridge()) return;
    if (peekPendingSignal()) return;
    if (signal) {
      callNative("showTradeAnalysis", JSON.stringify(signal));
    } else {
      callNative("hideTradeAnalysis");
    }
  }, [signal]);

  const runAnalysis = useCallback(async () => {
    setAnalyzeError(null);
    setResult(null);
    setFormError(null);
    if (!userId) {
      setAnalyzeError("Sign in again to analyze");
      return;
    }
    if (!symbol) {
      setAnalyzeError("Pick a symbol to analyze first");
      return;
    }
    // THE DEVICE'S OWN SAVED ACCOUNT. The password never leaves the phone —
    // the same credentials the bot's live executions use.
    const credentials = readMtCredentials(getAppState().mt);
    if (!credentials) {
      setSignal(null);
      setAnalyzeError(NO_ACCOUNT_MESSAGE);
      return;
    }
    setAnalyzing(true);
    try {
      const analysis = await resolveTradeDirection(symbol, {
        credentials,
        requireExecutionReady: true,
        rejectProxyData: true,
      });
      if (analysis.direction.type === "NO_TRADE") {
        setSignal(null);
        setAnalyzeError(analysis.direction.reason);
        return;
      }
      const direction = analysis.direction;
      const analysedSymbol = analysis.symbol || symbol;

      // ── THE EVENT'S DAY FIXES THE SIDE ────────────────────────────────────
      //
      // Opened from a release, this card trades the side that release implies
      // FOR THIS PAIR (a currency is the pair's base or its quote, see
      // sideForCurrency). The broker's candles still supply the levels: the
      // same measured risk and reward, mirrored onto that side.
      //
      // Two honest exceptions, both named on the card:
      //   • the event's currency prices the instrument but does not fix a side
      //     (an index CFD) — the live candles keep the side;
      //   • the event has not released yet, so there is no read to honour.
      const eventSide = eventRead
        ? sideForCurrency(analysedSymbol, eventRead.currency, eventRead.direction)
        : null;
      const candleSide = direction.type;
      const entry = direction.entry;
      const candleSl = direction.sl;
      const candleTp1 = direction.tp1 ?? direction.tp;
      const candleTp2 = direction.tp2 ?? direction.tp;

      let side: "BUY" | "SELL" = candleSide;
      let stopLoss = candleSl;
      let takeProfit1 = candleTp1;
      let takeProfit2 = candleTp2;
      let sideSource: "event" | "candles" = "candles";
      let sideNote = `Side from the live ${analysedSymbol} candles.`;

      if (eventRead && eventSide) {
        sideSource = "event";
        if (eventSide === candleSide) {
          sideNote = `Event day read ${eventRead.direction} ${eventRead.currency} → ${eventSide} ${analysedSymbol}, confirmed by the live candles.`;
        } else {
          const risk = Math.abs(entry - candleSl);
          const reward1 = Math.abs(candleTp1 - entry);
          const reward2 = Math.abs(candleTp2 - entry);
          side = eventSide;
          stopLoss = eventSide === "BUY" ? entry - risk : entry + risk;
          takeProfit1 = eventSide === "BUY" ? entry + reward1 : entry - reward1;
          takeProfit2 = eventSide === "BUY" ? entry + reward2 : entry - reward2;
          sideNote =
            `Event day read ${eventRead.direction} ${eventRead.currency} → ${eventSide} ${analysedSymbol}. ` +
            `The candles read ${candleSide}, so their measured risk (${formatPrice(risk)}) and reward ` +
            `(${formatPrice(reward1)} / ${formatPrice(reward2)}) were mirrored onto the event's side.`;
        }
      } else if (eventRead) {
        sideNote =
          `${eventRead.currency} prices ${analysedSymbol} but does not fix its side — ` +
          `the side comes from the live candles.`;
      }

      setSignal({
        symbol: analysedSymbol,
        direction: side,
        entry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        livePrice: entry,
        analysedAt: analysis.timestamp,
        reason: `${sideNote} ${analysis.reason}`,
        sideSource,
        sideNote,
      });
    } catch (error) {
      setSignal(null);
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [symbol, userId, eventRead]);

  /**
   * EXECUTE FROM THE FLOATING NATIVE CARD.
   *
   * The Android card floats over MetaTrader and cannot run this app's trading
   * code, so its Execute button dispatches `eamp:native-execute` into the page
   * (see MainActivity). The tap lands here and runs the SAME function the
   * in-app button runs — same direction, same levels, same risk checks, same
   * MT5 confirmation. Nothing about the order changes because of where the
   * button was drawn.
   */
  const executeRef = useRef<() => Promise<void> | void>(() => {});

  const lotValue = Number.parseFloat(lot);
  const tradesValue = Number.parseInt(trades, 10);
  const totalVolume =
    Number.isFinite(lotValue) && lotValue > 0 && Number.isFinite(tradesValue) && tradesValue > 0
      ? Number((lotValue * tradesValue).toFixed(4))
      : 0;

  /** Why execution is blocked right now, or null when it may proceed. */
  const blockedReason = useCallback((): string | null => {
    if (!signal) return "No analyzed signal yet — press Analyze first";
    if (!isSignalFresh(signal)) {
      return `The analysis is ${stalenessText(signal)} — press Analyze again for fresh levels before executing`;
    }
    if (!Number.isFinite(lotValue) || lotValue <= 0) return "Lot size must be greater than 0";
    if (!Number.isInteger(tradesValue) || tradesValue <= 0) {
      return "Number of trades must be a whole number above 0";
    }
    if (!userId) return "Sign in again to execute";
    return null;
  }, [signal, lotValue, tradesValue, userId]);

  const execute = async () => {
    setFormError(null);
    setResult(null);
    const blocked = blockedReason();
    if (blocked) {
      setFormError(blocked);
      return;
    }
    if (!signal || !userId) return;
    const credentials = readMtCredentials(getAppState().mt);
    if (!credentials) {
      setFormError(NO_ACCOUNT_MESSAGE);
      return;
    }
    setExecuting(true);
    try {
      const reply = await executeAnalysedSignal({
        credentials,
        symbol: signal.symbol,
        // The analysed side is the only side that can be sent.
        direction: signal.direction,
        lotSize: lotValue,
        trades: tradesValue,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit1,
        // Fundamentals: "Ea migrate news". Everywhere else: the robot's name,
        // exactly as a bot-placed order carries it.
        comment: (orderComment ?? "").trim() || activeRobotName(),
      });
      setResult(reply);
      if (!reply.ok) setFormError(reply.message);
      onResult?.(reply, signal);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Order failed");
    } finally {
      setExecuting(false);
    }
  };

  useEffect(() => {
    executeRef.current = execute;
  });

  useEffect(() => {
    const handler = () => {
      // A held BOT signal owns the floating card and its Execute tap — the tap
      // belongs to the trading loop, not to this page's analysis.
      if (peekPendingSignal()) return;
      void executeRef.current();
    };
    window.addEventListener("eamp:native-execute", handler);
    return () => window.removeEventListener("eamp:native-execute", handler);
  }, []);

  const isBuy = signal?.direction === "BUY";
  const directionColor = isBuy ? "#4ade80" : "#f87171";
  const executeBlocked = blockedReason();

  const body = (
    <>
      {/* ── Status dot · direction · symbol ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-black tracking-wide"
          style={{
            borderColor: signal ? `${directionColor}66` : "rgba(255,255,255,0.14)",
            backgroundColor: signal ? `${directionColor}22` : "rgba(255,255,255,0.05)",
            color: signal ? directionColor : "rgba(255,255,255,0.5)",
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: signal ? directionColor : "rgba(255,255,255,0.35)" }}
            aria-hidden
          />
          {signal ? `${signal.direction} · ${signal.symbol}` : "NO SIGNAL"}
        </span>
        <span className="flex-1" />            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">
              {eventRead ? "event day · live candles" : "live candles"}
            </span>
      </div>

      {/* ── AI TRADE ANALYSIS card ─────────────────────────────────────── */}
      {analyzing && (
        <div className="mt-3 flex items-center gap-2 rounded-[16px] border border-white/10 bg-black/40 px-3 py-3 text-[12px] text-white/60">
          <Loader2 className="size-4 animate-spin" /> Reading live broker candles…
        </div>
      )}

      {!analyzing && signal && (
        <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/45">
          <p className="border-b border-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
            AI trade analysis
          </p>
          <div className="px-3 py-3">
            <p className="text-[20px] font-black leading-tight" style={{ color: directionColor }}>
              {signal.symbol} {signal.direction}
            </p>
            <p className="mt-1 text-[13px] font-bold tabular-nums text-white/90">
              Entry {formatPrice(signal.entry)} · SL {formatPrice(signal.stopLoss)} · TP1{" "}
              {formatPrice(signal.takeProfit1)} · TP2 {formatPrice(signal.takeProfit2)}
            </p>
            <p className="mt-1 text-[11px] text-white/40">live data · connected terminal</p>
            <p className="mt-2 text-[11px] leading-snug text-white/45">{signal.reason}</p>
            {!isSignalFresh(signal) && (
              <p className="mt-2 text-[11px] font-bold text-amber-300">
                INVALID — the analysis is {stalenessText(signal)}. Analyze again before executing.
              </p>
            )}
          </div>
        </div>
      )}

      {/* WHICH EVENT DAY THIS CARD BELONGS TO — the read the side came from. */}
      {eventLabel && (
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
          Event day · {eventLabel}
          {eventRead
            ? ` · read ${eventRead.direction} ${eventRead.currency}`
            : " · not released yet, so the candles decide"}
        </p>
      )}

      {analyzeError && (
        <p className="mt-3 rounded-[14px] border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          {analyzeError}
        </p>
      )}

      {!signal && !analyzing && !analyzeError && (
        <p className="mt-3 text-[12px] text-white/45">
          {symbol
            ? `Analyze ${symbol} to read the last completed M15 candles from your broker.`
            : "Pick a symbol to analyze."}
        </p>
      )}

      {/* ── Analyze ────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => void runAnalysis()}
        disabled={analyzing || !symbol}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-white/15 bg-white/5 text-[13px] font-black tracking-wide text-white disabled:opacity-40"
      >
        {analyzing ? <Loader2 className="size-4 animate-spin" /> : signal ? "Re-analyze" : `Analyze ${symbol ?? ""}`}
      </button>

      {/* ── Lot / trades / side — only once there is something to send ──── */}
      {signal && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Lot size</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={lot}
                onChange={(event) => setLot(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[14px] font-bold tabular-nums text-white outline-none focus:border-white/30"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                Number of trades
              </span>
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={trades}
                onChange={(event) => setTrades(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[14px] font-bold tabular-nums text-white outline-none focus:border-white/30"
              />
            </label>
          </div>

          <div className="mt-2 flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Total volume</span>
            <span className="text-[14px] font-black tabular-nums text-white/90">{totalVolume.toFixed(2)}</span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Direction</span>
            <span className="text-right text-[12px] font-black" style={{ color: directionColor }}>
              {signal.direction} —
              {signal.sideSource === "event"
                ? ` from the ${eventRead?.currency ?? "event"} event's day, not editable`
                : " from the live candles, not editable"}
            </span>
          </div>

          {signal.sideNote && (
            <p className="mt-2 text-[11px] leading-snug text-white/45">{signal.sideNote}</p>
          )}

          <button
            type="button"
            onClick={() => void execute()}
            disabled={executing || executeBlocked !== null}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-white text-[13px] font-black tracking-wide text-black disabled:opacity-40"
          >
            {executing ? <Loader2 className="size-5 animate-spin" /> : `EXECUTE ${signal.direction} ${signal.symbol}`}
          </button>

          {executeBlocked && (
            <p className="mt-2 text-[11px] text-amber-300">Blocked: {executeBlocked}</p>
          )}
        </>
      )}

      {formError && <p className="mt-2 text-[12px] text-rose-300">{formError}</p>}

      {/* ── MT5 confirmation, per trade ────────────────────────────────── */}
      {result && result.orders.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
            {result.brokerSymbol ? `MT5 · ${result.brokerSymbol}` : "MT5"}
            {result.livePrice != null ? ` · live ${formatPrice(result.livePrice)}` : ""}
            {result.freeMargin != null ? ` · free margin ${result.freeMargin.toFixed(2)}` : ""}
          </p>
          {result.orders.map((order) => {
            const confirmed = order.status === "executed";
            const side = signal?.direction ?? "—";
            return (
              <div
                key={order.index}
                className="rounded-[14px] border px-3 py-2"
                style={{
                  borderColor: confirmed ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)",
                  backgroundColor: confirmed ? "rgba(74,222,128,0.10)" : "rgba(248,113,113,0.10)",
                }}
              >
                <p
                  className="text-[12px] font-black"
                  style={{ color: confirmed ? "#4ade80" : "#f87171" }}
                >
                  {confirmed
                    ? `Trade ${order.index} CONFIRMED · ${side} ${formatLot(lot)} ${result.brokerSymbol ?? signal?.symbol ?? ""} @ ${formatPrice(order.entry)}`
                    : `Trade ${order.index} REJECTED · ${order.error ?? "MT5 did not confirm the fill"}`}
                </p>
              </div>
            );
          })}
          <p className="text-[11px] text-white/45">{result.message}</p>
        </div>
      )}
    </>
  );

  return (
    <div className="rounded-[20px] border border-white/12 bg-[#111] p-4 shadow-xl">
      <p className="text-[13px] font-extrabold uppercase tracking-[0.2em] text-white/70">
        {contextLabel ?? "Analyze"}
      </p>
      {body}
    </div>
  );
}

export default AnalyzeExecuteCard;
