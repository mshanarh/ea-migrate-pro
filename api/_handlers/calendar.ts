/**
 * POST /api/calendar — this week's real economic calendar for the
 * FUNDAMENTALS page.
 *
 * WHY IT IS AN /api ROUTE AND NOT A SERVER FUNCTION
 * ────────────────────────────────────────────────
 * The deployed app is a static client site plus this one gateway function
 * (see api/gateway.ts). TanStack server functions are not served by that
 * deployment — `POST /_serverFn/<id>` comes back as the SPA shell — so the
 * calendar behind `createServerFn` could never load in production, and the
 * page sat on "Could not load the economic calendar — tap to retry" however
 * correct the feed code was. This route is reached, so the page works.
 *
 * Body: { force?: boolean }   — force skips the five-minute cache.
 * Reply: { ok, events[], fetchedAt, stale }  (see src/lib/news.server.ts)
 *
 * The feed body itself is shared with the (now unused) server path through
 * `src/lib/news.server.ts`, which imports nothing — no TanStack, no Supabase —
 * so the same week cache backs every caller.
 */
import { fetchWeekCalendarData } from "../../src/lib/news.server.js";

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

function wantsForce(body: unknown): boolean {
  if (!body) return false;
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (parsed && typeof parsed === "object" && "force" in parsed) {
    return (parsed as { force?: unknown }).force === true;
  }
  return false;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  // The calendar is public market data — cacheable at the edge for a minute so
  // a page refresh does not hammer the feed, while still being current.
  response.setHeader("cache-control", "public, max-age=60");
  try {
    const reply = await fetchWeekCalendarData(wantsForce(request.body));
    response.status(reply.ok ? 200 : 502).json(reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[calendar] handler failed", message);
    response.status(502).json({ ok: false, events: [], fetchedAt: null, stale: false });
  }
}
