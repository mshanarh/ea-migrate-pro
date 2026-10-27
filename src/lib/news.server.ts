import { createServerFn } from "@tanstack/react-start";

/**
 * The real economic calendar behind the FUNDAMENTALS page.
 *
 * Source: ForexFactory's public weekly feed
 * (`https://nfs.faireconomy.media/ff_calendar_thisweek.json`) — free, no key,
 * CORS-free for a server fetch, and it carries `title`, `country`, `date`,
 * `impact`, `forecast` and `previous` for every release this week.
 *
 * It REPLACED TradingView's economic-calendar endpoint, which answers a server
 * request with HTTP 403 — that is why every row on the page used to read
 * "Could not load event data": there was no feed behind it at all.
 *
 * Notes on the shape of the data:
 *  • ForexFactory has no `actual` column, so `actual` is always "". A release
 *    the feed no longer carries therefore reads as "not yet released" rather
 *    than as an invented number — nothing here is ever fabricated.
 *  • `country` IS the currency the release moves ("USD", "EUR", "GBP", "NZD"),
 *    which is exactly what the page's per-currency symbol mapping needs.
 *
 * Caching: the whole week's payload is held in memory with the timestamp it was
 * fetched at. A later failure (network, 5xx, rate limit) returns that cache
 * with `stale: true` and the original `fetchedAt`, so the page keeps rendering
 * real events with a "as of …" line instead of a blank retry state. Only a
 * failure with no cache at all reports `ok: false`.
 */

export type CalendarEvent = {
  id: string;
  /** Event title, e.g. "CPI". */
  title: string;
  /** Currency affected, e.g. "USD". */
  currency: string;
  /** ISO datetime of the release. */
  date: string;
  /** "High" | "Medium" | "Low" | "Holiday". */
  impact: string;
  /** The consensus forecast, as printed by the source. */
  forecast: string;
  /** The last printed number. */
  previous: string;
  /** The released number — the ForexFactory weekly feed does not carry one. */
  actual: string;
};

export type CalendarReply = {
  ok: boolean;
  events: CalendarEvent[];
  /** When the events in this reply were fetched from the feed (ms). */
  fetchedAt: number | null;
  /** True when this reply is a cache kept because the live fetch failed. */
  stale: boolean;
};

type FfEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
};

const FF_ENDPOINT = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

let cache: { at: number; events: CalendarEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;
/** A cache older than this is no longer worth showing as "current week". */
const STALE_OK_MS = 36 * 60 * 60 * 1000;

function clean(value: string | undefined): string {
  const raw = (value ?? "").trim();
  // The feed escapes forward slashes ("SPPI y\\/y"); unescape for display.
  return raw.replace(/\\\//g, "/");
}

function impactOf(value: string | undefined): string {
  const raw = clean(value);
  if (!raw) return "Low";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

async function fetchEvents(): Promise<CalendarEvent[]> {
  const response = await fetch(FF_ENDPOINT, {
    headers: {
      // The media host serves an empty body to some bare clients; a normal
      // browser-style UA + JSON accept always gets the payload.
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      accept: "application/json, text/plain, */*",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`calendar HTTP ${response.status}`);

  const payload = (await response.json()) as FfEvent[] | { result?: FfEvent[] };
  const rows = Array.isArray(payload) ? payload : (payload.result ?? []);

  return rows
    .filter((event) => event.title && event.date && event.country)
    .map((event) => {
      const title = clean(event.title);
      const currency = clean(event.country).toUpperCase();
      const date = clean(event.date);
      return {
        id: `ff|${date}|${title}|${currency}`,
        title,
        currency,
        date,
        impact: impactOf(event.impact),
        forecast: clean(event.forecast),
        previous: clean(event.previous),
        actual: "",
      };
    });
}

/**
 * This week's real calendar.
 *
 * `force: true` (the page's refresh button) skips the five-minute cache so a
 * tap really re-asks the feed instead of echoing what is already cached.
 */
export const fetchWeekCalendar = createServerFn({ method: "POST" })
  .validator((data: { force?: boolean } | undefined) => data ?? {})
  .handler(async ({ data }): Promise<CalendarReply> => {
    if (!data.force && cache && Date.now() - cache.at < CACHE_MS) {
      return { ok: true, events: cache.events, fetchedAt: cache.at, stale: false };
    }

    try {
      const events = await fetchEvents();
      if (events.length === 0) {
        if (cache && Date.now() - cache.at < STALE_OK_MS) {
          return { ok: true, events: cache.events, fetchedAt: cache.at, stale: true };
        }
        return { ok: false, events: [], fetchedAt: null, stale: false };
      }
      const sorted = events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      cache = { at: Date.now(), events: sorted };
      return { ok: true, events: sorted, fetchedAt: cache.at, stale: false };
    } catch (error) {
      console.warn("[fundamentals] calendar fetch failed", error);
      // A still-real cache beats a blank screen; otherwise the page shows an
      // honest retry state — never fabricated numbers.
      if (cache && Date.now() - cache.at < STALE_OK_MS) {
        return { ok: true, events: cache.events, fetchedAt: cache.at, stale: true };
      }
      return { ok: false, events: [], fetchedAt: null, stale: false };
    }
  });
