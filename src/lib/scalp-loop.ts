import {
  classifyNoTrade,
  executeAutoTrade,
  resolveTradeDirection,
  type BridgeCredentials,
} from "./auto-trade";
import { BRIDGE_KEY, bridgeUnreachableMessage, getBridgeUrl } from "./bridge-client";

/**
 * SCALPING LOOP — trade, take the profit, re-analyse, open again.
 *
 * On start, every Allowed Quote is analysed from the last 8 completed M15
 * candles and traded immediately in that short-term direction. While the loop
 * runs it watches ONLY the positions it opened (its own magic number):
 *
 *   • a position in profit by TP1, or by at least the spread cost plus 0.2 ATR
 *     of movement, is closed — then the symbol is analysed again and the next
 *     trade opens in the NEW direction;
 *   • a position that disappears without this loop closing it (stop loss or
 *     broker TP) sends that symbol to the next completed M15 candle before a
 *     new order, so a loss is never stacked into a revenge trade.
 *
 * Hard blocks only — stale candles, a missing live price, invalid SL/TP, the
 * 20% free-margin buffer and the per-symbol cap — and each one is named in the
 * popup. Nothing is ever reported as executed, closed or profitable before the
 * broker itself confirms it.
 */

/** Every order this loop opens carries this magic number. */
export const SCALP_MAGIC = 26_102_401;

const POLL_MS = 6_000;
const M15_MS = 15 * 60 * 1000;

export type ScalpSymbol = { symbol: string; lotSize: number; maxTrades: number };

/**
 * SCALPER — open, take the profit, re-open, non-stop.
 * NORMAL   — open on the same short-term direction and let SL/TP1/TP2 manage
 *            it; it re-analyses on each NEW completed M15 candle, but it never
 *            force-closes a winner early.
 */
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

function broadcast(message: string, extra: Record<string, unknown> = {}) {
  console.log(`[scalp] ${message}`);
  announce({ ok: true, message, status: "scalp", ...extra });
}

async function bridgePost<T>(path: string, body: unknown): Promise<{ ok: boolean; data: T | null; error?: string }> {
  try {
    const reply = await fetch(`${getBridgeUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
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

  /** The next completed M15 candle, plus a few seconds of settle time. */
  const nextM15Boundary = () => Math.ceil((Date.now() + 1) / M15_MS) * M15_MS + 5_000;

  const listPositions = async (): Promise<BridgePosition[] | null> => {
    const reply = await bridgePost<{ success?: boolean; positions?: BridgePosition[]; message?: string }>(
      "/positions/list",
      { credentials, magic: SCALP_MAGIC },
    );
    if (!reply.ok || reply.data?.success === false) {
      return null;
    }
    return Array.isArray(reply.data?.positions) ? reply.data!.positions! : [];
  };

  const closePosition = async (position: BridgePosition): Promise<boolean> => {
    const reply = await bridgePost<{
      success?: boolean;
      price?: number;
      profit?: number;
      message?: string;
    }>("/positions/close", { credentials, ticket: position.ticket });

    if (!reply.ok || reply.data?.success !== true) {
      broadcast(
        `Could not close ticket #${position.ticket} — ${reply.error ?? reply.data?.message ?? "the broker refused the close"}`,
        { symbol: position.symbol, ok: false, status: "failed" },
      );
      return false;
    }
    const profit = Number(reply.data?.profit ?? position.profit);
    const sign = profit >= 0 ? "+" : "−";
    broadcast(
      `closed ticket #${position.ticket} for ${sign}$${Math.abs(profit).toFixed(2)} profit`,
      { symbol: position.symbol, ok: true, status: "closed", profit },
    );
    return true;
  };

  /** Analyse + open immediately, exactly as the signal reads. */
  const openFor = async (symbol: string, lotSize: number, maxTrades: number) => {
    const analysis = await resolveTradeDirection(symbol, { credentials });
    if (analysis.direction.type === "NO_TRADE") {
      const kind = classifyNoTrade(analysis.direction.reason);
      broadcast(`${symbol} NO TRADE (${kind}) — ${analysis.direction.reason}`, {
        symbol,
        ok: false,
        status: "blocked",
      });
      return;
    }
    const direction = analysis.direction;
    const tradeCount = Math.max(1, Math.floor(maxTrades));
    broadcast(`re-analysed: direction now ${direction.type}, opening ${direction.type} ${lotSize} × ${tradeCount}`, {
      symbol,
      side: direction.type,
      status: "reanalysed",
    });

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
          broadcast(trade.message, { symbol, ok: false, status: trade.status });
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
    }
  };

  const tick = async () => {
    if (stopped) return;
    const positions = await listPositions();
    if (positions === null) {
      broadcast(
        "Position monitoring unavailable — the VPS bridge did not answer /positions/list. Update bridge.py on the VPS to keep scalping.",
        { ok: false, status: "blocked" },
      );
      schedule();
      return;
    }

    for (const entry of symbols) {
      if (stopped) return;
      const symbol = entry.symbol.trim();
      if (!symbol) continue;
      const lotSize = Number(entry.lotSize) || 0.01;
      const forSymbol = positions.filter((position) => position.symbol.toUpperCase() === symbol.toUpperCase());
      const cap = Math.max(1, Math.floor(entry.maxTrades));

      // ── NORMAL MODE — nothing to do while a position is open. SL/TP1/TP2
      // are the broker's job, and a winner is never pulled early.
      if (mode === "normal" && forSymbol.length > 0) continue;

      // ── An open position this loop owns: take the profit or leave it be.
      if (forSymbol.length > 0) {
        const position = forSymbol[0]!;
        const track = tracks.get(symbol);
        const quote = await bridgePost<{ success?: boolean; bid?: number; ask?: number }>("/symbol/price", {
          credentials,
          symbol,
        });
        const bid = Number(quote.data?.bid);
        const ask = Number(quote.data?.ask);
        const spread = Number.isFinite(bid) && Number.isFinite(ask) && ask > bid ? ask - bid : 0;
        const atr = track?.atr ?? 0;
        const moveInFavour =
          position.type === "BUY" ? position.price_current - position.price_open : position.price_open - position.price_current;
        const scalpTarget = spread + atr * 0.2;
        const tp1Reached = track ? moveInFavour >= track.tp1Distance : false;
        if ((tp1Reached || (atr > 0 && moveInFavour >= scalpTarget)) && moveInFavour > 0) {
          const closed = await closePosition(position);
          tracks.delete(symbol);
          if (closed && !stopped) {
            await openFor(symbol, lotSize, cap);
          }
        }
        // Otherwise hold: TP2 stays as the broker's own take-profit, and a
        // winner is never held waiting for it.
        continue;
      }

      // ── The position vanished without this loop closing it → stop loss.
      const lost = tracks.get(symbol);
      if (lost) {
        tracks.delete(symbol);
        waitUntil.set(symbol, nextM15Boundary());
        broadcast(
          `ticket #${lost.ticket} closed by the broker (stop loss or take profit) — waiting for the next completed M15 candle before a new ${symbol} trade`,
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

      if (forSymbol.length >= cap) continue;
      await openFor(symbol, lotSize, cap);
    }

    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, POLL_MS);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    isRunning: () => !stopped,
  };
}
