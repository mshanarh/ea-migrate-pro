import { createServerFn } from "@tanstack/react-start";

/**
 * Upcoming forex news & predictions for the Settings → News section.
 *
 * Source: the public ForexFactory weekly economic calendar mirror
 * (nfs.faireconomy.media) — free, no key. It publishes every event of the
 * current week with its **forecast** (the prediction), previous value and
 * impact level. The endpoint sends no CORS header, so it is fetched here on
 * the server and cached for 5 minutes.
 *
 * Direction engine: each event is classified as DIRECT (higher number =
 * stronger currency: GDP, CPI, PMI, NFP, sales…), INVERSE (higher number =
 * weaker currency: unemployment claims/rate, oil inventories) or BINARY
 * (central-bank decisions, which move on the hawkish/dovish surprise). The
 * expected direction is consensus forecast vs previous, and concrete liquid
 * pairs are derived from the affected currency.
 */

export type TradeDirection = "BUY" | "SELL" | "NEUTRAL";

export type PairSuggestion = {
  /** e.g. "EUR/USD" */
  pair: string;
  /** Trade direction for this pair if the print meets the consensus. */
  direction: TradeDirection;
};

export type NewsEvent = {
  id: string;
  /** Event title, e.g. "Non-Farm Employment Change". */
  title: string;
  /** Currency affected, e.g. "USD". */
  currency: string;
  /** ISO datetime of the release. */
  date: string;
  /** "High" | "Medium" | "Low" | "Holiday". */
  impact: string;
  /** The predicted number (the market's forecast). */
  forecast: string;
  /** The last printed number. */
  previous: string;
  /** One-line prediction of what the release means for the market. */
  prediction: string;
  /** Expected direction for the event currency if the print meets consensus. */
  direction: TradeDirection;
  /** Short headline for the direction card, e.g. "USD strength expected". */
  directionHeadline: string;
  /** Why: which mechanism produced the direction. */
  directionReason: string;
  /** Concrete liquid pairs with per-pair direction. */
  pairs: PairSuggestion[];
  /** What flips the direction — the deviation scenarios. */
  scenarios: string;
};

type RawEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
};

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

