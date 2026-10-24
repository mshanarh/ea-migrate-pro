import { useEffect, useMemo, useState } from "react";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Zap } from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { fetchWeekCalendar, type CalendarEvent } from "@/lib/news.server";
import { executeFundamentalsTrades, type FundamentalsOrderResult } from "@/lib/mt5-bridge.server";
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
  { id: "nfp", label: "Non-Farm Payrolls", currency: "USD", match: ["non-farm employment change", "nonfarm payrolls"] },
  { id: "cpi", label: "CPI", currency: "USD", match: ["cpi m/m", "cpi y/y", "core cpi"] },
  { id: "fomc", label: "FOMC Interest Rate Decision", currency: "USD", match: ["federal funds rate", "fomc statement", "fomc economic projections"] },
  { id: "gdp", label: "GDP", currency: "USD", match: ["prelim gdp", "final gdp", "gdp q/q"] },
  { id: "unemployment", label: "Unemployment Claims", currency: "USD", match: ["unemployment claims"], invert: true },
  { id: "retail-sales", label: "Retail Sales", currency: "USD", match: ["retail sales"] },
  { id: "ppi", label: "PPI", currency: "USD", match: ["ppi m/m", "core ppi"] },
  { id: "ism-mfg", label: "ISM Manufacturing PMI", currency: "USD", match: ["ism manufacturing pmi"] },
  { id: "ism-services", label: "ISM Services PMI", currency: "USD", match: ["ism services pmi"] },
  { id: "consumer-confidence", label: "Consumer Confidence", currency: "USD", match: ["cb consumer confidence", "consumer confidence"] },
  { id: "crude-oil", label: "Crude Oil Inventories", currency: "USD", match: ["crude oil inventories"], invert: true },
  { id: "ecb", label: "ECB Interest Rate Decision", currency: "EUR", match: ["main refinancing rate", "ecb press conference", "ecb monetary policy"] },
  { id: "boe", label: "Bank of England Rate Decision", currency: "GBP", match: ["official bank rate", "boe monetary policy", "mpc votes"] },
  { id: "fed-chair", label: "Fed Chair Speeches", currency: "USD", match: ["fed chair", "fomc member", "fed chair powell"] },
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
};

/**
 * The newest calendar entry for an event. Releases print before the calendar
 * refreshes, so a matching entry with no `actual` still means "not yet
 * released" rather than "no data".
 */
