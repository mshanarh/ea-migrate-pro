/**
 * BOT NOTIFICATIONS — ONE PLACE that decides what the phone is told.
 *
 * THE WORDING IS FIXED BY THE OWNER, so it lives here and nowhere else:
 *
 *   Trade 1 opened — BUY BTCUSDm 0.01 lots @ 80556.1
 *   Trade 1 closed — profit +$0.45        (or: stop loss -$0.30)
 *   Bot started — Scalper mode, watching BTCUSDm
 *   Trade skipped — not enough free margin
 *   Bot stopped
 *
 * and, in SCALPER mode only, a close followed immediately by the next open is
 * ONE notification:
 *
 *   Trade 1 closed — profit +$0.45. Trade 2 opened — BUY BTCUSDm 0.01 lots @ 80556.1
 *
 * THE RULES THAT MATTER
 *  • The title is always "EA Migrate". The Android side splits the payload on
 *    the first newline (title \n body), so the line below is the TITLE and the
 *    rest is the body — an older APK renders it correctly too.
 *  • A number is only ever spent on a CONFIRMED MT5 fill. A refusal, a signal,
 *    a "sending…" line or a failed order never takes a number, and no profit is
 *    ever printed that the broker did not report.
 *  • Numbers restart with every bot start (`beginBotSession`) and a close
 *    always carries the number the open was given.
 *  • A skip is reported ONCE per symbol + reason per five minutes. The loop
 *    re-analyses every few seconds while flat, and a phone that buzzes every
 *    six seconds for the same block is a phone with notifications turned off.
 *  • Nothing here speaks. Voice has its own path (`bot-voice`) and the two stay
 *    independent.
 */
import { callNative } from "./native-bridge";

/** The notification title, exactly as specified. */
export const NOTIFY_TITLE = "EA Migrate";

/** The send half of the payload — see the note above about the title line. */
function post(body: string): void {
  const text = body.trim();
  if (!text) return;
  console.info(`[notify] ${NOTIFY_TITLE} — ${text}`);
  callNative("showTradeNotification", NOTIFY_TITLE, `${NOTIFY_TITLE}\n${text}`);
}

/**
 * THE TRADE EXECUTION CARD, floating over whatever app is in front.
 *
 * A heads-up notification is easy to miss while the trader is looking at
 * MetaTrader, so every confirmed fill — and every refusal — is ALSO handed to
 * the native overlay, which draws the same rounded card over the screen:
 * green `Trade 1 CONFIRMED · BUY 0.01 BTCUSDm @ 80243.5`, or red with the
 * broker's own words. The native side only draws it; nothing here reports a
 * fill the broker did not confirm.
 */
function postResultCard(ok: boolean, headline: string, detail?: string): void {
  const line = headline.trim();
  if (!line) return;
  console.info(`[notify] result card (${ok ? "confirmed" : "refused"}) — ${line}`);
  callNative(
    "showTradeResult",
    JSON.stringify({ ok, headline: line, detail: (detail ?? "").trim() }),
  );
}

/** How long the same symbol+reason is not repeated. */
const SKIP_COOLDOWN_MS = 5 * 60 * 1000;
/** The same trade cannot be announced twice from a duplicated event. */
const DUPLICATE_OPEN_MS = 30 * 1000;

let tradeNo = 0;
const skipSeen = new Map<string, number>();
const recentOpens = new Map<string, number>();

/**
 * A NEW BOT RUN: numbers restart at 1, and yesterday's skip memory is dropped.
 * Called by the START path before the loop's first pass so an order that fills
 * immediately is already "Trade 1".
 */
export function beginBotSession(): void {
  tradeNo = 0;
  skipSeen.clear();
  recentOpens.clear();
}

/** The next number for a CONFIRMED fill. Never call this for a refusal. */
export function reserveTradeNumber(): number {
  tradeNo += 1;
  return tradeNo;
}

/** The number this session is up to (diagnostics/tests). */
export function currentTradeNumber(): number {
  return tradeNo;
}

/** Test seam — forget everything a session remembered. */
export function resetBotNotifications(): void {
  tradeNo = 0;
  skipSeen.clear();
  recentOpens.clear();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** A real broker price, without float noise and without inventing digits. */
function priceText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const parsed = asNumber(value);
  return parsed === null ? null : String(Number(parsed.toFixed(5)));
}

/** Lots as the trader configured them (0.01, 0.1, 1). */
function lotText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const parsed = asNumber(value);
  return parsed === null ? null : String(Number(parsed.toFixed(2)));
}

/** `+$0.45` / `-$0.30` — the broker's own sign, two decimals. */
export function moneyText(profit: number): string {
  return `${profit >= 0 ? "+" : "-"}$${Math.abs(profit).toFixed(2)}`;
}

export type OpenedTrade = {
  /** The number shown when this trade opened. */
  number: number;
  side: string;
  symbol: string;
  lotSize: string | number | null;
  price: string | number | null;
};

