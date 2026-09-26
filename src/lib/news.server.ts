import { createServerFn } from "@tanstack/react-start";

/**
 * The real weekly economic calendar for the FUNDAMENTALS page.
 *
 * Source: the public ForexFactory weekly economic calendar mirrors
 * (nfs.faireconomy.media) — free, no key. This week AND next week are
 * fetched so the calendar always has real events ahead of it, even at the
 * end of the trading week. The mirrors send no CORS header, so they are
 * fetched here on the server and cached for 5 minutes.
 *
 * Reliability: both mirrors are pulled in parallel and merged. If the
 * refresh fails entirely, a still-real cache (up to 12h old) is served
 * before the page ever falls back to the live Investing.com widget.
 * No mock data anywhere — the page shows only real releases.
 */

export type CalendarEvent = {
  id: string;
  /** Event title, e.g. "Non-Farm Employment Change". */
  title: string;
  /** Currency affected, e.g. "USD". */
  currency: string;
  /** ISO datetime of the release. */
  date: string;
  /** "High" | "Medium" | "Low" | "Holiday". */
  impact: string;
  /** The consensus forecast. */
  forecast: string;
  /** The last printed number. */
  previous: string;
};

type RawEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
};

const SOURCES = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];

let cache: { at: number; events: CalendarEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;
const STALE_OK_MS = 12 * 60 * 60 * 1000;

async function fetchSource(url: string): Promise<CalendarEvent[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
  const raw = (await res.json()) as RawEvent[];
  return raw
    .filter((e) => e.title && e.date)
    .map((e) => ({
      id: `${String(e.date)}|${String(e.title)}|${String(e.country ?? "")}`,
      title: String(e.title),
      currency: (e.country ?? "").toUpperCase(),
      date: String(e.date),
      impact: e.impact ?? "Low",
      forecast: (e.forecast ?? "").trim(),
      previous: (e.previous ?? "").trim(),
    }));
}

export const fetchWeekCalendar = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; events: CalendarEvent[] }> => {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return { ok: true, events: cache.events };
    }

    const settled = await Promise.allSettled(SOURCES.map(fetchSource));
    const merged = new Map<string, CalendarEvent>();
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        for (const event of outcome.value) merged.set(event.id, event);
      }
    }

    if (merged.size === 0) {
      // A still-real stale cache beats showing nothing; otherwise the page
      // falls back to the live Investing.com widget — never fake events.
      if (cache && Date.now() - cache.at < STALE_OK_MS) {
        return { ok: true, events: cache.events };
      }
      return { ok: false, events: [] };
    }

    const events = [...merged.values()].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    cache = { at: Date.now(), events };
    return { ok: true, events };
  },
);
