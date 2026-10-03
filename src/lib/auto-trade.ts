/**
 * Auto-trading engine — shared by the Quotes "Configure" button and the Home
 * START button so both open real positions through the VPS bridge instead of
 * only looking like they do.
 *
 * WHY THIS EXISTS
 * The scanner route (app.scanner.tsx) already grew a correct bridge-execution
 * path: live quote → broker-valid SL/TP → sequential orders with symbol,
 * comment and stop-level fallbacks. Home used to call `executeMt5ForUser`, a
 * TanStack SERVER function — and because the app ships as a STATIC site on
 * Vercel, that function 404s there, so pressing START silently placed nothing.
 * Both entry points now run through this module, which speaks to the bridge
 * directly from the browser (it allows CORS from the app's origins).
 *
 * SAFETY RULES baked in here, because this places REAL money:
 *  • Orders are SEQUENTIAL. Never parallel — brokers rate-limit bursts.
 *  • SL/TP are always re-anchored to the LIVE quote and pushed outside the
 *    broker's minimum stop distance, so a plan computed on a feed price (or a
 *    synthetic proxy price) cannot be refused with 10016.
 *  • If the broker refuses the stops, the order is retried once WITHOUT them:
 *    a filled market order beats a refused one. The UI is told the position
 *    opened without stops.
 *  • A "unlimited" (0) trade count is clamped — one start must not open an
 *    unbounded number of live positions.
 */

import { analyzeMarket } from "./market-scanner-core";
import { BRIDGE_KEY, BRIDGE_URL, bridgeSymbolCandidates } from "./bridge-client";
import { friendlyRetcode, friendlyTradeError } from "./trade-errors";
import { recordTrade } from "./trade-history";

/** Highest number of orders a single tap may open on one symbol. */
const MAX_ORDERS_PER_SYMBOL = 20;
/** Fallback risk when the scanner produced no usable levels: 0.5% stop. */
const DEFAULT_RISK_PCT = 0.005;
/** 1:2.5 reward-to-risk, matching the scanner's stated plan. */
const REWARD_RATIO = 2.5;
/** Hard cap on the market read. Past this we trade the fallback, not stall. */
const ANALYSIS_TIMEOUT_MS = 3500;
/** Hard cap on the bridge's live-quote lookup. */
const QUOTE_TIMEOUT_MS = 4000;

export type PairDirection = "BOTH" | "BUY" | "SELL";
export type ResolvedDirection = "BUY" | "SELL";

export type DirectionResolution = {
  direction: ResolvedDirection;
  /** Whether the call came from the user's pick, the market, or the default. */
  source: "selection" | "analysis" | "default";
  reason: string;
};

export type AutoTradeResult = {
  ok: boolean;
  symbol: string;
  direction: ResolvedDirection;
  opened: number;
  total: number;
  message: string;
};

/** Just enough of the saved MT5 account to sign a bridge request. */
export type MtCredentialsInput = {
  loginId: string;
  server: string;
} | null | undefined;

/**
 * The login id lives in app state, but the MT5 PASSWORD never leaves the
 * device — it is written to localStorage when the user saves their details on
 * the MetaTrader page. Returns null when either half is missing so callers can
 * tell "not configured" apart from "configured but rejected".
 */
export function readMtCredentials(mt: MtCredentialsInput): {
  login: number | string;
  password: string;
  server: string;
} | null {
  if (!mt || !mt.loginId || !mt.server) return null;
  const password = window.localStorage.getItem("mt_password") ?? "";
  if (!password) return null;
  const loginNumber = Number(mt.loginId);
  return {
    // Keep the raw string when it is not a usable number — some brokers use
    // non-numeric logins and the bridge passes it straight to MT5.
    login: Number.isFinite(loginNumber) && loginNumber > 0 ? loginNumber : mt.loginId,
    password,
    server: mt.server,
  };
}

function announce(ok: boolean, message: string): void {
  window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok, message } }));
}

/** Clamp a saved trade count. "unlimited" (0/unparseable) becomes a single order. */
export function safeTradeCount(raw: string | number | undefined): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(parsed, MAX_ORDERS_PER_SYMBOL);
}