let cache: { at: number; events: NewsEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/* ---------------- direction engine ---------------- */

/** Most liquid pairs per currency: [pair, base, quote], most-traded first. */
const LIQUID_PAIRS: Record<string, Array<[string, string, string]>> = {
  USD: [
    ["EUR/USD", "EUR", "USD"],
    ["USD/JPY", "USD", "JPY"],
    ["GBP/USD", "GBP", "USD"],
  ],
  EUR: [
    ["EUR/USD", "EUR", "USD"],
    ["EUR/JPY", "EUR", "JPY"],
    ["EUR/GBP", "EUR", "GBP"],
  ],
  GBP: [
    ["GBP/USD", "GBP", "USD"],
    ["GBP/JPY", "GBP", "JPY"],
    ["EUR/GBP", "EUR", "GBP"],
  ],
  JPY: [
    ["USD/JPY", "USD", "JPY"],
    ["EUR/JPY", "EUR", "JPY"],
    ["GBP/JPY", "GBP", "JPY"],
  ],
  AUD: [
    ["AUD/USD", "AUD", "USD"],
    ["AUD/JPY", "AUD", "JPY"],
  ],
  CAD: [
    ["USD/CAD", "USD", "CAD"],
    ["CAD/JPY", "CAD", "JPY"],
  ],
  CHF: [
    ["USD/CHF", "USD", "CHF"],
    ["EUR/CHF", "EUR", "CHF"],
  ],
  NZD: [["NZD/USD", "NZD", "USD"]],
  CNY: [["USD/CNH", "USD", "CNH"]],
  MXN: [["USD/MXN", "USD", "MXN"]],
  ZAR: [["USD/ZAR", "USD", "ZAR"]],
};

/** Titles where a HIGHER number means a WEAKER currency. */
const INVERSE_TITLE = /unemployment|jobless|claimant|crude oil inventories/i;
/** Central-bank decisions: direction depends on the hawkish/dovish surprise. */
const BINARY_TITLE =
  /rate decision|interest rate|monetary policy|official bank rate|central bank|fomc/i;

function numeric(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function computeDirection(
  event: RawEvent,
): Pick<NewsEvent, "direction" | "directionHeadline" | "directionReason" | "pairs" | "scenarios"> {
  const currency = (event.country ?? "").toUpperCase();
  const title = event.title ?? "";
  const f = (event.forecast ?? "").trim();
  const p = (event.previous ?? "").trim();
  const numF = numeric(f);
  const numP = numeric(p);
  const binary = BINARY_TITLE.test(title);
  const inverse = INVERSE_TITLE.test(title);

  if ((event.impact ?? "").toLowerCase() === "holiday") {
    return {
      direction: "NEUTRAL",
      directionHeadline: "Market holiday",
      directionReason: "No directional edge — liquidity will be thin.",
      pairs: [],
      scenarios: "Skip execution around the holiday window; spreads widen and moves reverse.",
    };
  }

  if (binary) {
    return {
      direction: "NEUTRAL",
      directionHeadline: `Direction depends on the surprise — hawkish lifts ${currency || "the currency"}, dovish sinks it`,
      directionReason: "Central-bank decisions move on tone, not the number itself.",
      pairs: [],
      scenarios: `A hike or hawkish hold (above ${f || "consensus"}) → BUY ${currency || "the currency"} · a cut or dovish tone (below ${f || "consensus"}) → SELL ${currency || "the currency"}. Wait for the statement, then follow the first strong candle.`,
    };
  }

  if (numF === null || numP === null || numF === numP) {
    return {
      direction: "NEUTRAL",
      directionHeadline: `In-line print expected — trade the surprise, not the headline`,
      directionReason:
        "Consensus equals the previous value, so the market has no pre-built direction.",
      pairs: [],
      scenarios: `Above ${f || "consensus"} → ${currency || "the currency"} up · below → down. The spike follows the deviation size.`,
    };
  }

  // Direct metric: forecast above previous expects improvement (bullish).
  // Inverse metric (unemployment, inventories): lower is bullish.
  const higherMeansStronger = !inverse;
  const forecastHigher = numF > numP;
  const stronger = forecastHigher ? higherMeansStronger : !higherMeansStronger;
  const direction: TradeDirection = stronger ? "BUY" : "SELL";
  const mechanism = inverse
    ? "inverted metric — lower is bullish"
    : "direct metric — growth prints lift the currency";

  const headline = stronger
    ? `${currency || "The currency"} strength expected (BUY bias)`
    : `${currency || "The currency"} weakness expected (SELL bias)`;

  const pairs: PairSuggestion[] = (LIQUID_PAIRS[currency] ?? []).map(([pair, base, quote]) => ({
    pair,
    direction: base === currency ? direction : direction === "BUY" ? "SELL" : "BUY",
  }));

  const ref = f || "consensus";
  const scenarios = inverse
    ? `Claims/number above ${ref} → ${currency} weakens (SELL) · below ${ref} → ${currency} strengthens (BUY).`
    : `Print above ${ref} → ${currency} strengthens (BUY) · below ${ref} → ${currency} weakens (SELL).`;

  return {
    direction,
    directionHeadline: headline,
    directionReason: `Forecast ${f} vs previous ${p} on an ${mechanism}.`,
    pairs,
    scenarios,
  };
}

/* ---------------- prediction text ---------------- */

/** Turns forecast/previous values into a short market read. */
function buildPrediction(event: RawEvent): string {
  const impact = (event.impact ?? "").toLowerCase();
  const f = (event.forecast ?? "").trim();
  const p = (event.previous ?? "").trim();

  if (impact === "holiday") return "Market holiday — thin liquidity expected.";
  if (!f && !p) return "No consensus forecast yet — expect volatility once numbers drop.";

  if (f && p) {
    const numF = Number(f.replace(/[^0-9.-]/g, ""));
    const numP = Number(p.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(numF) && Number.isFinite(numP)) {
      if (numF > numP)
        return `Forecast ${f} above previous ${p} — market expects improvement; supportive for ${event.country ?? "the currency"} if met.`;
      if (numF < numP)
        return `Forecast ${f} below previous ${p} — market expects cooling; could weaken ${event.country ?? "the currency"} if met.`;
      return `Forecast matches previous (${f}) — in-line print likely; watch the surprise, not the number.`;
    }
  }
  return `Consensus forecast ${f || "n/a"} (previous ${p || "n/a"}) — trade the deviation, not the headline.`;
}

/* ---------------- server fn ---------------- */

export const fetchUpcomingNews = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: true; events: NewsEvent[] }> => {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return { enabled: true, events: cache.events };
    }

    try {
      const res = await fetch(CALENDAR_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
      const raw = (await res.json()) as RawEvent[];
      const now = Date.now();

      const events: NewsEvent[] = raw
        .filter((e) => e.title && e.date)
        .map((e, index) => {
          const direction = computeDirection(e);
          return {
            id: `${e.date ?? ""}-${index}`,
            title: String(e.title),
            currency: (e.country ?? "").toUpperCase(),
            date: String(e.date),
            impact: e.impact ?? "Low",
            forecast: (e.forecast ?? "").trim(),
            previous: (e.previous ?? "").trim(),
            prediction: buildPrediction(e),
            ...direction,
          };
        })
        // Upcoming only, soonest first.
        .filter((e) => new Date(e.date).getTime() >= now - 30 * 60 * 1000)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        // High/Medium impact first, then the soonest.
        .sort((a, b) => {
          const rank = (impact: string) =>
            impact === "High" ? 0 : impact === "Medium" ? 1 : impact === "Low" ? 2 : 3;
          return rank(a.impact) - rank(b.impact);
        })
        .slice(0, 24);

      cache = { at: Date.now(), events };
      return { enabled: true, events };
    } catch {
      // Serve stale cache if a refresh fails; otherwise empty.
      return { enabled: true, events: cache?.events ?? [] };
    }
  },
);
