import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  Menu,
  RefreshCw,
} from "lucide-react";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { WHOP_CHECKOUT_URL, getAppState, requireAppAccess, useAppState } from "@/lib/app-store";
import { fetchUpcomingNews, type NewsEvent } from "@/lib/news.server";

export const Route = createFileRoute("/app/fundamentals")({
  ssr: false,
  beforeLoad: () => {
    const access = requireAppAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "pay") throw redirect({ href: WHOP_CHECKOUT_URL });
  },
  head: () => ({
    meta: [
      { title: "Fundamentals — EA Migrate Pro" },
      { name: "description", content: "This week's economic calendar with live market sessions." },
    ],
  }),
  component: FundamentalsPage,
});

/* ------------------------------------------------------------------ */
/* Market sessions — real forex hours (GMT), glow + countdown          */
/* ------------------------------------------------------------------ */

type SessionDef = {
  id: string;
  label: string;
  flag: string;
  /** GMT open/close hour pair. open < close = same-day window; open > close wraps midnight. */
  open: number;
  close: number;
  currencies: string[];
};

const SESSIONS: SessionDef[] = [
  { id: "sydney", label: "SYDNEY", flag: "🇦🇺", open: 22, close: 7, currencies: ["AUD", "NZD"] },
  { id: "tokyo", label: "TOKYO", flag: "🇯🇵", open: 0, close: 9, currencies: ["JPY"] },
  { id: "london", label: "LONDON", flag: "🇬🇧", open: 8, close: 17, currencies: ["GBP", "EUR"] },
  { id: "newyork", label: "NEW YORK", flag: "🇺🇸", open: 13, close: 22, currencies: ["USD", "CAD"] },
];

type SessionState = {
  session: SessionDef;
  isOpen: boolean;
  /** Hours until open (closed) or until close (open). */
  hours: number;
};

function sessionStates(now: Date): SessionState[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return SESSIONS.map((session) => {
    const inWindow =
      session.open < session.close
        ? h >= session.open && h < session.close
        : h >= session.open || h < session.close;
    // Distance to the next boundary of the window.
    const distTo = (edge: number) => (edge - h + 24) % 24;
    return {
      session,
      isOpen: inWindow,
      hours: inWindow ? Math.max(distTo(session.close), 0.02) : Math.max(distTo(session.open), 0.02),
    };
  });
}

function hoursLabel(hours: number, open: boolean): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Flags — emoji render inconsistently at small sizes on some Androids; */
/* use flagcdn raster images for crisp circular flags like the design. */
/* ------------------------------------------------------------------ */

const FLAG_IMG: Record<string, string> = {
  AUD: "au", NZD: "nz", JPY: "jp", GBP: "gb", EUR: "eu",
  USD: "us", CAD: "ca", CHF: "ch", CNY: "cn", MXN: "mx", ZAR: "za",
};

function CurrencyFlag({ currency, size }: { currency: string; size: number }) {
  const code = FLAG_IMG[currency] ?? "un";
  return (
    <img
      src={`https://flagcdn.com/w80/${code}.png`}
      alt={currency}
      width={size}
      height={size * 0.75}
      loading="lazy"
      className="rounded-[3px] object-cover shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
      style={{ width: size, height: size * 0.72 }}
    />
  );
}

