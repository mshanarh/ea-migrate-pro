import { createServerFn } from "@tanstack/react-start";

/**
 * The real weekly economic calendar for the FUNDAMENTALS page.
 *
 * Source: the public ForexFactory weekly economic calendar mirror
 * (nfs.faireconomy.media) — free, no key. It publishes every event of the
 * current week with its impact level, forecast and previous value. The
 * endpoint sends no CORS header, so it is fetched here on the server and
 * cached for 5 minutes.
 *
 * The FULL week is returned in time order — no impact re-sorting, no cap —
 * so the calendar page can group events by day exactly like the design.
 * On failure the handler reports ok:false and the page falls back to the
 * live Investing.com widget instead of ever showing fake data.
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

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

let cache: { at: number; events: CalendarEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export const fetchWeekCalendar = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; events: CalendarEvent[] }> => {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return { ok: true, events: cache.events };
    }

    try {
      const res = await fetch(CALENDAR_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
      const raw = (await res.json()) as RawEvent[];

      const events: CalendarEvent[] = raw
        .filter((e) => e.title && e.date)
        .map((e, index) => ({
          id: `${e.date ?? ""}-${index}`,
          title: String(e.title),
          currency: (e.country ?? "").toUpperCase(),
          date: String(e.date),
          impact: e.impact ?? "Low",
          forecast: (e.forecast ?? "").trim(),
          previous: (e.previous ?? "").trim(),
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (events.length === 0) throw new Error("calendar feed was empty");

      cache = { at: Date.now(), events };
      return { ok: true, events };
    } catch {
      // Serve the (still real) stale cache if a refresh fails; otherwise the
      // page shows the live Investing.com widget — never fake events.
      return { ok: false, events: cache?.events ?? [] };
    }
  },
);
