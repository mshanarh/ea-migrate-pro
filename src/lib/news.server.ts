import { createServerFn } from "@tanstack/react-start";

/**
 * Upcoming forex news & predictions for the Settings → News section.
 *
 * Source: the public ForexFactory weekly economic calendar mirror
 * (nfs.faireconomy.media) — free, no key. It publishes every event of the
 * current week with its **forecast** (the prediction), previous value and
 * impact level. The endpoint sends no CORS header, so it is fetched here on
 * the server and cached for 5 minutes.
 */

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
        .map((e, index) => ({
          id: `${e.date ?? ""}-${index}`,
          title: String(e.title),
          currency: (e.country ?? "").toUpperCase(),
          date: String(e.date),
          impact: e.impact ?? "Low",
          forecast: (e.forecast ?? "").trim(),
          previous: (e.previous ?? "").trim(),
          prediction: buildPrediction(e),
        }))
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