/**
 * Decide which way to trade a symbol.
 *
 * A specific BUY/SELL in the Quotes modal is a deliberate instruction and is
 * always honoured. BOTH means "you decide", so the scanner is asked for a real
 * read on momentum/EMA/RSI. If the scanner cannot answer — no feed, no
 * candles, a throw — we do NOT guess: the configured default is used and the
 * reason is reported so the UI can say the call was a fallback, not a signal.
 */
export async function resolveTradeDirection(
  symbol: string,
  preferred: PairDirection | undefined,
  timeframe = "1h",
): Promise<DirectionResolution> {
  const chosen = (preferred ?? "BOTH").toUpperCase();
  if (chosen === "BUY" || chosen === "SELL") {
    return { direction: chosen, source: "selection", reason: `${chosen} was selected for this symbol` };
  }

  let analysis: Awaited<ReturnType<typeof analyzeMarket>> | null = null;
  let timedOut = false;
  try {
    // The public chart feeds behind analyzeMarket are the slowest link in the
    // whole run, and most of them simply never answer for an exotic or
    // weekend-quiet symbol — an unbounded await there is exactly why pressing
    // Configure looked like it had done nothing. Cap the wait and fall back.
    analysis = await Promise.race([
      analyzeMarket({ symbol, timeframe }),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, ANALYSIS_TIMEOUT_MS);
        // Never hold the process open for the timer.
        if (typeof (timer as { unref?: () => void }).unref === "function") {
          (timer as unknown as { unref: () => void }).unref();
        }
      }),
    ]);
  } catch {
    analysis = null;
  }

  if (analysis && analysis.ok) {
    const { signal, strength, rsi } = analysis.analysis;
    if (signal === "BUY" || signal === "SELL") {
      return {
        direction: signal,
        source: "analysis",
        reason: `Market read on ${timeframe}: ${signal} (${strength}, RSI ${Math.round(rsi)})`,
      };
    }
  }

  // BOTH with no usable read — fall back, but say so.
  return {
    direction: "BUY",
    source: "default",
    reason: timedOut
      ? `Market data for ${symbol} did not respond in ${ANALYSIS_TIMEOUT_MS / 1000}s — traded BUY by default`
      : analysis && !analysis.ok
        ? `No market data for ${symbol} — traded BUY by default`
        : `Weak or unreadable ${timeframe} data for ${symbol} — traded BUY by default`,
  };
}

/** Live quote + broker stop rules, used to place levels the broker accepts. */
type LiveQuote = {
  bid: number;
  ask: number;
  digits: number;
  point: number;
  minDistance: number;
};

/** Why a live quote could not be used — the two cases read very differently. */
type QuoteFailure = "unavailable" | "unreachable";

type QuoteResult = { quote: LiveQuote } | { failure: QuoteFailure; detail?: string };

