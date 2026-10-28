/**
 * WHICH PAIRS AN EVENT MOVES — AND WHICH SIDE.
 *
 * The Fundamentals page trades an economic release, so before anything can be
 * analysed two questions have to be answered from the symbol alone:
 *
 *   1. is this symbol affected by the event's currency at all?
 *   2. if it is, does that currency move it up or down?
 *
 * Neither answer may be guessed. A pair affects a currency in one of two
 * mechanical ways — the currency is the pair's BASE (its strength lifts the
 * pair) or its QUOTE (its strength pushes the pair down) — and everything else
 * (gold, silver, oil, crypto, index CFDs) is a single instrument quoted IN a
 * currency, where the relationship only sometimes inverts.
 *
 * The old rule was a substring match: "USD" appeared in the symbol, so a USD
 * event offered XAUUSD. That is why a USD event only ever showed gold here —
 * EURUSD, GBPUSD, USDJPY and US30 were never even considered. Matching the
 * actual legs fixes that without inventing any symbol: the caller still only
 * ever gets symbols back that are already in Allowed Quotes.
 */

/** Currencies the calendar can move. */
const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
  "CNY", "ZAR", "MXN", "TRY", "SEK", "NOK", "PLN", "HUF",
  "SGD", "HKD", "CZK", "DKK",
]);

/**
 * Non-currency legs: a metal, an energy contract or crypto priced in one
 * currency. `inverts` = a stronger quote currency really does push the
 * instrument down (gold and oil are priced in USD), so the side is mechanical.
 */
const INSTRUMENTS: Record<string, { currency: string; inverts: boolean }> = {
  XAU: { currency: "USD", inverts: true },
  XAG: { currency: "USD", inverts: true },
  XPT: { currency: "USD", inverts: true },
  XPD: { currency: "USD", inverts: true },
  BTC: { currency: "USD", inverts: true },
  ETH: { currency: "USD", inverts: true },
  LTC: { currency: "USD", inverts: true },
  XRP: { currency: "USD", inverts: true },
  WTI: { currency: "USD", inverts: true },
  USOIL: { currency: "USD", inverts: true },
  BRENT: { currency: "USD", inverts: true },
  NGAS: { currency: "USD", inverts: true },
};

/**
 * Index CFDs are quoted in one currency but their side is NOT mechanical: a
 * stronger USD does not by itself mean a lower US30, so the event's currency
 * identifies the index as affected while the side keeps coming from the live
 * candles. `inverts` is false for exactly that reason.
 */
const INDEX_QUOTES: Record<string, string> = {
  US30: "USD", DOW: "USD", US100: "USD", NAS100: "USD", USTEC: "USD",
  US500: "USD", SPX500: "USD", US2000: "USD", US30CASH: "USD",
  GER40: "EUR", DE40: "EUR", DE30: "EUR", FRA40: "EUR", EU50: "EUR",
  STOXX50: "EUR", IT40: "EUR", ES35: "EUR", NETH25: "EUR",
  UK100: "GBP", JP225: "JPY", JPN225: "JPY", AUS200: "AUD",
  HK50: "HKD", SWI20: "CHF", CHINA50: "CNY",
};

export type SymbolLegs = {
  /** The pair's first leg, or the instrument itself for a single instrument. */
  base: string;
  /** The pair's second leg, or the currency the instrument is quoted in. */
  quote: string;
  /** True for a real FX pair (both legs are currencies). */
  fx: boolean;
  /** True when a move in one leg really does move the price in a fixed way. */
  inverts: boolean;
};

/** A known 6-letter FX pair, e.g. EURUSD → true. */
function isFxPair(core: string): boolean {
  return core.length === 6 && CURRENCIES.has(core.slice(0, 3)) && CURRENCIES.has(core.slice(3));
}

/** The broker's spelling with any account suffix removed (US30m, EURUSD.a). */
function cores(symbol: string): string[] {
  const raw = symbol.trim();
  const out: string[] = [];
  const push = (value: string) => {
    const upper = value.toUpperCase();
    if (upper && !out.includes(upper)) out.push(upper);
  };
  push(raw);
  push(raw.replace(/[._-][A-Za-z0-9]{1,6}$/, ""));
  // US30m / XAUUSDm — a trailing lowercase run the broker appended. The
  // three-character floor keeps an all-lowercase "eurusd" from being stripped
  // to nothing (that one is already handled by the first candidate).
  const withoutLowerSuffix = raw.replace(/[a-z]+$/, "");
  if (withoutLowerSuffix.length >= 3) push(withoutLowerSuffix);
  return out;
}