/**
 * `Trade 1 CONFIRMED · BUY 0.01 BTCUSDm @ 80243.5`
 *
 * The execution card's headline. "CONFIRMED" is only ever used here, and only
 * for a fill that came back from MT5 with retcode 10008/10009/10010 and a real
 * ticket — every caller of this function has already been through that check.
 */
export function describeConfirmed(trade: OpenedTrade): string {
  const side = trade.side.trim().toUpperCase();
  const lot = lotText(trade.lotSize);
  const price = priceText(trade.price);
  const head = `Trade ${trade.number} CONFIRMED · ${side}${lot ? ` ${lot}` : ""} ${trade.symbol.trim()}`;
  return price ? `${head} @ ${price}` : head;
}

/** `Trade 2 opened — SELL XAUUSD 0.01 lots @ 2650.4` */
export function describeOpen(trade: OpenedTrade): string {
  const lot = lotText(trade.lotSize);
  const price = priceText(trade.price);
  const head = `Trade ${trade.number} opened — ${trade.side.toUpperCase()} ${trade.symbol}`;
  const size = lot ? ` ${lot} lots` : "";
  const at = price ? ` @ ${price}` : "";
  return `${head}${size}${at}`;
}

export type ClosedTrade = {
  /** The number that trade was given when it opened. */
  number: number;
  /** The broker's confirmed result, when it reported one. */
  profit?: number | null;
  /** Which level closed it, when that is known. */
  outcome?: "stop-loss" | "take-profit" | "broker" | null;
};

/**
 * `Trade 1 closed — profit +$0.45`
 * `Trade 1 closed — stop loss -$0.30`
 * `Trade 1 closed — stop loss`        (level confirmed, result not reported)
 * `Trade 1 closed — closed by the broker`
 *
 * NO NUMBER IS EVER INVENTED. The bridge reports `profit` when IT placed the
 * close; when a stop or target closed the position broker-side there is no
 * result to read, so the level is named and the amount is left out rather than
 * guessed.
 */
export function describeClose(trade: ClosedTrade): string {
  // A close with no number is one the bot never opened (or never got the
  // ticket for) — it is still reported, just without a number it never had.
  const head = trade.number > 0 ? `Trade ${trade.number} closed — ` : "Position closed — ";
  const profit = asNumber(trade.profit);
  if (profit !== null) {
    if (profit >= 0) return `${head}profit ${moneyText(profit)}`;
    return `${head}${trade.outcome === "stop-loss" ? "stop loss" : "loss"} ${moneyText(profit)}`;
  }
  if (trade.outcome === "stop-loss") return `${head}stop loss`;
  if (trade.outcome === "take-profit") return `${head}take profit`;
  return `${head}closed by the broker`;
}

/** `Bot started — Scalper mode, watching BTCUSDm, XAUUSD` */
export function describeStart(mode: "scalper" | "normal", symbols: string[]): string {
  const modeText = mode === "scalper" ? "Scalper mode" : "Normal mode";
  const list = symbols.map((symbol) => symbol.trim()).filter(Boolean).join(", ");
  return list ? `Bot started — ${modeText}, watching ${list}` : `Bot started — ${modeText}`;
}

/**
 * THE BLOCK, NAMED. The analysis reasons are long sentences; the five hard
 * blocks the owner listed get their own short name, and anything else keeps the
 * reason's first sentence so the message is still the real one.
 */
export function blockLabel(reason: string): string {
  const text = reason.replace(/^NO TRADE\s*(\([^)]*\))?\s*:?\s*/i, "").trim();
  if (/free margin/i.test(text)) return "not enough free margin";
  if (/position cap|max(imum)? (open )?positions|already open/i.test(text)) {
    return "the per-symbol position cap is reached";
  }
  if (/stale|older than|not fresh/i.test(text)) return "candle data is missing or stale";
  if (/sl\s*\/\s*tp|levels? .*(invalid|wrong side)|invalid sl/i.test(text)) return "SL/TP levels are invalid";
  if (/live (price|quote)|quote|price/i.test(text)) return "live price is missing or invalid";
  const firstSentence = text.split(/(?<=\.)\s/)[0] ?? text;
  const short = firstSentence.length > 150 ? `${firstSentence.slice(0, 147)}…` : firstSentence;
  return short || "a hard safety block";
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Bot started — em and remember the session's numbering. */
export function notifyBotStarted(mode: "scalper" | "normal", symbols: string[]): void {
  post(describeStart(mode, symbols));
}

/** Bot stopped — no outcome is claimed for the positions that stay open. */
export function notifyBotStopped(): void {
  post("Bot stopped");
}

/**
 * ONE CONFIRMED OPEN — the number was reserved at the fill, so the close can
 * carry the very same one. A scalper close-then-open sends this through
 * `notifyCloseThenOpen` instead, which is why the number is passed in.
 */
export function notifyTradeOpened(trade: OpenedTrade): void {
  const signature = `${trade.number}|${trade.side}|${trade.symbol}|${priceText(trade.price) ?? ""}`;
  recentOpens.set(signature, Date.now());
  post(describeOpen(trade));
  postResultCard(true, describeConfirmed(trade));
}

/** A close this bot performed, with the broker's confirmed result. */
export function notifyTradeClosed(trade: ClosedTrade): void {
  post(describeClose(trade));
}