async function fetchLiveQuote(
  credentials: { login: number | string; password: string; server: string },
  symbol: string,
): Promise<QuoteResult> {
  // The bridge opens a fresh MetaTrader session per call. On a closed market
  // or an unknown symbol that session can sit there far longer than anyone
  // should wait, so the request is capped rather than awaited forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE_URL}/symbol/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify({ credentials, symbol }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const bid = typeof payload["bid"] === "number" ? payload["bid"] : 0;
    const ask = typeof payload["ask"] === "number" ? payload["ask"] : 0;
    const digits = typeof payload["digits"] === "number" ? payload["digits"] : null;
    if (payload["success"] !== true || bid <= 0 || ask <= 0 || digits === null) {
      const detail =
        (typeof payload["message"] === "string" && payload["message"]) ||
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        undefined;
      return detail ? { failure: "unavailable", detail } : { failure: "unavailable" };
    }
    const point =
      typeof payload["point"] === "number" && payload["point"] > 0 ? payload["point"] : 10 ** -digits;
    const stopsLevelPoints = typeof payload["stops_level"] === "number" ? payload["stops_level"] : 0;
    // A broker can report stops_level 0 and still refuse levels inside the
    // spread, so keep a real buffer on top of the reported minimum.
    const minDistance = Math.max(stopsLevelPoints * point * 1.2, Math.abs(ask - bid) * 3, point * 25);
    return { quote: { bid, ask, digits, point, minDistance } };
  } catch (error) {
    // An abort here is our own 4s cap firing, not the broker refusing.
    const aborted = error instanceof Error && error.name === "AbortError";
    return aborted
      ? { failure: "unreachable", detail: `The bridge did not answer within ${QUOTE_TIMEOUT_MS / 1000}s` }
      : { failure: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export type AutoTradeOptions = {
  credentials: { login: number | string; password: string; server: string };
  symbol: string;
  direction: ResolvedDirection;
  lot: number;
  trades: number;
  botName?: string;
  robotImage?: string;
  /** Scan-strength grade, recorded against the trade when known. */
  strength?: "WAIT" | "WEAK" | "MODERATE" | "STRONG";
  /** Plan levels from the scanner, used only for their RISK PERCENTAGES. */
  planEntry?: number;
  planStopLoss?: number;
  planTakeProfit?: number;
  onProgress?: (message: string) => void;
};

/**
 * Open real positions for one configured symbol. Announces every step on the
 * `eamp:execution-result` bus, which the floating bot popup, the top toast and
 * the Android bubble all render, so the user watches the run happen.
 */
export async function executeAutoTrade(options: AutoTradeOptions): Promise<AutoTradeResult> {
  const {
    credentials,
    botName,
    robotImage,
    direction,
    onProgress,
    planEntry,
    planStopLoss,
    planTakeProfit,
    strength,
  } = options;

  let symbol = options.symbol.trim();
  const lot = Number(options.lot);
  const total = safeTradeCount(options.trades);

  const fail = (message: string): AutoTradeResult => {
    onProgress?.("Connection closed.");
    announce(false, `${message.toUpperCase()} — CONNECTION CLOSED`);
    // EVERY exit records the outcome and closes the run on the bus. Without
    // this the popup sat on its last progress line — usually "CONNECTING…" —
    // because the path that bailed out never said anything.
    recordTrade({
      symbol,
      direction,
      lot: String(lot),
      trades: total,
      filled: `0/${total}`,
      ok: false,
      ...(strength ? { strength } : {}),
      detail: message,
    });
    return { ok: false, symbol, direction, opened: 0, total, message };
  };

  if (!symbol) return fail("No symbol was configured for this robot");
  if (!Number.isFinite(lot) || lot <= 0) return fail(`Lot size for ${symbol} is not a valid volume`);
  if (!credentials.password) return fail("MT5 password is not saved on this device");

  onProgress?.("Connecting to broker...");
  announce(false, "CONNECTING...");

  // Live quote first — every level below is anchored to it.
  const quoteResult = await fetchLiveQuote(credentials, symbol);
  onProgress?.("Reading live price...");

  // No live quote means there is no safe way to place a stop: the market is
  // shut, or this broker does not list the symbol. This used to fall through
  // to a bare market order with NO protection at all, which is the worst
  // outcome a live-money button can produce. Refuse, and say exactly why.
  if ("failure" in quoteResult) {
    const detail = quoteResult.detail ? ` (${quoteResult.detail})` : "";
    return quoteResult.failure === "unavailable"
      ? fail(`Cannot execute ${symbol}: Market is closed or symbol is inactive on your broker${detail}`)
      : fail(`Cannot execute ${symbol}: Could not reach your trading bridge${detail}`);
  }

  const quote = quoteResult.quote;
  const entry = direction === "BUY" ? quote.ask : quote.bid;
  const liveEntry = entry > 0 ? entry : (planEntry ?? 0);

  // Percentages survive a price-scale mismatch (a synthetic proxy's price is
  // not the broker's), which is why they — not the raw levels — are kept.
  const riskPct =
    planEntry && planStopLoss && planEntry > 0 ? Math.abs(planEntry - planStopLoss) / planEntry : DEFAULT_RISK_PCT;
  const rewardPct =
    planEntry && planTakeProfit && planEntry > 0
      ? Math.abs(planTakeProfit - planEntry) / planEntry
      : riskPct * REWARD_RATIO;

  let stopLoss = 0;
  let takeProfit = 0;
  if (liveEntry > 0) {
    const { digits, minDistance } = quote;
    const round = (value: number) => Number(value.toFixed(digits));
    const rawStop = direction === "BUY" ? liveEntry * (1 - riskPct) : liveEntry * (1 + riskPct);
    const rawTarget = direction === "BUY" ? liveEntry * (1 + rewardPct) : liveEntry * (1 - rewardPct);
    // Clamp BOTH stops to sit beyond the broker's minimum distance.
    stopLoss = round(
      direction === "BUY"
        ? Math.min(rawStop, liveEntry - minDistance)
        : Math.max(rawStop, liveEntry + minDistance),
    );
    takeProfit = round(
      direction === "BUY"
        ? Math.max(rawTarget, liveEntry + minDistance)
        : Math.min(rawTarget, liveEntry - minDistance),
    );
  }

  // Open the floating popup immediately so the user sees the run start.
  window.triggerExecutionToast?.(botName, robotImage, {
    symbol,
    lot_size: lot,
    max_trades: total,
    direction,
    ...(stopLoss ? { stopLoss } : {}),
    ...(takeProfit ? { takeProfit } : {}),
  });

  announce(false, "EXECUTING...");
  onProgress?.("Executing...");

  // MT5 comments allow only letters+digits, but the EA name may contain
  // spaces and the user wants a readable label — so we strip only the
  // characters MT5 forbids (spaces, symbols) and stamp "~eamigrate" so the
  // broker sees the real bot name, e.g. "sniper killer ea v2.0~eamigrate".
  let activeComment = (botName ?? "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim();
  activeComment = activeComment.length > 0 ? activeComment : "Eamigrate";
  // MT5 caps comments at ~31 chars; keep spaces but shorten if too long.
  activeComment = activeComment.slice(0, 31 - "~eamigrate".length) + "~eamigrate";

  const executeOnce = async (target: string): Promise<Record<string, unknown>> => {
    const response = await fetch(`${BRIDGE_URL}/trade/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      body: JSON.stringify({
        credentials,
        symbol: target,
        action: direction,
        volume: lot,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        comment: activeComment,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail =
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        (typeof payload["message"] === "string" && payload["message"]) ||
        `The bridge rejected the order (HTTP ${response.status}).`;
      const error = new Error(friendlyTradeError(detail)) as Error & { raw?: string };
      error.raw = detail;
      throw error;
    }
    // HTTP 200 is not a fill — the broker's retcode is the source of truth.
    // Only 10008/10009/10010 mean the order actually opened.
    const result = (payload["result"] ?? {}) as Record<string, unknown>;
    const rawRetcode = payload["retcode"] ?? result["retcode"];
    const retcode =
      typeof rawRetcode === "number"
        ? rawRetcode
        : typeof rawRetcode === "string" && /^\d+$/.test(rawRetcode)
          ? Number(rawRetcode)
          : null;
    if (retcode !== null) {
      if (retcode === 10008 || retcode === 10009 || retcode === 10010) return payload;
      const message = friendlyRetcode(retcode) ?? `The broker refused the order (MT5 code ${retcode}).`;
      const brokerComment =
        (typeof payload["comment"] === "string" && payload["comment"]) ||
        (typeof result["comment"] === "string" && result["comment"]) ||
        "";
      const refusal = new Error(
        brokerComment && !message.includes(brokerComment) ? `${message} (Broker: ${brokerComment})` : message,
      ) as Error & { raw?: string };
      refusal.raw = message;
      throw refusal;
    }
    if (payload["success"] === false) {
      const rawDetail =
        (typeof payload["message"] === "string" && payload["message"]) ||
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        "The broker refused the order.";
      const refusal = new Error(friendlyTradeError(rawDetail)) as Error & { raw?: string };
      refusal.raw = rawDetail;
      throw refusal;
    }
    return payload;
  };

  // Brokers brand the same market differently (BTCUSDm, XAUUSDM, US30Cash…);
  // on a symbol refusal, retry once through the candidate list.
  let symbolRetried = false;
  const isSymbolMismatch = (text: string) =>
    /symbol/i.test(text) &&
    /not found|unknown|invalid|no such|not available|not listed|renamed|rejected that symbol|isn't available|couldn't match/i.test(
      text,
    );

  const executeWithSymbolFallback = async (): Promise<Record<string, unknown>> => {
    try {
      return await executeOnce(symbol);
    } catch (error) {
      const raw =
        ((error as Error & { raw?: string }).raw ?? (error instanceof Error ? error.message : "")) as string;
      if (symbolRetried || !(error instanceof Error) || !isSymbolMismatch(raw)) throw error;
      symbolRetried = true;
      let lastError: unknown = error;
      for (const candidate of bridgeSymbolCandidates(symbol)) {
        if (candidate.toUpperCase() === symbol.trim().toUpperCase()) continue;
        try {
          const payload = await executeOnce(candidate);
          symbol = candidate; // the working name drives the rest of the run
          return payload;
        } catch (candidateError) {
          lastError = candidateError;
        }
      }
      throw lastError;
    }
  };

  let opened = 0;
  let firstPayload: Record<string, unknown> | null = null;
  let useStops = stopLoss > 0 || takeProfit > 0;
  let stopRetried = false;
  let commentRetried = false;
  let lastError: string | null = null;

  for (let index = 1; index <= total; index += 1) {
    try {
      const payload = await executeWithSymbolFallback();
      opened += 1;
      if (index === 1) firstPayload = payload;
      announce(true, `TRADE ${opened} EXECUTED — EA MIGRATE ✓`);
      if (index < total) await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      // Unsafe characters in the bot name → one retry with the safe stamp.
      if (!commentRetried && /comment/i.test(raw)) {
        commentRetried = true;
        activeComment = "Eamigrate";
        try {
          const payload = await executeWithSymbolFallback();
          opened += 1;
          if (index === 1) firstPayload = payload;
          announce(true, `TRADE ${opened} EXECUTED — EA MIGRATE ✓`);
          if (index < total) await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        } catch {
          /* fall through to normal handling */
        }
      }
      // Refused stops (10016) → one retry at market WITHOUT them. The fill is
      // real, so the trade goes through and the UI is told stops are missing.
      if (useStops && !stopRetried && /invalid stops|10016/i.test(raw)) {
        stopRetried = true;
        useStops = false;
        stopLoss = 0;
        takeProfit = 0;
        try {
          const payload = await executeWithSymbolFallback();
          opened += 1;
          if (index === 1) firstPayload = payload;
          announce(true, `TRADE ${opened} EXECUTED — EA MIGRATE ✓`);
          if (index < total) await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        } catch {
          /* the abort below reports it */
        }
      }
      if (opened === 0) {
        // The first order is the probe — if it never fills, stop here rather
        // than firing N identical failures at the broker.
        lastError =
          error instanceof TypeError
            ? "Could not reach the execution bridge — check your connection and try again."
            : error instanceof Error
              ? error.message
              : "Execution failed.";
        return fail(lastError);
      }
      announce(false, `TRADE ${index} REFUSED — ${raw.toUpperCase()}`);
    }
  }

  onProgress?.("Disconnecting...");

  if (opened === 0 || !firstPayload) {
    return fail(lastError ?? "No trades were executed.");
  }

  const failed = total - opened;
  const rawTicket =
    firstPayload["order"] ??
    firstPayload["ticket"] ??
    firstPayload["deal"] ??
    firstPayload["order_id"] ??
    firstPayload["id"];
  const ticketNumber = Number(rawTicket);
  const ticketLabel =
    rawTicket !== undefined && rawTicket !== null && Number.isFinite(ticketNumber) ? ` Ticket #${ticketNumber}.` : ".";
  const summary =
    failed > 0
      ? `${total - failed}/${total} ${symbol} trades opened on MT5 — EA Migrate${ticketLabel}`
      : total > 1
        ? `${total}/${total} ${symbol} trades opened on MT5 — EA Migrate${ticketLabel}`
        : `${symbol} trade opened on MT5 — EA Migrate${ticketLabel}`;
  // The bridge drops SL/TP and still fills when the broker refuses the levels
  // — say so, rather than leaving an unprotected position looking fine.
  const stopsWarning =
    firstPayload["stops_removed"] === true
      ? " ⚠ Broker rejected the SL/TP levels — position opened WITHOUT them. Set stop-loss and take-profit manually in MT5."
      : "";

  recordTrade({
    symbol,
    direction,
    lot: String(lot),
    trades: total,
    filled: `${opened}/${total}`,
    ok: failed === 0,
    ...(strength ? { strength } : {}),
    detail: `${summary}${stopsWarning}`,
  });
  announce(true, `${summary}${stopsWarning}`.toUpperCase());
  return { ok: failed === 0, symbol, direction, opened, total, message: `${summary}${stopsWarning}` };
}