/**
 * The two legs of a symbol, or null when the symbol carries no currency this
 * module can reason about (a synthetic index, a stock, a spread bet name).
 */
export function legsOf(symbol: string): SymbolLegs | null {
  for (const core of cores(symbol)) {
    if (isFxPair(core)) {
      return { base: core.slice(0, 3), quote: core.slice(3), fx: true, inverts: true };
    }
    if (INDEX_QUOTES[core]) {
      return { base: core, quote: INDEX_QUOTES[core]!, fx: false, inverts: false };
    }
    const instrument = INSTRUMENTS[core];
    if (instrument) {
      return { base: core, quote: instrument.currency, fx: false, inverts: instrument.inverts };
    }
    if (core.length === 6) {
      const head = core.slice(0, 3);
      const tail = core.slice(3);
      // XAUUSD / BTCUSD style: a metal or crypto leg against a currency.
      if (INSTRUMENTS[head] && CURRENCIES.has(tail)) {
        return { base: head, quote: tail, fx: false, inverts: INSTRUMENTS[head]!.inverts };
      }
      if (CURRENCIES.has(head) && INSTRUMENTS[tail]) {
        return { base: head, quote: tail, fx: false, inverts: INSTRUMENTS[tail]!.inverts };
      }
    }
  }
  return null;
}

/**
 * Every Allowed Quote the event's currency acts on, FX pairs first, then the
 * metals / energy / crypto that are quoted in it, then the indices it prices.
 * Order inside each group follows Allowed Quotes, so the list is stable.
 */
export function symbolsForEvent(currency: string, allowed: readonly string[]): string[] {
  const wanted = currency.trim().toUpperCase();
  if (!wanted) return [];
  const rank = (symbol: string): number => {
    const legs = legsOf(symbol);
    if (!legs) return 99;
    // The currency has to be one of THIS symbol's legs — that check comes
    // first, or every FX pair would look affected by every currency.
    if (legs.base !== wanted && legs.quote !== wanted) return 99;
    if (legs.fx) return 0;
    return legs.inverts ? 1 : 2;
  };
  return allowed
    .map((symbol, index) => ({ symbol, index, rank: rank(symbol) }))
    .filter((entry) => entry.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.symbol);
}

/**
 * EVERY NAME THE EVENT'S CURRENCY IS LISTED IN — the standard broker
 * spellings, independent of what Allowed Quotes happens to hold.
 *
 * An event does not only move the pairs somebody already added to their list.
 * A USD release moves EURUSD, GBPUSD, USDJPY, gold, oil, bitcoin and the US
 * indices whether or not this account trades them; a GBP release moves cable,
 * EURGBP, the GBP crosses and UK100. The page is asked to show the names the
 * EVENT supports, so this catalog is the source for that list, and
 * `symbolsForEvent` above stays the source for "which of MINE does it move".
 *
 * A name only ever reaches a broker through the bridge, which resolves the
 * account's own spelling (XAUUSDm, EURUSD.a) by prefix — see
 * bridgeSymbolCandidates. A broker that does not list one of these simply
 * refuses that leg, and the card reports the refusal in the broker's words.
 */
