import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Zap } from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { fetchWeekCalendar, type CalendarEvent } from "@/lib/news.server";
import { analyzeFundamentalsSignal, executeFundamentalsTrades, type FundamentalsOrderResult } from "@/lib/mt5-bridge.server";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Analyse-and-execute state ──────────────────────────────────────────────
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<
    | {
        symbol: string;
        direction: "BUY" | "SELL";
        entry: number;
        stopLoss: number;
        takeProfit1: number;
        takeProfit2: number;
        slDistance: number;
        levelsValid: boolean;
        livePrice: number;
        analysedAt: number;
        reason: string;
      }
    | null
  >(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Pre-fill from the bot's current configured defaults (lot from app settings,
  // trades defaults to 1 — matching the existing behavior).
  const [lot, setLot] = useState(app.settings.lotSize ?? "0.01");
  const [trades, setTrades] = useState("1");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<FundamentalsOrderResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCalendar = useCallback(async (force: boolean) => {
    setFeedState("loading");
    try {
      const reply = await fetchWeekCalendar({ data: { force } });
      if (!reply.ok || reply.events.length === 0) {
        setCalendar([]);
        setFeedState("error");
        return;
      }
      setCalendar(reply.events);
      setFeedState("ready");
    } catch (error) {
      console.warn("[fundamentals] calendar fetch failed", error);
      setCalendar([]);
      setFeedState("error");
    }
  }, []);

  useEffect(() => {
    void loadCalendar(false);
  }, [loadCalendar]);

  // Reset the analyse/execute state whenever the selected event changes.
  useEffect(() => {
    setSelectedSymbol(null);
    setAnalysis(null);
    setAnalyzeError(null);
    setResult(null);
    setFormError(null);
    setLot(app.settings.lotSize ?? "0.01");
    setTrades("1");
  }, [selectedId, app.settings.lotSize]);

  const selected = selectedId ? EVENTS.find((event) => event.id === selectedId) ?? null : null;
  const release = useMemo(
    () => (selected && calendar.length > 0 ? resolveRelease(selected, calendar) : null),
    [selected, calendar],
  );
  const symbols = useMemo(
    () => (selected ? affectedSymbols(selected.currency, allowedSymbols) : []),
    [selected, allowedSymbols],
  );

  const lotValue = Number.parseFloat(lot);
  const tradesValue = Number.parseInt(trades, 10);
  const totalVolume =
    Number.isFinite(lotValue) && lotValue > 0 && Number.isFinite(tradesValue) && tradesValue > 0
      ? Number((lotValue * tradesValue).toFixed(4))
      : 0;

  // ── ANALYZE ─────────────────────────────────────────────────────────────────
  const analyze = async () => {
    setAnalyzeError(null);
    setAnalysis(null);
    if (!selected) return;
    if (!release || !release.direction) {
      setAnalyzeError("The event has not given a direction yet — nothing to analyze");
      return;
    }
    const symbol = selectedSymbol ?? symbols[0];
    if (!symbol) {
      setAnalyzeError(`No Allowed Quote is affected by ${selected.currency}`);
      return;
    }
    if (!symbols.includes(symbol)) {
      setAnalyzeError(`${symbol} is no longer in your Allowed Quotes — pick another`);
      return;
    }
    const userId = getAppState().email;
    if (!userId) {
      setAnalyzeError("Sign in again to analyze");
      return;
    }

    setAnalyzing(true);
    try {
      const reply = await analyzeFundamentalsSignal({
        data: { userId, symbol },
      });
      if (!reply.ok) {
        setAnalyzeError(reply.message);
        return;
      }
      setAnalysis(reply);
      setAnalyzeError(null);
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  // ── EXECUTE ─────────────────────────────────────────────────────────────────
  const execute = async () => {
    setFormError(null);
    setResult(null);
    if (!selected) return;

    // Direction must come from the analysis and the executed side must match it.
    if (!analysis || !analysis.direction) {
      setFormError("No analyzed signal yet — press Analyze first");
      return;
    }

    // Block execution when the analysis is stale (older than 5 minutes).
    const ageMs = Date.now() - analysis.analysedAt;
    if (ageMs > 5 * 60 * 1000) {
      setFormError(
        `The analysis is ${Math.round(ageMs / 1000)}s old — press Analyze again for fresh levels before executing`,
      );
      return;
    }

    if (!Number.isFinite(lotValue) || lotValue <= 0) {
      setFormError("Lot size must be greater than 0");
      return;
    }
    if (!Number.isInteger(tradesValue) || tradesValue <= 0) {
      setFormError("Number of trades must be a whole number above 0");
      return;
    }

    const symbol = selectedSymbol ?? symbols[0];
    if (!symbol) {
      setFormError(`No Allowed Quote is affected by ${selected.currency}`);
      return;
    }
    if (!symbols.includes(symbol)) {
      setFormError(`${symbol} is no longer in your Allowed Quotes — analyze again`);
      return;
    }

    const userId = getAppState().email;
    if (!userId) {
      setFormError("Sign in again to execute");
      return;
    }

    setExecuting(true);
    try {
      const reply = await executeFundamentalsTrades({
        data: {
          userId,
          symbol,
          // The analysed side is the only side this button can send.
          direction: analysis.direction,
          lotSize: lotValue,
          trades: tradesValue,
          stopLoss: analysis.stopLoss,
          takeProfit: analysis.takeProfit1,
        },
      });
      setResult(reply);
      if (!reply.ok) setFormError(reply.message);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Order failed");
    } finally {
      setExecuting(false);
    }
  };

  const eventName = selected?.label ?? "event";

  const directionColor = (direction: "BUY" | "SELL") =>
    direction === "BUY" ? "#4ade80" : "#f87171";

  const levelsNumeric = (analysis && analysis.levelsValid)
    ? {
        entry: analysis.entry,
        sl: analysis.stopLoss,
        tp1: analysis.takeProfit1,
        tp2: analysis.takeProfit2,
      }
    : null;

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
                Tap an event for its latest release
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
                      {feedState === "error"
                        ? "Could not load event data"
                        : !resolved
                          ? "No release in this week's calendar"
                          : resolved.released
                            ? `${resolved.direction ?? "NO EDGE"} · ${resolved.actual} vs ${resolved.forecast}`
                            : `Not yet released · forecast ${resolved.forecast}`}
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

                {/* Calendar-side signal summary */}
                <div className={CARD}>
                  <p className={HEADING}>Calendar signal</p>
                  {release.direction ? (
                    <>
                      <p className="mt-1 text-[13px] font-extrabold text-white/90">
                        {release.direction} · {release.event.currency}{" "}
                        {release.direction === "BUY" ? "stronger" : "weaker"} than forecast
                      </p>
                      {symbols.length === 0 ? (
                        <p className="mt-2 text-[12px] text-amber-200">
                          No Allowed Quote is affected by {release.event.currency}
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {symbols.map((symbol) => (
                            <div key={symbol} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                              <span className="text-[12px] font-bold text-white/85">{symbol}</span>
                              <span
                                className="text-[12px] font-black"
                                style={{ color: directionColor(release.direction!) }}
                              >
                                {release.direction}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-[13px] font-extrabold text-white/90">
                        Not yet released, next release: {release.releaseDate}
                      </p>
                      <p className="mt-1 text-[12px] text-white/55">
                        Forecast to watch: <span className="font-black text-white/85">{release.forecast}</span>
                        {release.previous !== "—" ? ` · previous ${release.previous}` : ""}
                      </p>
                    </>
                  )}
                </div>

                {/* Analyze + Execute flow */}
                {release.direction && symbols.length > 0 && (
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

                    {/* Analyze card */}
                    <div className={CARD}>
                      <p className={HEADING}>Analyze</p>
                      <p className="mt-1 text-[11px] text-white/45">
                        {selectedSymbol != null ? (
                          <span className="font-semibold text-white/70">{selectedSymbol}</span>
                        ) : (
                          <span className="font-semibold text-white/70">{symbols[0]}</span>
                        )}{" "}
                        — fetch fresh broker candles for this currency and read the last completed M15 move.
                      </p>

                      {analyzeError && (
                        <p className="mt-2 text-[12px] text-red-300">{analyzeError}</p>
                      )}

                      {analysis && (
                        <div className="mt-3 rounded-xl border border-white/10 bg-[#1a1a1a] p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-extrabold text-white/90">
                              {analysis.direction}
                            </p>
                            <span
                              className="shrink-0 text-[11px] font-black"
                              style={{ color: directionColor(analysis.direction) }}
                            >
                              {analysis.direction}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                            Analyzed {analysis.symbol} · direction from broker candles
                          </p>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {[
                              { label: "Entry", value: levelsNumeric?.entry },
                              { label: "Stop loss", value: levelsNumeric?.sl },
                              { label: "TP1 (1× SL)", value: levelsNumeric?.tp1 },
                              { label: "TP2 (2× SL)", value: levelsNumeric?.tp2 },
                            ].map((item) => (
                              <div key={item.label} className="rounded-xl bg-white/[0.04] px-3 py-2">
                                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">
                                  {item.label}
                                </p>
                                <p className="mt-0.5 text-[13px] font-black tabular-nums text-white/90">
                                  {item.value != null ? formatPrice(item.value) : "—"}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-2 text-[10px] text-white/40">
                            {analysis.reason}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => void analyze()}
                          disabled={analyzing || !release.direction || symbols.length === 0}
                          className="flex h-11 w-full items-center justify-center rounded-full bg-white text-[13px] font-black tracking-wide text-black disabled:opacity-40"
                        >
                          {analyzing ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            `Analyze ${selectedSymbol ?? symbols[0]}`
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Execute card — only after a fresh analysis exists */}
                    {analysis && analysis.direction && (
                      <div className={CARD}>
                        <p className={HEADING}>Execute</p>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                              Lot size
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0.01"
                              value={lot}
                              onChange={(event) => setLot(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] font-bold tabular-nums text-white outline-none focus:border-white/30"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                              Number of trades
                            </span>
                            <input
                              type="number"
                              inputMode="numeric"
                              step="1"
                              min="1"
                              value={trades}
                              onChange={(event) => setTrades(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] font-bold tabular-nums text-white outline-none focus:border-white/30"
                            />
                          </label>
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                            Total volume
                          </span>
                          <span className="text-[14px] font-black tabular-nums text-white/90">
                            {totalVolume.toFixed(2)}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                            Analyzed direction
                          </span>
                          <span className="text-[12px] font-black text-white/90">
                            {analysis.direction} · {analysis.symbol}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                            Order side
                          </span>
                          <span
                            className="text-[12px] font-black"
                            style={{ color: directionColor(analysis.direction) }}
                          >
                            {analysis.direction} (must match analysis)
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => void execute()}
                          disabled={executing}
                          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-white text-[13px] font-black tracking-wide text-black disabled:opacity-50"
                        >
                          {executing ? (
                            <Loader2 className="size-5 animate-spin" />
                          ) : (
                            `EXECUTE ${analysis.direction} ${analysis.symbol}`
                          )}
                        </button>

                        {formError && <p className="mt-2 text-[12px] text-red-300">{formError}</p>}
                      </div>
                    )}

                    {/* MT5 confirmation */}
                    {result && result.orders.length > 0 && (
                      <div className={CARD}>
                        <p className={HEADING}>MT5 confirmation</p>
                        <p className="mt-1 text-[11px] text-white/40">
                          {result.brokerSymbol ? `Broker symbol ${result.brokerSymbol}` : ""}
                          {result.livePrice != null ? ` · live ${formatPrice(result.livePrice)}` : ""}
                          {result.freeMargin != null ? ` · free margin ${result.freeMargin.toFixed(2)}` : ""}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {result.orders.map((order) => (
                            <div
                              key={order.index}
                              className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2"
                            >
                              <span className="text-[12px] font-bold text-white/85">
                                #{order.index} {analysis?.direction ?? "—"}
                              </span>
                              <span className="text-[11px] font-semibold tabular-nums text-white/55">
                                {order.status === "executed"
                                  ? `ticket ${order.ticket} @ ${formatPrice(order.entry)}`
                                  : order.error ?? "not executed"}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-white/40">{result.message}</p>
                      </div>
                    )}
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

function formatPrice(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toFixed(2);
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
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
