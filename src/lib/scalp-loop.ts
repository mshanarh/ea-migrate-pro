import {
  classifyNoTrade,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "./auto-trade";
import { BRIDGE_KEY, bridgeUnreachableMessage, getBridgeUrl } from "./bridge-client";
import { setExecutionStage, updateExecutionPlan } from "./execution-state";
import {
  notifyBrokerClose,
  notifyCloseThenOpen,
  notifyTradeClosed,
  notifyTradeOpened,
  notifyTradeSkipped,
  reserveTradeNumber,
  type ClosedTrade,
  type OpenedTrade,
} from "./bot-notify";

/**
 * THE BOT LOOP — both behaviours, one engine.
 *
 * SCALPER — open on the last 8 completed M15 candles, close a winner at TP1 or
 *           at spread + 0.2 ATR of movement, then re-analyse and open again,
 *           non-stop. A stop-out waits for the next completed M15 candle.
 * NORMAL  — open on the same short-term direction and let the broker's
 *           SL/TP1/TP2 manage the trade. Re-analyses on each NEW completed M15
 *           candle; never force-closes a winner.
 *
 * THE VPS BRIDGE MAY NOT HAVE THE POSITION ENDPOINTS YET. `/positions/list`
 * and `/positions/close` are only needed to know what is open and to take a
 * profit. Their absence must NEVER stop the bot from analysing and opening:
 * the loop keeps a local record of what it opened, says
 * "Position monitoring unavailable — waiting for updated bridge" once, and
 * carries on. In normal mode nothing depends on those endpoints at all.
 *
 * Every step logs a `[bot]` line and announces on the execution bus, so the
 * bot can never sit in a silent running state.
 */

/** Every order this loop opens carries this magic number. */
export const SCALP_MAGIC = 26_102_401;

/**
 * Scalper close rule: close the instant the broker's own floating profit in
 * the account currency is positive. BUY profit is positive when price > entry;
 * SELL profit is positive when price < entry, so the sign is flipped.
 */
function isProfitablePosition(position: BridgePosition): boolean {
  if (position.profit == null) return false;
  if (position.type === "BUY") return position.profit > 0;
  return position.profit < 0;
}

const POLL_MS = 6_000;
const M15_MS = 15 * 60 * 1000;

export type ScalpSymbol = { symbol: string; lotSize: number; maxTrades: number };

export type BotMode = "scalper" | "normal";

export type ScalpLoopOptions = {
  symbols: ScalpSymbol[];
  eaName: string;
  credentials: BridgeCredentials;
  /** Which behaviour this run uses. Defaults to the scalper. */
  mode?: BotMode;
};

export type ScalpLoopHandle = {
  stop: () => void;
  isRunning: () => boolean;
};

type BridgePosition = {
  ticket: number;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  price_open: number;
  price_current: number;
  profit: number;
  magic: number;
};

type Track = {
  ticket: number;
  side: "BUY" | "SELL";
  entry: number;
  /** TP1 distance in price, measured at the signal that opened it. */
  tp1Distance: number;
  atr: number;
  /** The number the notification gave this trade when it opened. */
  tradeNo: number;
  /** The exact levels the broker was given — used to name a broker-side close. */
  sl: number;
  tp: number;
  /** True while a close or open request is awaiting a broker confirmation.
   *  Blocks further orders for this symbol until the broker reports the real
   *  position state. */
  pending?: boolean;
};

/** What one analyse-and-open pass did — the scalper combines it with a close. */
type OpenOutcome =
  | { kind: "opened"; opens: OpenedTrade[] }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string };

/** One line for the popup / bot log — never a claim the broker did not make. */
function announce(detail: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail }));
}

function log(message: string) {
  console.info(`[bot] ${message}`);
}

function broadcast(message: string, extra: Record<string, unknown> = {}) {
  log(message);
  announce({ ok: true, message, status: "info", ...extra });
}

function fail(message: string, extra: Record<string, unknown> = {}) {
  console.warn(`[bot] ${message}`);
  announce({ ok: false, message, status: "failed", ...extra });
}