const CATALOG: Record<string, readonly string[]> = {
  USD: [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    "USDCNH", "USDZAR", "USDMXN", "USDTRY", "USDSEK", "USDNOK", "USDPLN",
    "USDSGD", "USDHKD",
    "XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD",
    "BTCUSD", "ETHUSD", "USOIL", "UKOIL",
    "US30", "NAS100", "SPX500", "US2000",
  ],
  EUR: ["EURUSD", "EURGBP", "EURJPY", "EURCHF", "EURCAD", "EURAUD", "EURNZD", "GER40", "DE40", "EU50", "FRA40"],
  GBP: ["GBPUSD", "EURGBP", "GBPJPY", "GBPCHF", "GBPCAD", "GBPAUD", "GBPNZD", "UK100"],
  JPY: ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY", "JP225"],
  AUD: ["AUDUSD", "EURAUD", "GBPAUD", "AUDJPY", "AUDCAD", "AUDCHF", "AUDNZD", "AUS200"],
  NZD: ["NZDUSD", "EURNZD", "GBPNZD", "NZDJPY", "AUDNZD", "NZDCAD", "NZDCHF"],
  CAD: ["USDCAD", "EURCAD", "GBPCAD", "CADJPY", "AUDCAD", "NZDCAD", "CADCHF"],
  CHF: ["USDCHF", "EURCHF", "GBPCHF", "CHFJPY", "AUDCHF", "CADCHF", "NZDCHF", "SWI20"],
  CNY: ["USDCNH", "CHINA50"],
  HKD: ["USDHKD", "HK50"],
};

/**
 * The names the currency is quoted in, in broker-standard spelling.
 *
 * A currency with no hand-written entry still answers honestly: the two
 * directions against USD are the symbols brokers list for it.
 */
export function catalogForEvent(currency: string): string[] {
  const wanted = currency.trim().toUpperCase();
  if (!wanted) return [];
  const known = CATALOG[wanted];
  if (known) return [...known];
  return [`${wanted}USD`, `USD${wanted}`];
}

/**
 * ALL THE NAMES THIS EVENT SUPPORTS — this account's own pairs first (they are
 * already in Allowed Quotes and carry the event's side), then every other name
 * the currency is listed in.
 *
 * `symbolsForEvent` answers "which of MY quotes does this move"; this answers
 * "what does this event move", which is what the Fundamentals list shows. The
 * two are kept as separate questions so neither one can silently become the
 * other.
 */
/**
 * THE INSTRUMENT, NOT THE SPELLING — so XAUUSDm and XAUUSD are one entry.
 *
 * A broker appends its own suffix (XAUUSDm, EURUSD.a, US30m). Deduping on the
 * raw string would list the same instrument twice the moment the account's own
 * pair and the standard catalog name differ by a suffix; deduping on the real
 * legs keeps one row per instrument, and it is the account's own spelling that
 * survives.
 */
function instrumentKey(symbol: string): string {
  const legs = legsOf(symbol);
  if (legs) return `${legs.base}|${legs.quote}`;
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function allSymbolsForEvent(currency: string, allowed: readonly string[]): string[] {
  const own = symbolsForEvent(currency, allowed);
  const seen = new Set(own.map(instrumentKey));
  const rest: string[] = [];
  for (const symbol of catalogForEvent(currency)) {
    const key = instrumentKey(symbol);
    if (seen.has(key)) continue;
    seen.add(key);
    rest.push(symbol);
  }
  return [...own, ...rest];
}

/** True when this symbol came from this account's Allowed Quotes. */
export function isAllowedSymbol(symbol: string, allowed: readonly string[]): boolean {
  const wanted = symbol.trim().toUpperCase();
  return allowed.some((entry) => entry.trim().toUpperCase() === wanted);
}

/** The opposite side. */
const flip = (direction: "BUY" | "SELL"): "BUY" | "SELL" => (direction === "BUY" ? "SELL" : "BUY");

/**
 * The side this symbol must be traded on for the event's read.
 *
 *   currency is the BASE  → the currency's strength lifts the pair  → the read
 *   currency is the QUOTE → it is a headwind (or a tailwind for the quotes
 *                           that invert, like gold) → mirrored
 *
 * Returns null when the event's currency moves the symbol but does not fix its
 * side — an index CFD — so the caller keeps using the live candles and says so,
 * instead of asserting a direction the event never implied.
 */
export function sideForCurrency(
  symbol: string,
  currency: string,
  direction: "BUY" | "SELL",
): "BUY" | "SELL" | null {
  const wanted = currency.trim().toUpperCase();
  const legs = legsOf(symbol);
  if (!legs || !wanted) return null;
  if (legs.base === wanted) return legs.fx || legs.inverts ? direction : null;
  if (legs.quote === wanted) return legs.fx || legs.inverts ? flip(direction) : null;
  return null;
}