export function notifyScalperCloseAndReopen(
  close: ClosedTrade,
  reopen: OpenedTrade | null,
): void {
  const parts = describeClose(close);
  post(`${parts}${reopen ? ` — (scalper) reopen of ${reopen.side} ${reopen.symbol} queued` : ""}`);
}

/**
 * SCALPER ONLY — the close and the trade that followed it, as ONE alert.
 * `Trade 1 closed — profit +$0.45. Trade 2 opened — BUY BTCUSDm 0.01 lots @ …`
 *
 * The bot's own voice listens on the same execution bus as every other surface.
 * To keep the voice from speaking a per-close line like "Trade 1 closed — profit
 * +$0.45" on its own (which would announce every scalper close individually and
 * then keep repeating), the close-then-open alert as a whole is labelled as the
 * summary of one cycle, not `executed` or `closed`. The close is still shown and
 * notified normally — this flag only tells the voice that the lifecycle line for
 * this completed cycle is THIS combined message, and the real per-trade fill
 * announcements are the `executed` ones.
 */
export function notifyCloseThenOpen(close: ClosedTrade, opens: OpenedTrade[]): void {
  const parts = [describeClose(close), ...opens.map(describeOpen)];
  post(`${parts.join(". ")}`);
}

/**
 * A hard block stopped the trade. Deduped per symbol+reason so a flat market is
 * not re-announced on every six-second pass. Returns false when suppressed.
 */
export function notifyTradeSkipped(symbol: string, reason: string): boolean {
  const key = `${symbol.trim().toUpperCase()}|${blockLabel(reason)}`;
  const now = Date.now();
  const last = skipSeen.get(key);
  if (last !== undefined && now - last < SKIP_COOLDOWN_MS) return false;
  skipSeen.set(key, now);
  post(`Trade skipped — ${blockLabel(reason)}`);
  // The refusal is shown where the trader is looking, in the broker's own
  // words — not only as a notification they may never open.
  postResultCard(false, `${symbol.trim().toUpperCase()} NOT SENT`, blockLabel(reason));
  return true;
}

/** A position the BROKER closed (stop or target) — level named, amount not invented. */
export function notifyBrokerClose(input: {
  number: number;
  side: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** The live price at the moment the loop noticed the position was gone. */
  price?: number | null;
}): void {
  post(describeClose({ number: input.number, outcome: brokerOutcome(input) }));
}

/** A close that was NOT opened by this bot (broker-side stop/target). Never speak as an outcome. */
export function notifyBrokerCloseInfo(input: {
  number: number;
  side: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
  price?: number | null;
}): void {
  post(describeClose({ number: input.number, outcome: brokerOutcome(input) }));
}

/** Which level the live price proves was reached — null when it proves neither. */
function brokerOutcome(input: {
  side: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
  price?: number | null;
}): "stop-loss" | "take-profit" | "broker" {
  const price = asNumber(input.price);
  const sl = asNumber(input.stopLoss);
  const tp = asNumber(input.takeProfit);
  const buy = input.side.toUpperCase() === "BUY";
  if (price !== null) {
    if (sl !== null && (buy ? price <= sl : price >= sl)) return "stop-loss";
    if (tp !== null && (buy ? price >= tp : price <= tp)) return "take-profit";
  }
  return "broker";
}

/** Was this exact fill already announced? Guards a duplicated bus event. */
function alreadyAnnounced(signature: string): boolean {
  const at = recentOpens.get(signature);
  if (at === undefined) return false;
  return Date.now() - at < DUPLICATE_OPEN_MS;
}

/**
 * SCANNER / MANUAL EXECUTIONS — the same wording for a fill that did not come
 * from the bot loop (`TRADE 2/3 EXECUTED` on the execution bus).
 *
 * Only a confirmed fill is announced: the message must say EXECUTED and the
 * event must carry the side, symbol and lot the broker filled. A refusal never
 * reaches here, and a missing entry price simply drops the `@ price` clause
 * instead of inventing one.
 */
export function notifyExecutionResult(result: {
  ok?: boolean | undefined;
  message?: string | undefined;
  side?: string | undefined;
  symbol?: string | undefined;
  lotSize?: number | string | null | undefined;
  entry?: number | string | null | undefined;
}): void {
  if (result.ok !== true) return;
  if (!/EXECUTED/i.test(result.message ?? "")) return;
  const side = (result.side ?? "").trim();
  const symbol = (result.symbol ?? "").trim();
  if (!side || !symbol || side === "BLOCKED") return;
  const price = priceText(result.entry);
  const signature = `${side}|${symbol}|${priceText(result.entry) ?? ""}`;
  if (alreadyAnnounced(signature)) return;
  const number = reserveTradeNumber();
  recentOpens.set(`${number}|${signature}`, Date.now());
  recentOpens.set(signature, Date.now());
  const opened: OpenedTrade = { number, side, symbol, lotSize: result.lotSize ?? null, price: result.entry ?? null };
  post(describeOpen(opened));
  postResultCard(true, describeConfirmed(opened));
}