async function bridgePost<T>(
  path: string,
  body: unknown,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  try {
    const reply = await fetch(`${getBridgeUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await reply.json().catch(() => null)) as T | null;
    if (!reply.ok) {
      const message =
        (payload as { message?: string; detail?: string } | null)?.message ??
        (payload as { detail?: string } | null)?.detail ??
        `The bridge answered HTTP ${reply.status}`;
      return { ok: false, data: payload, error: message };
    }
    return { ok: true, data: payload };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: bridgeUnreachableMessage(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function startScalpLoop(options: ScalpLoopOptions): ScalpLoopHandle {
  const { symbols, eaName, credentials } = options;
  const mode: BotMode = options.mode ?? "scalper";
  const tracks = new Map<string, Track>();
  const waitUntil = new Map<string, number>();
  /** The M15 bucket each symbol was last analysed in (normal mode gating). */
  const lastBucket = new Map<string, number>();
  const waitingNotice = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let monitoringNoticeShown = false;

  log(`starting ${mode.toUpperCase()} mode for ${symbols.map((entry) => entry.symbol).join(", ") || "no symbols"}`);

  /** The next completed M15 candle, plus a few seconds of settle time. */
  const nextM15Boundary = () => Math.ceil((Date.now() + 1) / M15_MS) * M15_MS + 5_000;

  /** Open positions carrying this loop's magic. `null` = endpoint unavailable. */
  const listPositions = async (): Promise<BridgePosition[] | null> => {
    const reply = await bridgePost<{ success?: boolean; positions?: BridgePosition[]; message?: string }>(
      "/positions/list",
      { credentials, magic: SCALP_MAGIC },
    );
    if (!reply.ok || reply.data?.success === false) {
      log(`/positions/list unavailable: ${reply.error ?? reply.data?.message ?? "unknown"}`);
      return null;
    }
    return Array.isArray(reply.data?.positions) ? reply.data!.positions! : [];
  };

  /**
   * CLOSE ONE POSITION — only ever one this loop opened (the list call filters
   * on `SCALP_MAGIC`, so manual trades and other EAs are never touched).
   *
   * Returns the BROKER'S OWN profit, or null when the close did not happen.
   * Nothing is notified here on purpose: in scalper mode this close and the
   * trade that follows it are sent as ONE alert, so the caller decides.
   */
  const closePosition = async (position: BridgePosition): Promise<number | null> => {
    const reply = await bridgePost<{ success?: boolean; profit?: number; message?: string }>(
      "/positions/close",
      { credentials, ticket: position.ticket },
    );

    if (!reply.ok || reply.data?.success !== true) {
      const detail = reply.error ?? reply.data?.message ?? "the broker refused the close";
      log(`close ${position.ticket} failed: ${detail}`);
      announce({
        ok: false,
        message: `Position monitoring unavailable — waiting for updated bridge (close #${position.ticket}: ${detail})`,
        status: "failed",
        symbol: position.symbol,
      });
      return null;
    }
    const profit = Number(reply.data?.profit ?? position.profit);
    const sign = profit >= 0 ? "+" : "−";
    broadcast(`closed ticket #${position.ticket} for ${sign}$${Math.abs(profit).toFixed(2)} profit`, {
      symbol: position.symbol,
      status: "closed",
      side: position.type,
      profit,
      entry: position.price_current,
    });
    // Speak the close through the trade voice. The announcer treats a
    // confirmed "closed" line as a real outcome, but does not stop the
    // run on it — the next close then open and every later fill is still
    // heard until the run-over summary or the final numbered trade.
    return Number.isFinite(profit) ? profit : null;
  };

  /**
   * Analyse + open immediately, exactly as the signal reads.
   *
   * `deferNotify` is for the scalper's close-then-open step: the fills are
   * numbered here but the phone is told about them together with the close
   * they followed. Every other caller gets one notification per confirmed fill.
   */
  const openFor = async (
    symbol: string,
    lotSize: number,
    maxTrades: number,
    options: { deferNotify?: boolean } = {},
  ): Promise<OpenOutcome> => {
    const notifyNow = options.deferNotify !== true;
    const opens: OpenedTrade[] = [];
    let skipReason: string | null = null;
    let failureReason: string | null = null;
    setExecutionStage(`Analysing ${symbol} candles…`);
    updateExecutionPlan({ symbol });
    log(`analysing ${symbol} (mode ${mode})`);

    let analysis;
    try {
      analysis = await resolveTradeDirection(symbol, { credentials });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`${symbol}: could not reach the bridge — ${reason}`, { symbol, status: "failed" });
      return { kind: "failed", reason };
    }

    log(
      `${symbol}: ${analysis.direction.type}${analysis.direction.type === "NO_TRADE" ? ` (${analysis.direction.reason})` : ""}`,
    );

    if (analysis.direction.type === "NO_TRADE") {
      const kind = classifyNoTrade(analysis.direction.reason);
      fail(`${symbol} NO TRADE (${kind}) — ${analysis.direction.reason}`, {
        symbol,
        status: "blocked",
        reason: analysis.direction.reason,
      });
      // THE EXACT BLOCK IS NAMED on the phone — once per symbol+reason, never
      // on every six-second pass.
      if (notifyNow) notifyTradeSkipped(symbol, analysis.direction.reason);
      return { kind: "skipped", reason: analysis.direction.reason };
    }

    const direction = analysis.direction;
    const tradeCount = Math.max(1, Math.floor(maxTrades));

    // The card shows the analysed plan before the broker confirms anything.
    updateExecutionPlan({
      symbol,
      direction: direction.type,
      entry: direction.entry,
      stopLoss: direction.sl,
      takeProfit: direction.tp,
      lotSize,
      totalTrades: tradeCount,
      mode,
    });
    setExecutionStage(`${direction.type} ${symbol} — sending ${tradeCount} order(s)…`);
    broadcast(`re-analysed: direction now ${direction.type}, opening ${direction.type} ${lotSize} × ${tradeCount}`, {
      symbol,
      side: direction.type,
      status: "reanalysed",
      entry: direction.entry,
      stopLoss: direction.sl,
      takeProfit: direction.tp,
      lotSize,
    });

    try {
      const executed = await executeAutoTrade({
        symbol,
        lotSize,
        maxTrades: tradeCount,
        eaName,
        credentials,
        magic: SCALP_MAGIC,
        onTradeExecute: (trade) => {
          if (trade.status === "executed") {
            // A NUMBER IS SPENT ONLY HERE — on a fill MT5 confirmed.
            const opened: OpenedTrade = {
              number: reserveTradeNumber(),
              side: trade.side,
              symbol,
              lotSize: trade.lotSize,
              price: trade.entry,
            };
            opens.push(opened);
            if (notifyNow) notifyTradeOpened(opened);              broadcast(
              `opened ${trade.side} ${trade.lotSize} at price ${trade.entry}, SL ${trade.sl}, TP1 ${trade.tp}`,
              {
                symbol,
                side: trade.side,
                entry: trade.entry,
                stopLoss: trade.sl,
                takeProfit: trade.tp,
                status: "executed",
                lotSize: trade.lotSize,
                ...(trade.meta?.mtOrderId ? { orderId: trade.meta.mtOrderId } : {}),
                summary: false,
              },
            );
            // Speak the confirmed fill through the trade voice. The announcer
            // reads the event's own status and skips chatter, repeats and run-over
            // summaries, so a confirmed fill is spoken once and the voice keeps
            // running for the next close then open and every later fill until the
            // run-over summary or the final numbered trade.
          } else if (trade.message) {
            fail(trade.message, { symbol, status: trade.status });
            if (trade.status === "blocked") {
              skipReason = trade.message;
              if (notifyNow) notifyTradeSkipped(symbol, trade.message);
            } else {
              failureReason = trade.message;
            }
          }
        },
      });

      const firstTicket = Number(
        executed.find((trade) => trade.status === "executed" && trade.meta?.mtOrderId)?.meta?.mtOrderId ?? NaN,
      );
      const tp1 = direction.tp1 ?? direction.tp;
      const atr = analysis.gate?.atr ?? Math.abs(direction.entry - direction.sl) * 0.5;
      const filled = executed.some((trade) => trade.status === "executed");
      if (filled) {
        // The number the FIRST fill was given is the one the close reports.
        tracks.set(symbol, {
          ticket: Number.isFinite(firstTicket) ? firstTicket : -1,
          side: direction.type,
          entry: direction.entry,
          tp1Distance: Math.abs(tp1 - direction.entry),
          atr,
          tradeNo: opens[0]?.number ?? 0,
          sl: direction.sl,
          tp: tp1,
        });
      }
      setExecutionStage(
        filled ? `${symbol} ${direction.type} confirmed by MT5` : `${symbol} ${direction.type} was not opened — see the log`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`${symbol}: order failed — ${reason}`, {
        symbol,
        status: "failed",
      });
      return { kind: "failed", reason };
    }

    if (opens.length > 0) return { kind: "opened", opens };
    if (skipReason) return { kind: "skipped", reason: skipReason };
    return { kind: "failed", reason: failureReason ?? "MT5 did not confirm any order" };
  };

  const tick = async () => {
    if (stopped) return;
    const positions = await listPositions();
    const monitoring = positions !== null;

    if (!monitoring && !monitoringNoticeShown) {
      monitoringNoticeShown = true;
      announce({
        ok: true,
        message: "Position monitoring unavailable — waiting for updated bridge",
        status: "info",
      });
    }
    if (monitoring && monitoringNoticeShown) {
      monitoringNoticeShown = false;
      broadcast("Position monitoring restored — the bridge now reports open positions");
    }

    for (const entry of symbols) {
      if (stopped) return;
      const symbol = entry.symbol.trim();
      if (!symbol) continue;
      const lotSize = Number(entry.lotSize) || 0.01;
      const cap = Math.max(1, Math.floor(entry.maxTrades));
      const track = tracks.get(symbol);

      const bridgePositions = positions
        ? positions.filter((position) => position.symbol.toUpperCase() === symbol.toUpperCase())
        : [];
      const knowsOpen = monitoring ? bridgePositions.length > 0 : Boolean(track);

      // ── NORMAL MODE — nothing to do while a position is open. SL/TP1/TP2
      // are the broker's job, and a winner is never pulled early.
      if (mode === "normal" && knowsOpen) continue;        // ── SCALPER MODE, position open: take the profit or leave it be.
      if (mode === "scalper" && knowsOpen) {
        if (!monitoring) {
          // Nothing can be closed without the endpoint, and nothing must be
          // stacked either — the position stays and the loop waits.
          continue;
        }
        const scalperPosition = bridgePositions[0]!;

        // ── PENDING / DUPLICATE GUARD ────────────────────────────────────────────
        // Track a merge of "this trade is waiting for a broker confirmation" and
        // "an open or close request is already in flight". A pending trade blocks
        // every further order for that symbol until the broker answers, so one
        // close or one open can never spawn several repeated orders.
        if (track?.pending) {
          // A close or open request is still awaiting the broker. Do not submit
          // another one inside this cycle or any later cycle of the same pass,
          // and re-check the live position as soon as the broker answers.
          continue;
        }

        // ── STOPPED SESSION → NO REPLACEMENT ────────────────────────────────────
        // A stop is only honoured when it has been requested; a close that has
        // already returned does not restart a loop that has been told to stop.
        if (stopped) {
          log(`${symbol}: session stopped — no replacement trade opened`);
          continue;
        }

        // Scalper rule (this session): the position only needs closing once it
        // earns more than zero in the broker's own profit field. The close is
        // broker-confirmed before any notification is sent, and after a confirmed
        // close the same pass re-opens the next trade in the fresh direction with
        // no button press needed.
        if (!isProfitablePosition(scalperPosition)) {
          continue;
        }

        if (track) {
          tracks.set(symbol, { ...track, pending: true });
        }
        const closedTrack = tracks.get(symbol);
        const profit = await closePosition(scalperPosition);
        if (profit !== null) {
          const closeInfo: ClosedTrade = { number: closedTrack?.tradeNo ?? 0, profit };
          tracks.delete(symbol);
          // A confirmed broker-side close is announced exactly once as a real
          // closed line. It does not stop the scalper run: the voice keeps
          // speaking for every later close then open and every later fill until
          // the run-over summary or the final numbered trade.
          if (stopped) {
            notifyTradeClosed(closeInfo);
            continue;
          }
          // ── SCALPER CONTINUOUS CYCLE ──
          // After a confirmed close the SAME pass re-analyses and re-opens the
          // same symbol, so the trader never has to press Start again.
          // `pending` is cleared below: if the replacement is skipped or failed,
          // the session stays active and the next scheduled cycle re-tries
          // evaluation safely — it never submits a duplicate.
          const outcome = await openFor(symbol, lotSize, cap, { deferNotify: true });
          if (track) tracks.set(symbol, { ...track, pending: false });
          if (outcome.kind === "opened" && outcome.opens.length > 0) {
            notifyCloseThenOpen(closeInfo, outcome.opens);
          } else {
            notifyTradeClosed(closeInfo);
            if (outcome.kind === "skipped") notifyTradeSkipped(symbol, outcome.reason);
          }
        } else {
          // The broker did not confirm the close. Re-clear the in-flight guard
          // so the symbol is not left permanently pending and the next tick can
          // try the position again.
          if (track) tracks.set(symbol, { ...track, pending: false });
        }
        continue;
      }

      // ── Flat: the position vanished without this loop closing it → stop loss.
      if (track && monitoring) {
        tracks.delete(symbol);
        waitUntil.set(symbol, nextM15Boundary());
        broadcast(
          `ticket #${track.ticket} closed by the broker (stop loss or take profit) — waiting for the next completed M15 candle before a new ${symbol} trade`,
          { symbol, ok: false, status: "stopped-out" },
        );
        // WHICH LEVEL CLOSED IT — read from the live price, and only named when
        // the price actually proves one. No profit figure is invented: the
        // broker does not report a result for a close this bot did not place.
        const lastQuote = await bridgePost<{ success?: boolean; bid?: number; ask?: number }>("/symbol/price", {
          credentials,
          symbol,
        });
        const lastPrice = Number(track.side === "BUY" ? lastQuote.data?.bid : lastQuote.data?.ask);
        notifyBrokerClose({
          number: track.tradeNo,
          side: track.side,
          stopLoss: track.sl,
          takeProfit: track.tp,
          price: Number.isFinite(lastPrice) ? lastPrice : null,
        });
        continue;
      }

      // NORMAL MODE re-analyses once per NEW completed M15 candle — never on
      // every poll, and never mid-candle.
      const bucket = Math.floor(Date.now() / M15_MS);
      if (mode === "normal" && lastBucket.get(symbol) === bucket) continue;
      lastBucket.set(symbol, bucket);

      const holdUntil = waitUntil.get(symbol) ?? 0;
      if (Date.now() < holdUntil) {
        if (!waitingNotice.has(symbol)) {
          waitingNotice.add(symbol);
          broadcast(`${symbol} waiting for the next completed M15 candle after a stop loss`, {
            symbol,
            status: "waiting",
          });
        }
        continue;
      }
      waitingNotice.delete(symbol);
      waitUntil.delete(symbol);

      await openFor(symbol, lotSize, cap);
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runTick();
    }, POLL_MS);
  };

  /** One guarded pass — a thrown step must never kill the loop silently. */
  const runTick = async () => {
    if (stopped) return;
    try {
      await tick();
    } catch (error) {
      fail(`loop error — ${error instanceof Error ? error.message : String(error)}`, { status: "failed" });
    }
    schedule();
  };

  void runTick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      log("stopped");
    },
    isRunning: () => !stopped,
  };
}