function CircleFlag({ code, size, glowing }: { code: string; size: number; glowing: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        boxShadow: glowing
          ? "0 0 0 2px rgba(255,255,255,0.85), 0 0 26px rgba(255,255,255,0.55), 0 0 60px rgba(120,180,255,0.35)"
          : "0 0 0 1px rgba(255,255,255,0.12)",
        filter: glowing ? "none" : "saturate(0.9) brightness(0.92)",
      }}
    >
      <img
        src={`https://flagcdn.com/w160/${code}.png`}
        alt=""
        className="size-full object-cover"
        style={{ transform: "scale(1.08)" }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Impact bulls                                                        */
/* ------------------------------------------------------------------ */

function ImpactBulls({ impact }: { impact: string }) {
  const level = impact.toLowerCase();
  // 1 bull = low (gray) · 2 = medium (orange) · 3 = high (red) · holiday = blue
  if (level === "holiday") {
    return (
      <span className="flex gap-0.5 text-[13px] leading-none" title="Holiday">
        <span className="text-blue-400">🐂</span>
        <span className="text-white/25">🐂</span>
        <span className="text-white/25">🐂</span>
      </span>
    );
  }
  const count = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color = level === "high" ? "text-red-500" : level === "medium" ? "text-amber-500" : "text-white/45";
  return (
    <span className="flex gap-0.5 text-[13px] leading-none">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={color}>🐂</span>
      ))}
      {Array.from({ length: 3 - count }, (_, i) => (
        <span key={`e${i}`} className="text-white/25">🐂</span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Mock fallback — realistic FF-shaped week when the feed is blocked    */
/* ------------------------------------------------------------------ */

type CalEvent = {
  id: string;
  time: string; // "15:20" local display
  dayOffset: number; // 0 = today
  currency: string;
  title: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast?: string;
  previous?: string;
};

function mockWeek(): CalEvent[] {
  const mk = (
    dayOffset: number,
    time: string,
    currency: string,
    title: string,
    impact: CalEvent["impact"],
    forecast?: string,
    previous?: string,
  ): CalEvent => ({
    id: `mock-${dayOffset}-${time}-${currency}-${title}`,
    dayOffset,
    time,
    currency,
    title,
    impact,
    ...(forecast !== undefined ? { forecast } : {}),
    ...(previous !== undefined ? { previous } : {}),
  });
  return [
    mk(0, "10:00", "EUR", "M3 Money Supply y/y", "Low", "3.5%", "3.4%"),
    mk(0, "10:00", "EUR", "Private Loans y/y", "Low", "3.2%", "3.1%"),
    mk(0, "11:15", "GBP", "BOE Gov Bailey Speaks", "High"),
    mk(0, "11:15", "USD", "FOMC Member Williams Speaks", "Low"),
    mk(0, "14:30", "USD", "Core Durable Goods Orders m/m", "Medium", "0.6%", "0.4%"),
    mk(0, "14:30", "USD", "Durable Goods Orders m/m", "Medium", "1.1%", "0.9%"),
    mk(0, "15:20", "USD", "FOMC Member Schmid Speaks", "Low"),
    mk(0, "16:00", "USD", "Revised UoM Consumer Sentiment", "Medium", "47.4", "47.8"),
    mk(0, "16:00", "USD", "Revised UoM Inflation Expectations", "Medium", undefined, "4.6%"),
    mk(0, "20:00", "USD", "FOMC Member Hammack Speaks", "Low"),
    mk(1, "01:01", "GBP", "GfK Consumer Confidence", "Low", "-16", "-14"),
    mk(1, "01:01", "CNY", "Bank Holiday", "Holiday"),
    mk(1, "07:00", "JPY", "BOJ Core CPI y/y", "Low", "1.5%", "1.6%"),
    mk(1, "08:00", "EUR", "German GfK Consumer Climate", "Low", "-27.1", "-26.6"),
    mk(1, "14:30", "CAD", "RMPI m/m", "Medium", "1.8%", "2.1%"),
    mk(1, "15:00", "NZD", "RBNZ Offshore Holdings", "Low"),
    mk(2, "00:30", "AUD", "Building Approvals m/m", "Medium", "2.4%", "1.9%"),
    mk(2, "12:00", "GBP", "Mortgage Approvals", "Low", "61K", "60K"),
    mk(2, "14:15", "USD", "Fed Chair Powell Speaks", "High"),
    mk(3, "02:30", "JPY", "Tankan Manufacturing Index", "High", "13", "12"),
    mk(3, "14:30", "USD", "Unemployment Claims", "Medium", "221K", "218K"),
    mk(3, "15:45", "EUR", "ECB Lane Speaks", "Medium"),
    mk(4, "03:35", "AUD", "RBA Bull Speaks", "Medium"),
    mk(4, "14:30", "USD", "Core PCE Price Index m/m", "High", "0.3%", "0.2%"),
    mk(5, "07:00", "GBP", "Halifax HPI m/m", "Medium", "0.2%", "0.3%"),
    mk(5, "16:00", "USD", "FOMC Member Logan Speaks", "Low"),
    mk(6, "16:00", "NZD", "Daylight Saving Time Shift", "Holiday"),
  ];
}

/** Maps the server news feed to calendar rows for the whole week. */
function toCalendarRows(events: NewsEvent[]): CalEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayName = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  };
  const offsets = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) offsets.set(dayName(i).toDateString(), i);

  return events.map((event, index) => {
    const when = new Date(event.date);
    const offset = offsets.get(when.toDateString()) ?? 0;
    const impact: CalEvent["impact"] =
      event.impact.toLowerCase() === "high"
        ? "High"
        : event.impact.toLowerCase() === "medium"
          ? "Medium"
          : event.impact.toLowerCase() === "holiday"
            ? "Holiday"
            : "Low";
    return {
      id: event.id || `feed-${index}`,
      dayOffset: offset,
      time: `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`,
      currency: event.currency,
      title: event.title,
      impact,
      ...(event.forecast ? { forecast: event.forecast } : {}),
      ...(event.previous ? { previous: event.previous } : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function FundamentalsPage() {
  const navigate = useNavigate();
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [highImpactOnly, setHighImpactOnly] = useState(false);
  const [range, setRange] = useState<"today" | "tomorrow" | "week">("week");
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadSeq = useRef(0);

  // Live clock — ticks every second like the design's HH:MM:SS pill.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = async () => {
    const seq = ++loadSeq.current;
    setRefreshing(true);
    try {
      const result = await fetchUpcomingNews();
      if (loadSeq.current !== seq) return;
      const rows = result.events.length > 0 ? toCalendarRows(result.events) : mockWeek();
      setEvents(rows);
    } catch {
      if (loadSeq.current !== seq) return;
      setEvents(mockWeek());
    } finally {
      if (loadSeq.current === seq) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessions = sessionStates(now);
  const openSessions = sessions.filter((s) => s.isOpen);
  const nextSession = sessions
    .filter((s) => !s.isOpen)
    .sort((a, b) => a.hours - b.hours)[0];
  const hero = openSessions[0] ?? null;

  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const filtered = useMemo(() => {
    if (!events) return [];
    let rows = events;
    if (sessionFilter) {
      const active = SESSIONS.find((s) => s.id === sessionFilter);
      if (active) rows = rows.filter((row) => active.currencies.includes(row.currency));
    }
    if (highImpactOnly) rows = rows.filter((row) => row.impact === "High");
    if (range === "today") rows = rows.filter((row) => row.dayOffset === 0);
    if (range === "tomorrow") rows = rows.filter((row) => row.dayOffset === 1);
    return rows;
  }, [events, sessionFilter, highImpactOnly, range]);

  const highCount = useMemo(
    () => (events ?? []).filter((row) => row.impact === "High" && (range !== "today" || row.dayOffset === 0)).length,
    [events, range],
  );

  const grouped = useMemo(() => {
    const groups: Array<{ key: string; label: string; rows: CalEvent[] }> = [];
    const sorted = [...filtered].sort((a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time));
    for (const row of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.key === String(row.dayOffset)) {
        last.rows.push(row);
      } else {
        const d = new Date();
        d.setDate(d.getDate() + row.dayOffset);
        const label = d
          .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
          .toUpperCase();
        groups.push({ key: String(row.dayOffset), label, rows: [row] });
      }
    }
    return groups;
  }, [filtered]);

  return (
    <div className="app-shell-locked min-h-screen w-full overflow-y-auto bg-[#0a0a0a] pb-28 text-white">
      {/* ── top bar ── */}
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-1 pt-6">
        <button
          type="button"
          onClick={() => window.history.back()}
          aria-label="Back"
          className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <ChevronLeft className="size-5 text-white/80" />
        </button>
        <button
          type="button"
          aria-label="Calendar"
          className="flex size-10 items-center justify-center rounded-xl text-white/85"
        >
          <CalendarDays className="size-5" />
        </button>
        <span className="text-[15px] font-bold tracking-[0.35em] text-white/90">FUNDAMENTALS</span>
        <button
          type="button"
          aria-label="Menu"
          className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <Menu className="size-5 text-white/80" />
        </button>
      </div>

      <p className="mt-3 text-center text-[15px] text-white/55">This week's economic calendar</p>

      <main className="mx-auto w-full max-w-md px-5">
        {/* ── sessions header row ── */}
        <div className="mt-5 flex items-end justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">Market Sessions</p>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/85">
              {openSessions.length} OPEN
            </p>
            {nextSession && (
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                NEXT · {nextSession.session.label} IN {hoursLabel(nextSession.hours, false)}
              </p>
            )}
          </div>
        </div>

        {/* ── hero flag: currently open session ── */}
        <div className="mt-3 flex flex-col items-center">
          {hero ? (
            <>
              <span
                className="relative flex h-[124px] w-[190px] items-center justify-center overflow-hidden rounded-xl shadow-[0_0_36px_rgba(255,255,255,0.35)]"
                style={{ border: "2px solid rgba(255,255,255,0.9)" }}
              >
                <img
                  src={`https://flagcdn.com/w320/${FLAG_IMG[hero.session.currencies[0] === "AUD" ? "au" : hero.session.currencies[0] === "JPY" ? "jp" : hero.session.currencies[0] === "GBP" ? "gb" : "us"]}.png`}
                  alt={hero.session.label}
                  className="size-full object-cover"
                />
              </span>
              <p className="mt-3 text-[15px] font-extrabold uppercase tracking-[0.24em]">
                {hero.session.label} OPEN
              </p>
              <p className="text-[13px] text-white/55">Closes in {hoursLabel(hero.hours, true)}</p>
            </>
          ) : (
            <>
              <span className="flex h-[124px] w-[190px] items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[13px] font-bold uppercase tracking-[0.2em] text-white/50">
                Market Break
              </span>
              <p className="mt-3 text-[15px] font-extrabold uppercase tracking-[0.24em] text-white/70">
                All Sessions Closed
              </p>
              {nextSession && (
                <p className="text-[13px] text-white/55">
                  {nextSession.session.label} opens in {hoursLabel(nextSession.hours, false)}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── session circles ── */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {sessions.map(({ session, isOpen, hours }) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setSessionFilter((current) => (current === session.id ? null : session.id))}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-2 transition-colors"
              style={{ backgroundColor: sessionFilter === session.id ? "rgba(255,255,255,0.06)" : undefined }}
            >
              <CircleFlag
                code={session.id === "newyork" ? "us" : session.id === "tokyo" ? "jp" : session.id === "london" ? "gb" : "au"}
                size={54}
                glowing={isOpen}
              />
              <span className={`mt-1 text-[10px] font-bold uppercase tracking-[0.16em] ${isOpen ? "text-white" : "text-white/55"}`}>
                {session.label}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-[0.1em] ${isOpen ? "text-white/90" : "text-white/45"}`}>
                {isOpen ? `OPEN · ${hoursLabel(hours, true)}` : `IN ${hoursLabel(hours, false)}`}
              </span>
            </button>
          ))}
        </div>

        {/* ── filters row ── */}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHighImpactOnly((v) => !v)}
            className={`flex h-11 items-center gap-2 rounded-full border px-4 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors ${
              highImpactOnly
                ? "border-red-500/60 bg-red-500/15 text-white"
                : "border-white/12 bg-white/[0.04] text-white/75"
            }`}
          >
            <span className="size-2 rounded-full bg-red-500" />
            HIGH IMPACT · {highCount}
          </button>
          <span className="flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-bold tabular-nums tracking-wide text-white/90">
            <span className="size-2 rounded-full bg-white" />
            {clock}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh calendar"
            className="ml-auto flex size-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] text-white/75"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* ── range buttons ── */}
        <div className="mt-3 flex items-center gap-2">
          {(
            [
              ["today", "TODAY"],
              ["tomorrow", "TOMORROW"],
              ["week", "ALL WEEK"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`h-10 rounded-full px-4 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                range === key
                  ? "border border-white/25 bg-white/12 text-white"
                  : "border border-white/10 bg-white/[0.03] text-white/50"
              }`}
            >
              {label}
            </button>
          ))}
          {sessionFilter && (
            <button
              type="button"
              onClick={() => setSessionFilter(null)}
              className="ml-auto h-10 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70"
            >
              Clear {SESSIONS.find((s) => s.id === sessionFilter)?.label}
            </button>
          )}
        </div>

        {/* ── event list ── */}
        <div className="mt-5 space-y-6">
          {loading && <p className="py-10 text-center text-sm text-white/40">Loading this week's calendar…</p>}
          {!loading && grouped.length === 0 && (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/45">
              No events match these filters.
            </p>
          )}
          {grouped.map((group) => (
            <section key={group.key}>
              <p className="mb-2.5 text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/80">
                {group.label}
              </p>
              <div className="space-y-3">
                {group.rows.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-2xl bg-[#151515] p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-12 shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums text-white/85">
                        {row.time}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3">
                          <span className="text-[14px] font-extrabold tracking-wide">{row.currency}</span>
                          <span className="min-w-0 flex-1 truncate text-[15px] text-white/90">{row.title}</span>
                        </div>
                        {(row.forecast || row.previous) && (
                          <p className="mt-2 flex gap-4 text-[12px] font-semibold">
                            {row.forecast && (
                              <span className="text-white/55">
                                FC <span className="text-white/85">{row.forecast}</span>
                              </span>
                            )}
                            {row.previous && (
                              <span className="text-white/55">
                                PREV <span className="text-white/85">{row.previous}</span>
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <CurrencyFlag currency={row.currency} size={26} />
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <ImpactBulls impact={row.impact} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <FixedBottomNav />
    </div>
  );
}