function resolveRelease(event: EventDef, calendar: CalendarEvent[]): ResolvedRelease | null {
  const matches = calendar
    .filter(
      (entry) =>
        entry.currency === event.currency &&
        event.match.some((fragment) => entry.title.toLowerCase().includes(fragment)),
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const chosen = matches[0];
  if (!chosen) return null;

  const actual = formatValue(chosen.actual);
  const forecast = formatValue(chosen.forecast);
  const previous = formatValue(chosen.previous);
  const actualNumber = toNumber(chosen.actual);
  const forecastNumber = toNumber(chosen.forecast);
  const released = actualNumber !== null;

  let direction: "BUY" | "SELL" | null = null;
  let detail = "not yet released";
  if (released && forecastNumber !== null) {
    const delta = actualNumber - forecastNumber;
    if (delta === 0) {
      detail = "actual matched forecast — no directional edge";
    } else {
      const positive = event.invert ? delta < 0 : delta > 0;
      direction = positive ? "BUY" : "SELL";
      detail = `actual ${delta > 0 ? "above" : "below"} forecast by ${
        Math.abs(delta) === 0 ? "0" : Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 4 })
      }`;
    }
  } else if (!released) {
    detail = "not yet released";
  } else {
    detail = "actual is not a number — no directional read";
  }

  return { event, calendar: chosen, actual, forecast, previous, direction, released, detail };
}

/** Allowed Quotes whose symbol contains the event's currency. */
function affectedSymbols(currency: string, allowed: string[]): string[] {
  const upper = currency.toUpperCase();
  return allowed.filter((symbol) => symbol.toUpperCase().includes(upper));
}

// ------------------------------------------------------------------ page

function FundamentalsPage() {
  useAppState();
  const { tradingPairs } = useTradingPairsStore();
  const allowedSymbols = useMemo(
    () => tradingPairs.filter((pair) => pair.active).map((pair) => pair.symbol),
    [tradingPairs],
  );

  const [calendar, setCalendar] = useState<CalendarEvent[] | null>(null);
  const [calendarError, setCalendarError] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [lot, setLot] = useState("0.01");
  const [trades, setTrades] = useState("1");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<FundamentalsOrderResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCalendar = async () => {
    setLoadingFeed(true);
    setCalendarError(false);
    try {
      const reply = await fetchWeekCalendar();
      if (!reply.ok) {
        setCalendarError(true);
        setCalendar(null);
        return;
      }
      setCalendar(reply.events);
    } catch {
      setCalendarError(true);
      setCalendar(null);
    } finally {
      setLoadingFeed(false);
    }
  };

  useEffect(() => {
    void loadCalendar();
  }, []);

  useEffect(() => {
    setResult(null);
    setFormError(null);
  }, [selectedId]);

  const selected = selectedId ? EVENTS.find((event) => event.id === selectedId) ?? null : null;
  const release = useMemo(
    () => (selected && calendar ? resolveRelease(selected, calendar) : null),
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

  const execute = async () => {
    setFormError(null);
    setResult(null);
    if (!selected) return;
    if (!release || !release.direction) {
      setFormError("The event has not given a direction yet — nothing to execute");
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
    const symbol = symbols[0];
    if (!symbol) {
      setFormError("No Allowed Quote is affected by this event");
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
          direction: release.direction,
          lotSize: lotValue,
          trades: tradesValue,
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
          onClick={() => void loadCalendar()}
          aria-label="Refresh releases"
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-[#141414]"
        >
          <RefreshCw className={`size-4 text-white/70 ${loadingFeed ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4">
        {!selected && (
          <div className="space-y-2 pb-6">
            <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
              Tap an event for its latest release
            </p>
            {EVENTS.map((event) => {
              const resolved = calendar ? resolveRelease(event, calendar) : null;
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
                      {calendarError
                        ? "Could not load event data"
                        : resolved
                          ? resolved.released
                            ? `${resolved.direction ?? "NO EDGE"} · ${resolved.actual} vs ${resolved.forecast}`
                            : `Not yet released · forecast ${resolved.forecast}`
                          : "No release in this week's calendar"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-white/30" />
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="space-y-3 pb-6">
            {loadingFeed && !calendar && (
              <div className={`${CARD} flex items-center gap-2 text-[12px] text-white/50`}>
                <Loader2 className="size-4 animate-spin" /> Loading this week's releases…
              </div>
            )}

            {(calendarError || (calendar && !release)) && (
              <div className={`${CARD} text-[12px] text-amber-200`}>
                {calendarError
                  ? "Could not load event data"
                  : "No matching release in this week's calendar — nothing to trade yet."}
              </div>
            )}

            {release && (
              <>
                <div className={CARD}>
                  <p className={HEADING}>{release.event.label} · {release.event.currency}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                    {releaseTime(release.calendar)} SAST · {release.calendar.impact} impact
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
                  <p className="mt-3 text-[12px] text-white/55">
                    {release.detail}
                  </p>
                </div>

                <div className={CARD}>
                  <p className={HEADING}>Signal</p>
                  {release.direction ? (
                    <>
                      <p className="mt-1 text-[13px] font-extrabold text-white/90">
                        {release.direction} · {release.event.currency} moving{" "}
                        {release.direction === "BUY" ? "higher" : "lower"} than forecast
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
                                style={{ color: release.direction === "BUY" ? "#4ade80" : "#f87171" }}
                              >
                                {release.direction}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[12px] text-white/50">{release.detail}</p>
                  )}
                </div>

                {release.direction && symbols.length > 0 && (
                  <div className={CARD}>
                    <p className={HEADING}>Execute</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Lot size</span>
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
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Trades</span>
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
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Total volume</span>
                      <span className="text-[14px] font-black tabular-nums text-white/90">{totalVolume.toFixed(2)}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                        Signal / Order side
                      </span>
                      <span className="text-[12px] font-black text-white/90">
                        {release.direction} · {release.direction}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void execute()}
                      disabled={executing}
                      className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-white text-[13px] font-black tracking-wide text-black disabled:opacity-50"
                    >
                      {executing ? <Loader2 className="size-5 animate-spin" /> : `EXECUTE ${release.direction} ${symbols[0]}`}
                    </button>

                    {formError && <p className="mt-2 text-[12px] text-red-300">{formError}</p>}
                  </div>
                )}

                {result && result.orders.length > 0 && (
                  <div className={CARD}>
                    <p className={HEADING}>MT5 confirmation</p>
                    <p className="mt-1 text-[11px] text-white/40">
                      {result.brokerSymbol ? `Broker symbol ${result.brokerSymbol}` : ""}
                      {result.livePrice ? ` · live ${result.livePrice}` : ""}
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {result.orders.map((order) => (
                        <div
                          key={order.index}
                          className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2"
                        >
                          <span className="text-[12px] font-bold text-white/85">
                            #{order.index} {release.direction}
                          </span>
                          <span className="text-[11px] font-semibold tabular-nums text-white/55">
                            {order.status === "executed"
                              ? `ticket ${order.ticket} @ ${order.entry}`
                              : order.error ?? "not executed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
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

// Kept referenced so the redirect helper stays part of this module's contract.
void isRedirect;
