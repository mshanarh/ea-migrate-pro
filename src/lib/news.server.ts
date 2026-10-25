import { createServerFn } from "@tanstack/react-start";

/**
 * The real economic calendar behind the FUNDAMENTALS page.
 *
 * Source: TradingView's public economic-calendar feed — free, no key, and the
 * only free feed here that actually carries the RELEASED number (`actual`)
 * next to `forecast` and `previous`. The older ForexFactory mirrors were
 * forecast-only, so every event read as "not yet released" even after it had
 * printed; they are no longer used.
 *
 * The feed sends no CORS header, so it is fetched HERE, on the server, and
 * cached for five minutes. The page's refresh button passes `force: true` to
 * bypass that cache. Nothing is ever invented: a row without an `actual` is
 * reported as unreleased, and a failed refresh keeps the previous REAL cache.
 */

export type CalendarEvent = {
  id: string;
  /** Event title, e.g. "CPI". */
  title: string;
  /** Currency affected, e.g. "USD". */
  currency: string;
  /** ISO datetime of the release. */
  date: string;
  /** "High" | "Medium" | "Low". */
  impact: string;
  /** The consensus forecast, as printed by the source. */
  forecast: string;
  /** The last printed number. */
  previous: string;
  /** The released number — empty until the event prints. */
  actual: string;
};

type TvEvent = {
  title?: string;
  currency?: string;
  date?: string;
  importance?: number;
  actual?: number | string | null;
  forecast?: number | string | null;
  previous?: number | string | null;
  unit?: string | null;
  period?: string | null;
  indicator?: string | null;
};

const TV_ENDPOINT = "https://economic-calendar.tradingview.com/events";
/** The currencies this app's Allowed Quotes are quoted in. */
const COUNTRIES = ["US", "EU", "GB"];
const DAY_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; events: CalendarEvent[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;
const STALE_OK_MS = 12 * 60 * 60 * 1000;

function formatNumber(value: number | string | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "number" ? value : String(value).trim();
  if (raw === "") return "";
  const text = typeof raw === "number" ? String(raw) : raw;
  const suffix = unit ? String(unit).trim() : "";
  if (!suffix) return text;
  if (suffix === "%") return `${text}%`;
  if (suffix === "K" || suffix === "M" || suffix === "B") return `${text}${suffix}`;
  return `${text} ${suffix}`;
}

function impactOf(importance: number | undefined): string {
  if (importance === 1) return "High";
  if (importance === 0) return "Medium";
  return "Low";
}

async function fetchEvents(): Promise<CalendarEvent[]> {
  const from = new Date(Date.now() - 21 * DAY_MS).toISOString();
  const to = new Date(Date.now() + 21 * DAY_MS).toISOString();
  const url = `${TV_ENDPOINT}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=${COUNTRIES.join(",")}`;

  const response = await fetch(url, {
    headers: {
      // The endpoint answers a bare server request with an empty body unless an
      // Origin is present, so it is sent explicitly.
      Origin: "https://www.tradingview.com",
      Referer: "https://www.tradingview.com/",
      "User-Agent": "Mozilla/5.0 (compatible; EA-Migrate/1.0)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`calendar HTTP ${response.status}`);

  const payload = (await response.json()) as { result?: TvEvent[] } | TvEvent[];
  const rows = Array.isArray(payload) ? payload : (payload.result ?? []);

  return rows
    .filter((event) => event.title && event.date && event.currency)
    .map((event) => ({
      id: `tv|${String(event.date)}|${String(event.title)}|${String(event.currency)}`,
      title: String(event.title),
      currency: String(event.currency).toUpperCase(),
      date: String(event.date),
      impact: impactOf(event.importance),
      forecast: formatNumber(event.forecast, event.unit),
      previous: formatNumber(event.previous, event.unit),
      actual: formatNumber(event.actual, event.unit),
    }));
}

/**
 * The window's real calendar.
 *
 * `force: true` (the page's refresh button) skips the five-minute cache so a
 * tap really re-asks the feed instead of echoing what is already cached.
 */
export const fetchWeekCalendar = createServerFn({ method: "POST" })
  .validator((data: { force?: boolean } | undefined) => data ?? {})
  .handler(
    async ({ data }): Promise<{ ok: boolean; events: CalendarEvent[] }> => {
      if (!data.force && cache && Date.now() - cache.at < CACHE_MS) {
        return { ok: true, events: cache.events };
      }

      try {
        const events = await fetchEvents();
        if (events.length === 0) {
          if (cache && Date.now() - cache.at < STALE_OK_MS) return { ok: true, events: cache.events };
          return { ok: false, events: [] };
        }
        const sorted = events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        cache = { at: Date.now(), events: sorted };
        return { ok: true, events: sorted };
      } catch (error) {
        console.warn("[fundamentals] calendar fetch failed", error);
        // A still-real cache beats a blank screen; otherwise the page shows an
        // honest retry state — never fabricated numbers.
        if (cache && Date.now() - cache.at < STALE_OK_MS) {
          return { ok: true, events: cache.events };
        }
        return { ok: false, events: [] };
      }
    },
  );
