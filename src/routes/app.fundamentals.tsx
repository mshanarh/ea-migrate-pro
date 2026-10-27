import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Zap } from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { AnalyzeExecuteCard } from "@/components/app/AnalyzeExecuteCard";
import type { CalendarEvent, CalendarReply } from "@/lib/news.server";
import { useTradingPairsStore } from "@/lib/trading-pairs-store";

// ------------------------------------------------------------------ tokens

const HEADING = "text-[13px] font-extrabold uppercase tracking-[0.2em] text-white/70";
const CARD = "rounded-2xl border border-white/10 bg-[#111] p-4";

// ------------------------------------------------------------------ catalog

type EventDef = {
  id: string;
  label: string;
  /** Currency the release moves. */
  currency: string;
  /** Calendar titles that belong to this event (case-insensitive fragments). */
  match: string[];
  /** A higher print is bearish for the currency (unemployment, oil builds). */
  invert?: boolean;
};

const EVENTS: EventDef[] = [
  { id: "nfp", label: "Non-Farm Payrolls", currency: "USD", match: ["non farm payrolls", "non-farm payrolls", "nonfarm payrolls"] },
  { id: "cpi", label: "CPI", currency: "USD", match: ["cpi", "cpi mom", "cpi yoy", "core cpi"] },
  { id: "fomc", label: "FOMC Interest Rate Decision", currency: "USD", match: ["fed interest rate decision", "federal funds rate"] },
  { id: "gdp", label: "GDP", currency: "USD", match: ["gdp growth rate qoq", "gdp growth rate q/q", "gdp growth rate"] },
  { id: "unemployment", label: "Unemployment Claims", currency: "USD", match: ["initial jobless claims", "jobless claims"], invert: true },
  { id: "retail-sales", label: "Retail Sales", currency: "USD", match: ["retail sales mom", "retail sales"] },
  { id: "ppi", label: "PPI", currency: "USD", match: ["ppi mom", "ppi"] },
  { id: "ism-mfg", label: "ISM Manufacturing PMI", currency: "USD", match: ["ism manufacturing pmi"] },
  { id: "ism-services", label: "ISM Services PMI", currency: "USD", match: ["ism services pmi"] },
  { id: "consumer-confidence", label: "Consumer Confidence", currency: "USD", match: ["cb consumer confidence", "consumer confidence"] },
  { id: "crude-oil", label: "Crude Oil Inventories", currency: "USD", match: ["eia crude oil stocks change", "crude oil stocks change"], invert: true },
  { id: "ecb", label: "ECB Interest Rate Decision", currency: "EUR", match: ["ecb interest rate decision"] },
  { id: "boe", label: "Bank of England Rate Decision", currency: "GBP", match: ["boe interest rate decision", "bank rate"] },
  { id: "fed-chair", label: "Fed Chair Speeches", currency: "USD", match: ["fed chair", "fomc member"] },
];

// ------------------------------------------------------------------ helpers

/** Parse a released value like "3.2%", "-0.4", "250K", "1.2M" into a number. */
function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[%,$]/g, "").replace(/\s/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const match = /^(-?\d*\.?\d+)([kmb])?$/i.exec(cleaned);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  const factor = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return base * factor;
}

function formatValue(value: string): string {
  return value.trim() || "—";
}

