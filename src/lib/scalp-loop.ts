import {
  classifyNoTrade,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "./auto-trade";
import { BRIDGE_KEY, bridgeUnreachableMessage, getBridgeUrl } from "./bridge-client";
import { setExecutionStage, updateExecutionPlan } from "./execution-state";

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
};

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

  const closePosition = async (position: BridgePosition): Promise<boolean> => {
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
      return false;
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
    return true;
  };

  /** Analyse + open immediately, exactly as the signal reads. */
  const openFor = async (symbol: string, lotSize: number, maxTrades: number) => {
    setExecutionStage(`Analysing ${symbol} candles…`);
    updateExecutionPlan({ symbol });
    log(`analysing ${symbol} (mode ${mode})`);

    let analysis;
    try {
      analysis = await resolveTradeDirection(symbol, { credentials });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`${symbol}: could not reach the bridge — ${reason}`, { symbol, status: "failed" });
      return;
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
      return;
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
            broadcast(
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
              },
            );
          } else if (trade.message) {
            fail(trade.message, { symbol, status: trade.status });
          }
        },
      });

      const firstTicket = Number(
        executed.find((trade) => trade.status === "executed" && trade.meta?.mtOrderId)?.meta?.mtOrderId ?? NaN,
      );
      const tp1 = direction.tp1 ?? direction.tp;
      const atr = analysis.gate?.atr ?? Math.abs(direction.entry - direction.sl) * 0.5;
      if (Number.isFinite(firstTicket)) {
        tracks.set(symbol, {
          ticket: firstTicket,
          side: direction.type,
          entry: direction.entry,
          tp1Distance: Math.abs(tp1 - direction.entry),
          atr,
        });
      } else if (executed.some((trade) => trade.status === "executed")) {
        // The broker confirmed a fill but the bridge did not echo a ticket.
        // Remember the position by symbol so the loop never stacks orders.
        tracks.set(symbol, {
          ticket: -1,
          side: direction.type,
          entry: direction.entry,
          tp1Distance: Math.abs(tp1 - direction.entry),
          atr,
        });
      }
      setExecutionStage(
        executed.some((trade) => trade.status === "executed")
          ? `${symbol} ${direction.type} confirmed by MT5`
          : `${symbol} ${direction.type} was not opened — see the log`,
      );
    } catch (error) {
      fail(`${symbol}: order failed — ${error instanceof Error ? error.message : String(error)}`, {
        symbol,
        status: "failed",
      });
    }
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
      if (mode === "normal" && knowsOpen) continue;

      // ── SCALPER MODE, position open: take the profit or leave it be.
      if (mode === "scalper" && knowsOpen) {
        if (!monitoring) {
          // Nothing can be closed without the endpoint, and nothing must be
          // stacked either — the position stays and the loop waits.
          continue;
        }
        const position = bridgePositions[0]!;
        const quote = await bridgePost<{ success?: boolean; bid?: number; ask?: number }>("/symbol/price", {
          credentials,
          symbol,
        });
        const bid = Number(quote.data?.bid);
        const ask = Number(quote.data?.ask);
        const spread = Number.isFinite(bid) && Number.isFinite(ask) && ask > bid ? ask - bid : 0;
        const atr = track?.atr ?? 0;
        const moveInFavour =
          position.type === "BUY"
            ? position.price_current - position.price_open
            : position.price_open - position.price_current;
        const scalpTarget = spread + atr * 0.2;
        const tp1Reached = track ? moveInFavour >= track.tp1Distance : false;
        if ((tp1Reached || (atr > 0 && moveInFavour >= scalpTarget)) && moveInFavour > 0) {
          const closed = await closePosition(position);
          if (closed) {
            tracks.delete(symbol);
            if (!stopped) await openFor(symbol, lotSize, cap);
          }
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
