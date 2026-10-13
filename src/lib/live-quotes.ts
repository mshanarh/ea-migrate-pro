/**
 * Live market quotes — powers the QUOTES button on the robot dashboard.
 *
 * Same feed the scanner uses (public chart API, Binance for crypto) and the
 * same symbol resolution, so what the trader sees here matches what the
 * scanner analyzes: broker suffixes/prefixes (XAUUSD.m, HW_100) are stripped
 * before the feed lookup. Works on Android (WebView fetch is a normal
 * browser fetch) and iOS Safari/PWA alike — no native bridge needed.
 */

export type LiveQuote = {
  symbol: string;
  /** Feed symbol the quote was resolved to ("" when no feed covers it). */
  resolved: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  /** true when the price is SIMULATED (no public feed) — never tradable info. */
  simulated: boolean;
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Normalise a broker symbol for a title row ("XAUUSD.m" → "XAUUSD"). */
export function quoteLabel(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/^[A-Z]{2,5}_/, "")
    .replace(/\.(M|PRO|I|C|Z)$/i, "");
}

/**
 * Map a broker symbol to its public feed ticker (subset of the scanner's
 * rules — quotes only need the ticker, not candles/history rules).
 */
function publicTickerFor(raw: string): string | undefined {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return undefined;
  const prefixStripped = cleaned.replace(/^[A-Z]{2,5}_/, "");
  const suffixStripped = prefixStripped.replace(/\.(M|PRO|I|C|Z)$/i, "");
  const symbol = suffixStripped || cleaned;

  // Crypto first — dedicated rate-limit-friendly source (Binance US).
  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|BNB|LTC|AVAX|LINK)(USD|USDT)$/.test(symbol)) {
    return `${symbol.replace(/(USD|USDT)$/, "")}-USD`;
  }
  // Index numbers (HW_100 → 100, US30 → 30) and index names.
  if (/^(NAS)?100$|^US100|^USTEC|^NDX|^HW100/.test(symbol)) return "NQ=F";
  if (/^US30$|^DOW|^DJI|^30$/.test(symbol)) return "YM=F";
  if (/^(SP)?500$|^US500|^SP500|^SPX/.test(symbol)) return "ES=F";
  if (/^XAU|GOLD/.test(symbol)) return "GC=F";
  if (/^XAG|SILVER/.test(symbol)) return "SI=F";
  if (/^WTI|USOIL|CRUDE/.test(symbol)) return "CL=F";
  if (/^UKOIL|BRENT/.test(symbol)) return "BZ=F";
  if (/^NAS100|^US100|^USTEC|^NDX/.test(symbol)) return "NQ=F";
  if (/^US30|^DOW|^DJI/.test(symbol)) return "YM=F";
  if (/^SPX|^US500|^SP500/.test(symbol)) return "ES=F";
  if (/^GER40|^DAX/.test(symbol)) return "^GDAXI";
  if (/^UK100|^FTSE/.test(symbol)) return "^FTSE";
  if (/^JP225|^NIKKEI/.test(symbol)) return "^N225";
  if (/^(V75|V100|BOOM|CRASH|JUMP|STEP|DRIFT|FLAME|DXYY|DXY)/.test(symbol)) return undefined;
  // Forex pairs.
  const FX = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "ZAR", "MXN", "TRY", "SEK", "NOK", "PLN"]);
  if (symbol.length === 6 && FX.has(symbol.slice(0, 3)) && FX.has(symbol.slice(3))) return `${symbol}=X`;
  return undefined;
}

async function fetchYahooQuote(ticker: string): Promise<Omit<LiveQuote, "symbol" | "resolved" | "simulated"> | null> {
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": BROWSER_UA,
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        chart?: {
          result?: {
            meta?: { regularMarketPrice?: number; previousClose?: number };
            timestamp?: number[];
            indicators?: { quote?: { close?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[] }[] };
          }[];
        };
      };
      const result = payload.chart?.result?.[0];
      const price = result?.meta?.regularMarketPrice;
      if (!price || !Number.isFinite(price)) continue;
      const prev = result?.meta?.previousClose;
      const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((value): value is number => typeof value === "number");
      const high = Math.max(...(result?.indicators?.quote?.[0]?.high ?? []).filter((value): value is number => typeof value === "number"), price);
      const low = Math.min(...(result?.indicators?.quote?.[0]?.low ?? []).filter((value): value is number => typeof value === "number").filter((v) => v > 0), price);
      const change = typeof prev === "number" && prev > 0 ? price - prev : price - (closes.at(-2) ?? price);
      return {
        price,
        change,
        changePercent: typeof prev === "number" && prev > 0 ? (change / prev) * 100 : 0,
        dayHigh: high,
        dayLow: low,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchBinanceQuote(ticker: string): Promise<Omit<LiveQuote, "symbol" | "resolved" | "simulated"> | null> {
  const base = ticker.replace(/-USD$/, "");
  try {
    const response = await fetch(`https://api.binance.us/api/v3/ticker/24hr?symbol=${base}USDT`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      lastPrice?: string;
      priceChangePercent?: string;
      highPrice?: string;
      lowPrice?: string;
    };
    const price = Number(payload.lastPrice);
    if (!price || !Number.isFinite(price)) return null;
    const changePercent = Number(payload.priceChangePercent ?? 0);
    return {
      price,
      change: price * (changePercent / 100),
      changePercent,
      dayHigh: Number(payload.highPrice ?? price),
      dayLow: Number(payload.lowPrice ?? price),
    };
  } catch {
    return null;
  }
}

/** Rough synthetic scale so simulated rows still LOOK plausible. */
function simulatedQuote(symbol: string): Omit<LiveQuote, "symbol" | "resolved" | "simulated"> {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let base = 100;
  if (/^V75|BOOM500|CRASH500/.test(cleaned)) base = 8500;
  else if (/^BOOM|CRASH/.test(cleaned)) base = 6500;
  else if (/^JUMP|^STEP|^DRIFT/.test(cleaned)) base = 10000;
  else if (/^FLAME/.test(cleaned)) base = 83000;
  else if (/^V100/.test(cleaned)) base = 1250;
  else if (/^XAU|GOLD/.test(cleaned)) base = 2600;
  else if (/^DXYY|DXY/.test(cleaned)) base = 104;
  const drift = (Math.sin(Date.now() / 90_000_000) * 0.004 + 0.002) * base;
  const price = base + drift;
  return {
    price,
    change: drift,
    changePercent: (drift / base) * 100,
    dayHigh: price * 1.004,
    dayLow: price * 0.996,
  };
}

/**
 * Fetch quotes for a list of broker symbols. Never throws — a failed symbol
 * degrades to a simulated row (flagged simulated=true).
 */
export async function fetchLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
  return Promise.all(
    unique.map(async (symbol): Promise<LiveQuote> => {
      const ticker = publicTickerFor(symbol);
      if (!ticker) {
        return { symbol, resolved: "", ...simulatedQuote(symbol), simulated: true };
      }
      let data = null;
      if (/^[A-Z]{3,5}-USD$/.test(ticker)) data = await fetchBinanceQuote(ticker);
      if (!data) data = await fetchYahooQuote(ticker);
      if (!data) {
        return { symbol, resolved: ticker, ...simulatedQuote(symbol), simulated: true };
      }
      return { symbol, resolved: ticker, ...data, simulated: false };
    }),
  );
}

/** Format a price with sensible digits for the row display. */
export function fmtQuotePrice(value: number): string {
  const abs = Math.abs(value);
  return value.toFixed(abs >= 1000 ? 2 : abs >= 10 ? 3 : 5);
}