function releaseTime(event: CalendarEvent): string {
  const date = new Date(event.date);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ResolvedRelease = {
  event: EventDef;
  calendar: CalendarEvent;
  actual: string;
  forecast: string;
  previous: string;
  /** BUY/SELL for the event's currency, or null before it releases. */
  direction: "BUY" | "SELL" | null;
  released: boolean;
  detail: string;
  releaseDate: string;
};

/**
 * The newest calendar entry for an event. Releases print before the calendar
 * refreshes, so a matching entry with no `actual` still means "not yet
 * released" rather than "no data". A released row is ALWAYS preferred over an
 * upcoming one, so the screen shows the last real number first.
 */
function matchScore(title: string, fragments: string[]): number {
  const lower = title.toLowerCase();
  let best = 0;
  for (const fragment of fragments) {
    const needle = fragment.toLowerCase();
    const score = lower === needle ? 3 : lower.startsWith(needle) ? 2 : lower.includes(needle) ? 1 : 0;
    if (score > best) best = score;
  }
  return best;
}

function resolveRelease(event: EventDef, calendar: CalendarEvent[]): ResolvedRelease | null {
  const matches = calendar
    .filter(
      (entry) =>
        entry.currency === event.currency &&
        matchScore(entry.title, event.match) > 0,
    )
    .map((entry) => ({ entry, score: matchScore(entry.title, event.match) }));
  if (matches.length === 0) return null;

  // A RELEASED row always wins over an upcoming one, and among those the
  // closest title match ("CPI" over "CPI s.a") wins, then the newest print.
  const byImportance = [...matches].sort((a, b) => {
    const releasedA = toNumber(a.entry.actual) !== null ? 1 : 0;
    const releasedB = toNumber(b.entry.actual) !== null ? 1 : 0;
    if (releasedA !== releasedB) return releasedB - releasedA;
    if (a.score !== b.score) return b.score - a.score;
    return new Date(b.entry.date).getTime() - new Date(a.entry.date).getTime();
  });
  const chosen = byImportance[0]!.entry;

  const actual = formatValue(chosen.actual);
  const forecast = formatValue(chosen.forecast);
  const previous = formatValue(chosen.previous);
  const actualNumber = toNumber(chosen.actual);
  const forecastNumber = toNumber(chosen.forecast);
  const isReleased = actualNumber !== null;

  let direction: "BUY" | "SELL" | null = null;
  let detail = "Not yet released";
  if (isReleased && forecastNumber !== null) {
    const delta = actualNumber - forecastNumber;
    if (delta === 0) {
      detail = "Actual matched forecast — no directional edge";
    } else {
      const positive = event.invert ? delta < 0 : delta > 0;
      direction = positive ? "BUY" : "SELL";
      detail = `Actual ${delta > 0 ? "above" : "below"} forecast by ${Math.abs(delta).toLocaleString("en-US", {
        maximumFractionDigits: 4,
      })}`;
    }
  } else if (isReleased) {
    detail = "Actual is not a number — no directional read";
  }

  return {
    event,
    calendar: chosen,
    actual,
    forecast,
    previous,
    direction,
    released: isReleased,
    detail,
    releaseDate: releaseTime(chosen),
  };
}

/** Allowed Quotes whose symbol contains the event's currency. */
function affectedSymbols(currency: string, allowed: string[]): string[] {
  const upper = currency.toUpperCase();
  return allowed.filter((symbol) => symbol.toUpperCase().includes(upper));
}

type FeedState = "loading" | "ready" | "error";

// ------------------------------------------------------------------ page

function FundamentalsPage() {
  const app = useAppState();
  const { tradingPairs } = useTradingPairsStore();
  /** The signed-in email — the server reads the MT5 record for this user. */
  const userId = app.email;

  /** ALLOWED QUOTES: the mentor's active list, plus the symbols the user's own
   *  robots trade — so an event always resolves to real, tradeable symbols. */
  const allowedSymbols = useMemo(() => {
    const fromMentor = tradingPairs.filter((pair) => pair.active).map((pair) => pair.symbol);
    const fromRobots = app.robots.flatMap((robot) => (robot.pairs ?? []).map((pair) => pair.symbol));
    const seen = new Set<string>();
    const all: string[] = [];
    for (const symbol of [...fromMentor, ...fromRobots]) {
      const clean = (symbol ?? "").trim();
      if (!clean) continue;
      if (seen.has(clean.toUpperCase())) continue;
      seen.add(clean.toUpperCase());
      all.push(clean);
    }
    return all;
  }, [tradingPairs, app.robots]);

  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  /** When the events on screen were fetched from the feed (ms), or null. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  /** True when the feed failed and the page is showing the last good cache. */
  const [feedStale, setFeedStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Analyse-and-execute ────────────────────────────────────────────────────
  // The card owns the whole analyze → lot/trades → execute → per-trade MT5
  // confirmation flow (shared with the symbols list). This page only decides
  // WHICH symbol the event maps to.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const loadCalendar = useCallback(async (force: boolean) => {
    // Keep whatever is already on screen while a refresh runs — the list only
    // goes to "loading" when there is nothing to show yet.
    setFeedState((current) => (current === "ready" ? current : "loading"));
    try {
      // FROM /api/calendar — NOT A SERVER FUNCTION.
      //
      // The deployed app is a static client site plus the single /api
      // gateway function; TanStack server functions are not served there, so
      // `POST /_serverFn/<id>` came back as the SPA shell and this page stayed
      // on "Could not load the economic calendar" whatever the feed code did.
      // /api/calendar is a route this deployment really serves.
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const reply = (await response.json()) as CalendarReply;
      if (!response.ok || !reply.ok || reply.events.length === 0) {
        // No data AND no cache: the honest retry state.
        setCalendar([]);
        setFetchedAt(null);
        setFeedStale(false);
        setFeedState("error");
        return;
      }
      setCalendar(reply.events);
      setFetchedAt(reply.fetchedAt);
      setFeedStale(reply.stale);
      setFeedState("ready");
    } catch (error) {
      console.warn("[fundamentals] calendar fetch failed", error);
      setCalendar([]);
      setFetchedAt(null);
      setFeedStale(false);
      setFeedState("error");
    }
  }, []);

  useEffect(() => {
    void loadCalendar(false);
  }, [loadCalendar]);

  // KEEP THE DECORATIVE FALLING-DOLLAR CANVAS OFF THIS SCREEN.
  //
  // The animated background is a fixed, full-screen canvas that the app paints
  // behind (and, in "play over screen" mode, ABOVE) every route. On this page
  // it reads as decoration over the calendar text, competing with the numbers
  // the trader is trying to read. The class below is removed on unmount, so
  // the effect returns to every other screen untouched.
  useEffect(() => {
    document.body.classList.add("eamp-no-bg-effect");
    return () => document.body.classList.remove("eamp-no-bg-effect");
  }, []);

  const feedTimestamp = useMemo(() => {
    if (!fetchedAt) return null;
    return new Date(fetchedAt).toLocaleString("en-GB", {
      timeZone: "Africa/Johannesburg",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [fetchedAt]);

  // Reset the symbol choice whenever the selected event changes.
  useEffect(() => {
    setSelectedSymbol(null);
    setShowPopup(false);
  }, [selectedId]);

  const selected = selectedId ? EVENTS.find((event) => event.id === selectedId) ?? null : null;
  const release = useMemo(
    () => (selected && calendar.length > 0 ? resolveRelease(selected, calendar) : null),
    [selected, calendar],
  );
  const symbols = useMemo(
    () => (selected ? affectedSymbols(selected.currency, allowedSymbols) : []),
    [selected, allowedSymbols],
  );

  const eventName = selected?.label ?? "event";
  const analysisSymbol = selectedSymbol ?? symbols[0] ?? null;

  const directionColor = (direction: "BUY" | "SELL") =>
    direction === "BUY" ? "#4ade80" : "#f87171";

  return (
    <div
      data-eamp-bg-host
      className="flex min-h-screen flex-col overflow-x-hidden bg-[#0a0a0a] pb-safe-nav text-white"
      style={{ fontFamily: "var(--app-font)" }}
    >
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-2 pt-safe">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          aria-label={selected ? "Back to events" : "Back"}
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-[#141414]"
        >
          {selected ? <ChevronLeft className="size-5 text-white/80" /> : <Zap className="size-5 text-white/70" />}
        </button>
        <div className="text-center">
          <p className="text-[15px] font-black tracking-wide">FUNDAMENTALS</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
            {selected ? selected.label : "News-event trading"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadCalendar(true)}
          aria-label="Refresh releases"
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-[#141414]"
        >
          <RefreshCw className={`size-4 text-white/70 ${feedState === "loading" ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4">
        {/* ── EVENT LIST ─────────────────────────────────────────────── */}
        {!selected && (
          <div className="space-y-2 pb-6">
            <div className="mb-1 flex items-center justify-between px-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
                {feedTimestamp ? `ForexFactory feed · as of ${feedTimestamp}` : "Tap an event for its release"}
              </p>
              {feedState === "error" && (
                <button
                  type="button"
                  onClick={() => void loadCalendar(true)}
                  className="text-[11px] font-bold text-amber-300"
                >
                  Retry
                </button>
              )}
            </div>

            {feedStale && (
              <p className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
                The live feed could not be reached — showing the last calendar saved
                {feedTimestamp ? ` at ${feedTimestamp}` : ""}. Tap refresh to try again.
              </p>
            )}

            {feedState === "loading" && calendar.length === 0 && (
              <div className={`${CARD} flex items-center gap-2 text-[12px] text-white/50`}>
                <Loader2 className="size-4 animate-spin" /> Loading this week&apos;s releases…
              </div>
            )}

            {feedState === "error" && (
              <button
                type="button"
                onClick={() => void loadCalendar(true)}
                className={`${CARD} w-full text-left text-[12px] text-amber-200`}
              >
                Could not load the economic calendar — tap to retry
              </button>
            )}

            {EVENTS.map((event) => {
              const resolved = calendar.length > 0 ? resolveRelease(event, calendar) : null;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedId(event.id)}
                  className={`${CARD} flex w-full items-center justify-between gap-3 text-left active:scale-[0.99]`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-bold text-white/95">{event.label}</span>
                      <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-white/60">
                        {event.currency}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/40">
                      {!resolved
                        ? "No release in this week's calendar"
                        : resolved.released
                          ? `${resolved.direction ?? "NO EDGE"} · ${resolved.actual} vs ${resolved.forecast}`
                          : `Upcoming · forecast ${resolved.forecast}${
                              resolved.previous !== "—" ? ` · previous ${resolved.previous}` : ""
                            }`}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-white/30" />
                </button>
              );
            })}
          </div>
        )}

        {/* ── EVENT DETAIL ───────────────────────────────────────────── */}
        {selected && (
          <div className="space-y-3 pb-6">
            {/* ALWAYS SOMETHING: loading / error / content — never a blank body. */}
            {feedState === "loading" && (
              <div className={`${CARD} flex items-center gap-2 text-[12px] text-white/55`}>
                <Loader2 className="size-4 animate-spin" /> Loading {eventName} data…
              </div>
            )}

            {feedState === "error" && (
              <button
                type="button"
                onClick={() => void loadCalendar(true)}
                className={`${CARD} w-full text-left text-[12px] text-amber-200`}
              >
                Could not load {eventName} data — tap to retry
              </button>
            )}

            {feedState === "ready" && !release && (
              <button
                type="button"
                onClick={() => void loadCalendar(true)}
                className={`${CARD} w-full text-left text-[12px] text-white/60`}
              >
                No {eventName} release in this week&apos;s calendar — tap to refresh
              </button>
            )}

            {feedState === "ready" && release && (
              <>
                {/* Release detail */}
                <div className={CARD}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={HEADING}>
                      {release.event.label} · {release.event.currency}
                    </p>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">
                      {release.calendar.impact} impact
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                    {release.released ? "Released" : "Next release"} {release.releaseDate} SAST
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { label: "ACTUAL", value: release.actual },
                      { label: "FORECAST", value: release.forecast },
                      { label: "PREVIOUS", value: release.previous },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl bg-white/[0.04] px-2 py-2 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">{item.label}</p>
                        <p className="mt-0.5 text-[13px] font-black tabular-nums text-white/90">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] text-white/55">{release.detail}</p>
                </div>

                {/* Affected quotes — which of YOUR Allowed Quotes moves on this
                    currency. The TRADE direction is never taken from the release
                    headline: it comes from the live broker candles below. */}
                <div className={CARD}>
                  <p className={HEADING}>Affected quotes</p>
                  <p className="mt-1 text-[12px] text-white/55">
                    {release.released
                      ? `${release.actual} vs forecast ${release.forecast} — the trade direction comes from the live broker candles below.`
                      : `Upcoming release${release.releaseDate ? ` ${release.releaseDate} SAST` : ""} · forecast ${release.forecast}${
                          release.previous !== "—" ? ` · previous ${release.previous}` : ""
                        }`}
                  </p>
                  {release.direction && (
                    <p className="mt-2 text-[12px] font-bold" style={{ color: directionColor(release.direction) }}>
                      Calendar read: {release.direction} {release.event.currency}
                    </p>
                  )}
                  {symbols.length === 0 ? (
                    <p className="mt-2 text-[12px] text-amber-200">
                      No Allowed Quote is affected by {release.event.currency} — add one on the Quotes page.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {symbols.map((symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          onClick={() => setSelectedSymbol(symbol)}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${
                            selectedSymbol === symbol ? "bg-white/10" : "bg-white/[0.04]"
                          }`}
                        >
                          <span className="text-[12px] font-bold text-white/85">{symbol}</span>
                          <ChevronRight className="size-4 text-white/30" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Analyze + Execute flow */}
                {symbols.length > 0 && (
                  <>
                    {/* Symbol chooser when more than one Allowed Quote matches */}
                    {symbols.length > 1 && (
                      <div className={CARD}>
                        <p className={HEADING}>Choose symbol</p>
                        <p className="mt-1 text-[11px] text-white/45">
                          More than one Allowed Quote moves {release.event.currency} — pick the one to analyze.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {symbols.map((symbol) => (
                            <button
                              key={symbol}
                              type="button"
                              onClick={() => setSelectedSymbol(symbol)}
                              className={`rounded-xl border px-3 py-2 text-[12px] font-bold transition-none active:scale-[0.99] ${
                                selectedSymbol === symbol
                                  ? "border-white/40 bg-white/10 text-white"
                                  : "border-white/10 bg-[#1a1a1a] text-white/70"
                              }`}
                            >
                              {symbol}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Analyze → execute, from live broker candles. The direction
                        is read off those candles and is never editable here. */}
                    <AnalyzeExecuteCard
                      userId={userId}
                      symbol={analysisSymbol}
                      defaultLot={app.settings.lotSize ?? "0.01"}
                      defaultTrades="1"
                      contextLabel={`Analyze · ${release.event.label}`}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}

        <DraggableBotPopup />

      </main>
      <FixedBottomNav />
    </div>
  );
}

function FundamentalsErrorFallback() {
  return (
    <div data-eamp-bg-host className="min-h-screen bg-[#0a0a0a] pb-28 text-white" style={{ fontFamily: "var(--app-font)" }}>
      <p className="pt-10 text-center text-[15px] font-black uppercase tracking-[0.28em] text-white/90">FUNDAMENTALS</p>
      <main className="mx-auto w-full max-w-md px-4">
        <p className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-6 text-center text-[13px] text-amber-200">
          The event feed could not load. Check your connection and try again.
        </p>
      </main>
      <DraggableBotPopup />
      <FixedBottomNav />
    </div>
  );
}

export const Route = createFileRoute("/app/fundamentals")({
  ssr: false,
  beforeLoad: () => {
    const apply = (access: AppAccessCheck) => {
      if (access.action === "signin") throw redirect({ href: "/app/login" });
      if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
      if (access.action === "pay") throw redirect({ href: "/app/login?pay=1" });
    };
    const email = getAppState().email;
    const cached = peekAccessVerdict(email);
    if (cached) {
      apply(cached);
      return;
    }
    return requireVerifiedAccess(email).then(apply);
  },
  head: () => ({
    meta: [
      { title: "Fundamentals — EA Migrate" },
      { name: "description", content: "News-event releases with the signal for your allowed quotes and MT5 execution." },
    ],
  }),
  errorComponent: FundamentalsErrorFallback,
  component: FundamentalsPage,
});
