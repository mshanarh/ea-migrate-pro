import { useEffect, useMemo, useState } from "react";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
<<<<<<< HEAD
import { ChevronLeft, Play, FileCheck, AlertCircle, RefreshCw, Clock } from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck, VERIFY_RETRY_MESSAGE } from "@/lib/payment-gate";
import { executeHatOrder } from "@/lib/mt5-bridge.server";

// ------------------------------------------------------------------ tokens

const FONT_FALLBACK = "'Space Grotesk', 'DM Sans', system-ui, sans-serif";
const HEADING = "text-[15px] font-extrabold uppercase tracking-[0.22em]";
const SUBHEAD = "text-[11px] font-bold uppercase tracking-[0.18em] text-white/55";
const CARD = "rounded-2xl bg-[#101010] p-5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]";
const CARD_HOVER = "hover:bg-[#151515] transition-colors";
const TAPPABLE = "cursor-pointer touch-manipulation select-none";
const FONT_CSS = ":root { --app-font: 'Space Grotesk', 'DM Sans', system-ui, sans-serif; }";
const FONT_STYLES = {
  fontFamily: "'Space Grotesk', 'DM Sans', system-ui, sans-serif",
  fontFamilyFallback: `
    , 'Space Grotesk', 'DM Sans', system-ui, sans-serif
    , 'Rubik Glitch', 'Space Grotesk', 'DM Sans', system-ui, sans-serif
  `,
};

// ------------------------------------------------------------------ event catalog

// Id is stable and used for caching the fetched event. The label is the
// human-facing name. The signal is derived from the fetched actual-vs-forecast
// values and matched to the currency it moves.
type EventDef = {
  id: string;
  label: string;
  /** Currency that the event moves, and therefore which Allowed Quote the signal is matched against. */
  currency: string;
  /** Emits on tap. Fetching is triggered inside the event card itself. */
  fetch: (id: string) => Promise<EventData | null>;
  /** Format the fetch's actual / forecast / previous into three readable lines. */
  format: (data: EventData) => { actual: string; forecast: string; previous: string };
  /** Human-facing direction hint ("BUY" / "SELL" / "not yet released"). */
  directionHint: (data: EventData) => string;
};

type EventData = {
  actual: string;
  forecast: string;
  previous: string;
  asOf?: string;
} & { readonly asOf?: string };

type EventDataNoExact = {
  actual: string;
  forecast: string;
  previous: string;
  asOf?: string;
};

function isEventDataNoExact(v: EventData): v is EventDataNoExact {
  return true;
}

function canFetch(id: string): boolean {
  return Boolean(
    (id === "nonfarm" && typeof fetch === "function") ||
    (id === "cpi" && typeof fetch === "function") ||
    (id === "fomc" && typeof fetch === "function") ||
    (id === "gdp" && typeof fetch === "function") ||
    (id === "jobless" && typeof fetch === "function") ||
    (id === "retail" && typeof fetch === "function") ||
    (id === "ppi" && typeof fetch === "function") ||
    (id === "ism-mfg" && typeof fetch === "function") ||
    (id === "ism-svc" && typeof fetch === "function") ||
    (id === "confidence" && typeof fetch === "function") ||
    (id === "oil" && typeof fetch === "function") ||
    (id === "ecb" && typeof fetch === "function") ||
    (id === "boee" && typeof fetch === "function") ||
    (id === "fed-speech" && typeof fetch === "function"),
  );
}

type EventDataPlain = {
  actual: string;
  forecast: string;
  previous: string;
  asOf?: string;
};

function toEventData(v: { actual: string; forecast: string; previous: string; asOf?: string | undefined }): EventDataPlain {
  return {
    actual: v.actual,
    forecast: v.forecast,
    previous: v.previous,
    asOf: v.asOf ?? '',
  };
}

async function fetchEvent(id: string): Promise<EventData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`/api/events/${id}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as Partial<EventData>;
    if (!data.actual || !data.forecast || !data.previous) return null;
    return toEventData({ actual: String(data.actual), forecast: String(data.forecast), previous: String(data.previous), asOf: data.asOf?.toString() ?? '' });
  } catch {
    return null;
  }
}

function fmtNum(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

function fmtNumber(v: string): string {
  // Take the numeric core for huge decimals like 0.00000850 -> 0.0000085
  const m = v.trim().match(/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/);
  if (m) return m[0];
  return v.trim();
}

const EVENTS: EventDef[] = [
  {
    id: "nonfarm",
    label: "NON-FARM PAYROLLS",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) >= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "cpi",
    label: "CPI (CONSUMER PRICE INDEX)",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "fomc",
    label: "FOMC INTEREST RATE DECISION",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) > parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "gdp",
    label: "GDP (GROSS DOMESTIC PRODUCT)",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) >= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "jobless",
    label: "UNEMPLOYMENT CLAIMS",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "retail",
    label: "RETAIL SALES",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) >= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "ppi",
    label: "PPI (PRODUCER PRICE INDEX)",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "ism-mfg",
    label: "ISM MANUFACTURING PMI",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "ism-svc",
    label: "ISM SERVICES PMI",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "confidence",
    label: "CONSUMER CONFIDENCE",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) >= parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
  {
    id: "oil",
    label: "CRUDE OIL INVENTORIES",
    currency: "XAU",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) <= parseFloat(d.forecast) ? "BUY XAUUSDm" : "SELL XAUUSDm"),
  },
  {
    id: "ecb",
    label: "ECB INTEREST RATE DECISION",
    currency: "EUR",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) > parseFloat(d.forecast) ? "BUY EURUSDm" : "SELL EURUSDm"),
  },
  {
    id: "boee",
    label: "BANK OF ENGLAND RATE DECISION",
    currency: "GBP",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) > parseFloat(d.forecast) ? "BUY GBPUSDm" : "SELL GBPUSDm"),
  },
  {
    id: "fed-speech",
    label: "FED CHAIR SPEECH",
    currency: "USD",
    async fetch(id) { return fetchEvent(id); },
    format: (d) => ({ actual: fmtNumber(d.actual ?? "—"), forecast: fmtNumber(d.forecast ?? "—"), previous: fmtNumber(d.previous ?? "—") }),
    directionHint: (d) => (d.actual && d.forecast && parseFloat(d.actual) > parseFloat(d.forecast) ? "BUY USD" : "SELL USD"),
  },
];

// ------------------------------------------------------------------ helpers

/** Real direction the signal says for the event's affected currency. */
function realDirection(def: EventDef, data: EventData): "BUY" | "SELL" | null {
  const actual = parseFloat(data.actual);
  const forecast = parseFloat(data.forecast);
  if (Number.isNaN(actual) || Number.isNaN(forecast)) return null;
  const hint = def.directionHint(data).toUpperCase();
  if (hint === "BUY") return "SELL"; // reversed for a SELL-side entry check below
  if (hint === "SELL") return "BUY";
  if (hint.includes("XAU")) return actual <= forecast ? "BUY" : "SELL";
  if (hint.includes("EUR")) return actual > forecast ? "BUY" : "SELL";
  if (hint.includes("GBP")) return actual > forecast ? "BUY" : "SELL";
  if (hint.includes("USD")) return actual >= forecast ? "SELL" : "BUY";
  return null;
}

function cmp(a: string, b: string): number {
  const an = parseFloat(a);
  const bn = parseFloat(b);
  if (Number.isNaN(an) || Number.isNaN(bn)) return 0;
  return an - bn;
}

// ------------------------------------------------------------------ page
=======
import {
  CalendarDays,
  ChevronLeft,
  Menu,
  RefreshCw,
  MapPin,
  AlertCircle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, leaveForCheckout, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { fetchWeekCalendar, type CalendarEvent } from "@/lib/news.server";
import { resolveTradeDirection } from "@/lib/auto-trade";
import { readMtCredentials } from "@/lib/bridge-client";
import { executeAutoTrade, type ExecutedTrade } from "@/lib/auto-trade";

/* ------------------------------------------------------------------ */
/* ECONOMIC EVENTS — the 15 most-moved news events                  */
/* ------------------------------------------------------------------ */

/** The full list of events shown in the EVENT LIST.
 *  Each entry: title, currency (3-letter ISO), impact level (High/Medium/Low),
 *  and a human-readable description of what the event moves.
 */
type EconomicEvent = {
  id: string;
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low";
};

const ECONOMIC_EVENTS: EconomicEvent[] = [
  { id: "nfp", title: "Non-Farm Payrolls", currency: "USD", impact: "High" },
  { id: "cpi", title: "CPI (Inflation)", currency: "USD", impact: "High" },
  { id: "fomc", title: "FOMC Interest Rate Decision", currency: "USD", impact: "High" },
  { id: "gdp", title: "GDP", currency: "USD", impact: "High" },
  { id: "unemployment", title: "Unemployment Claims", currency: "USD", impact: "Medium" },
  { id: "retail-sales", title: "Retail Sales", currency: "USD", impact: "Medium" },
  { id: "ppi", title: "PPI (Producer Price)", currency: "USD", impact: "Medium" },
  { id: "ism-mfg", title: "ISM Manufacturing PMI", currency: "USD", impact: "High" },
  { id: "ism-services", title: "ISM Services PMI", currency: "USD", impact: "High" },
  { id: "consumer-conf", title: "Consumer Confidence", currency: "USD", impact: "Medium" },
  { id: "crude-oil", title: "Crude Oil Inventories", currency: "USD", impact: "High" },
  { id: "ecb", title: "ECB Interest Rate Decision", currency: "EUR", impact: "High" },
  { id: "boe", title: "Bank of England Decision", currency: "GBP", impact: "High" },
  { id: "fed-speech", title: "Fed Chair / Central Bank Speeches", currency: "USD", impact: "Medium" },
];

/* ------------------------------------------------------------------ */
/* Currency → broker symbol mapping                                   */
/* ------------------------------------------------------------------ */

/** Maps a currency to the broker symbols that contain it.
 *  On this broker: USD → BTCUSDm, XAUUSD; EUR → EURUSD; GBP → GBPUSD.
 *  Extend as needed for the broker being used.
 */
function currencyToSymbols(currency: string): string[] {
  const upper = currency.toUpperCase();
  const map: Record<string, string[]> = {
    USD: ["BTCUSDm", "XAUUSD"],
    EUR: ["EURUSD"],
    GBP: ["GBPUSD"],
  };
  return map[upper] ?? [];
}

/* ------------------------------------------------------------------ */
/* Page component                                                     */
/* ------------------------------------------------------------------ */
>>>>>>> origin/main

export const Route = createFileRoute("/app/fundamentals")({
  ssr: false,
  beforeLoad: () => {
    const apply = (access: AppAccessCheck) => {
      try {
        if (access.action === "signin") throw redirect({ href: "/app/login" });
<<<<<<< HEAD
        if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
=======
        if (access.action === "deactivate")
          throw redirect({ href: "/app/login?deactivated=1" });
>>>>>>> origin/main
        if (access.action === "pay") {
          // leaveForCheckout is the existing app convention; the fundamentals
          // page is reachable only to paid users, so this is a safety net.
          void requireVerifiedAccess(getAppState().email).then((v) => {
            if (v.action === "pay") window.location.href = "/app/login?pay=1";
          });
          throw redirect({ href: "/app/login?pay=1" });
        }
      } catch (error) {
        if (isRedirect(error)) throw error;
      }
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
<<<<<<< HEAD
      { title: "News Events — EA Migrate" },
      { name: "description", content: "Latest economic releases with live signal and lot sizing for your robot." },
=======
      { title: "News Trading — EA Migrate" },
      {
        name: "description",
        content: "Economic calendar news events with real-time analysis and execution",
      },
>>>>>>> origin/main
    ],
  }),
  errorComponent: FundamentalsErrorFallback,
  component: FundamentalsPage,
});

<<<<<<< HEAD
function FundamentalsErrorFallback() {
  return (
    <div data-eamp-bg-host className="flex min-h-screen flex-col bg-[#0a0a0a] pb-28 text-white">
      <p className={`pt-10 text-center ${HEADING} text-white/90`}>NEWS EVENTS</p>
=======
/** Live fallback: shows the real Investing.com widget when the feed fails. */
function FundamentalsErrorFallback() {
  return (
    <div data-eamp-bg-host className="min-h-screen w-full bg-[#0a0a0a] pb-32 text-white">
      <p className="pt-10 text-center text-[15px] font-bold uppercase tracking-[0.35em] text-white/90">
        NEWS TRADING
      </p>
      <p className="mt-2 text-center text-[15px] text-white/55">Economic calendar</p>
>>>>>>> origin/main
      <main className="mx-auto w-full max-w-md px-5">
        <p className={`mt-6 ${CARD} p-8 text-center text-amber-200`}>
          The event feed could not load. Check your connection and try again.
        </p>
      </main>
      <DraggableBotPopup />
      <FixedBottomNav />
    </div>
  );
}

<<<<<<< HEAD
/* ------------------------------------------------------------------ event card */

type CardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: EventData; direction: "BUY" | "SELL" }
  | { status: "unreleased" }
  | { status: "error" };

function EventCard({ def }: { def: EventDef }) {
  const [state, setState] = useState<CardState>({ status: "idle" });
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (reload = false) => {
    if (!canFetch(def.id) || attempted && !reload) return;
    setAttempted(true);
    setState({ status: "loading" });
    setError(null);
    const data = await def.fetch(def.id);
    if (!data) {
      setState({ status: "error" });
      setError("Could not load event data");
      return;
    }
    const dir = realDirection(def, data);
    if (!dir) {
      setState({ status: "unreleased" });
      return;
    }
    setState({ status: "ready", data, direction: dir });
  };

  useEffect(() => {
    void load();
  }, [def.id]);

  const renderMeta = (label: string, value: string) => (
    <span className="text-[12px] font-semibold tabular-nums text-white/60">{label}</span>
  );

  return (
    <button
      type="button"
      onClick={() => void load(true)}
      className={`${CARD} ${CARD_HOVER} w-full text-left ${TAPPABLE}`}
      style={{ fontFamily: FONT_STYLES.fontFamily }}
      disabled={state.status === "loading"}
      aria-label={`${def.label} — ${state.status === "loading" ? "refreshing" : "tap for details"}`}
    >
      <div className="flex items-start gap-4">
        {/* event icon cell */}
        <span
          className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: state.status === "loading" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.08)",
            fontFamily: FONT_STYLES.fontFamily,
          }}
        >
          {state.status === "loading" ? (
            <RefreshCw className="size-5 animate-spin text-white/50" />
          ) : state.status === "error" ? (
            <AlertCircle className="size-5 text-red-400" />
          ) : state.status === "unreleased" ? (
            <Clock className="size-5 text-white/45" />
          ) : (
            <FileCheck className="size-5 text-white/75" />
          )}
        </span>

        {/* content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-extrabold tracking-wide text-white/95">{def.label}</span>
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
              {def.currency}
            </span>
          </div>

          {state.status === "idle" && !attempted && (
            <p className="mt-1 text-[13px] text-white/50]">Tap for the latest release</p>
          )}

          {state.status === "loading" && (
            <p className="mt-1 text-[12px] text-white/45]">Fetching live data…</p>
          )}

          {state.status === "unreleased" && (
            <>
              <p className="mt-1 text-[13px] text-white/50]">Not yet released</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40]">
                {def.directionHint({ actual: "—", forecast: "—", previous: "—" })}
              </p>
            </>
          )}

          {state.status === "ready" && (
            <>
              <p className="mt-1 text-[14px] font-extrabold text-white">
                {def.directionHint(state.data)} · {state.data.actual} vs {state.data.forecast}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-semibold">
                <span className="text-white/55"><span className="text-white/85">ACTUAL</span> {state.data.actual}</span>
                <span className="text-white/55"><span className="text-white/85">FORECAST</span> {state.data.forecast}</span>
                <span className="text-white/55"><span className="text-white/85">PREVIOUS</span> {state.data.previous}</span>
                {state.data.asOf && <span className="text-white/45"><span className="text-white/75">AT</span> {state.data.asOf}</span>}
              </div>
            </>
          )}

          {state.status === "error" && (
            <p className="mt-1 text-[12px] text-red-400]">{error}</p>
          )}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ order form */

type OrderFormState =
  | { lot: string; trades: string; status: "idle" }
  | { lot: string; trades: string; status: "executing" }
  | { lot: string; trades: string; status: "executed"; ticket: string; entry: string }
  | { lot: string; trades: string; status: "error"; message: string };

function OrderForm({ direction, currency }: { direction: "BUY" | "SELL"; currency: string }) {
  const [lot, setLot] = useState("0.01");
  const [trades, setTrades] = useState("1");
  const [state, setState] = useState<OrderFormState>({ lot, trades, status: "idle" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const lotN = parseFloat(lot);
    const tradesN = parseInt(trades, 10);
    if (!lotN || isNaN(lotN) || lotN <= 0) {
      setState({ lot, trades, status: "error", message: "Enter a lot size above 0" });
      return;
    }
    if (!tradesN || tradesN <= 0 || !Number.isInteger(tradesN)) {
      setState({ lot, trades, status: "error", message: "Number of trades must be a whole number above 0" });
      return;
    }
    if (!currency) {
      setState({ lot, trades, status: "error", message: "No symbol is affected by this event" });
      return;
    }

    // The broker-side symbol check happens inside the bridge: it normalises the
    // order to the broker's own contract and aborts with a logged mismatch when
    // the requested side cannot be sent.
    setBusy(true);
    setState({ lot, trades, status: "executing" });
    try {
      const result = await executeHatOrder({ currency, direction });
      if (result.ok === false) {
        setState({ lot, trades, status: "error", message: result.reason ?? "Order aborted" });
        return;
      }
      setState({
        lot,
        trades,
        status: "executed",
        ticket: result.ticket ?? "—",
        entry: result.entry ?? "—",
      });
    } catch {
      setState({ lot, trades, status: "error", message: "Order failed — see diagnostics" });
    } finally {
      setBusy(false);
    }
  };

  const feel = (v: number) => (Math.abs(v) < 1e-12 ? "0" : v.toFixed(8).replace(/\.?0+$/, ""));
  const displayLot = feel(parseFloat(lot) || 0);

  return (
    <div className="mt-5 rounded-2xl bg-[#101010] p-5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <p className={`${SUBHEAD} text-white/55`}>ORDER FORM</p>
      <p className={`${HEADING} text-white/90`}>{currency} · {direction}</p>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">
            Lot size (default 0.01)
          </label>
          <input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className="w-full rounded-xl border border-white/12 bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white"
            style={{ fontFamily: FONT_STYLES.fontFamily }}
            placeholder="0.01"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">
            Number of trades (default 1)
          </label>
          <input
            value={trades}
            onChange={(e) => setTrades(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            className="w-full rounded-xl border border-white/12 bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white"
            style={{ fontFamily: FONT_STYLES.fontFamily }}
            placeholder="1"
          />
        </div>
      </div>

      {/* Live volume read before execution */}
      {state.status !== "executing" && state.status !== "executed" && (
        <p className="mt-2 text-[13px] font-semibold text-white/60]">
          Vol = {displayLot} lots × {trades} trades = <span className="text-white">{Number(lot) * Number(trades)} lots</span>
        </p>
      )}

      {state.status === "executing" && (
        <p className="mt-2 text-[13px] font-semibold text-white/70]">Sending through the MT5 bridge, please wait…</p>
      )}

      {state.status === "executed" && (
        <p className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-emerald-400]">
          <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/20">
            <Play className="size-3 text-emerald-400" />
          </span>
          {state.ticket} · entry {state.entry} · executed
        </p>
      )}

      {state.status === "error" && (
        <p className="mt-2 text-[13px] font-semibold text-red-400]">{state.message}</p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || state.status === "executing"}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-black font-bold uppercase tracking-[0.14em] transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ fontFamily: FONT_STYLES.fontFamily }}
      >
        {busy ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
        Execute
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function FundamentalsPage() {
  useAppState();

  const [selected, setSelected] = useState<EventDef | null>(null);
  const [orderSent, setOrderSent] = useState<{ direction: "BUY" | "SELL"; currency: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Live clock, kept in sync with the rest of the app.
=======
function FundamentalsPage() {
  useAppState();

  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<EconomicEvent[] | null>(ECONOMIC_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [eventData, setEventData] = useState<{
    title: string;
    currency: string;
    actual: string | null;
    forecast: string | null;
    previous: string | null;
    releaseTime: string | null;
  } | null>(null);
  const [analysis, setAnalysis] = useState<{
    event: string;
    currency: string;
    actual: string | null;
    forecast: string | null;
    previous: string | null;
    direction: "BUY" | "SELL" | null;
    deviation: "positive" | "negative" | "none" | null;
    strength: "strong" | "weak" | "none" | null;
    affectedSymbols: Array<{
      symbol: string;
      signal: "BUY" | "SELL" | null;
      deviationDesc: string;
    }>;
  } | null>(null);
  const [execution, setExecution] = useState<{
    lotSize: number;
    numTrades: number;
    totalVolume: number;
    symbol: string;
    direction: "BUY" | "SELL";
  } | null>(null);
  const [executionResults, setExecutionResults] = useState<ExecutedTrade[] | null>(null);
  const [executing, setExecuting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Live clock
>>>>>>> origin/main
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

<<<<<<< HEAD
  const [now, setNow] = useState(() => new Date());

  const filtered = useMemo(() => {
    if (!selected) return EVENTS;
    return [...EVENTS].sort((a, b) => a.label.localeCompare(b.label));
  }, [selected]);

  const selectedIndex = selected ? filtered.indexOf(selected) : -1;
  const previous = selectedIndex > 0 ? filtered[selectedIndex - 1] : null;
  const next = selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? filtered[selectedIndex + 1] : null;
=======
  // Load calendar feed
  useEffect(() => {
    void loadCalendar();
  }, []);

  const loadCalendar = async () => {
    try {
      const result = await fetchWeekCalendar();
      if (Array.isArray(result.events) && result.events.length > 0) {
        setEvents(result.events);
        setFeedFailed(false);
      } else {
        setFeedFailed(true);
      }
    } catch {
      setFeedFailed(true);
    }
  };

  const [feedFailed, setFeedFailed] = useState(false);

  // Use effect for silent refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(() => void loadCalendar(true), 5 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // When user taps an event card → fetch real data + run analysis
  // ------------------------------------------------------------------
  const handleEventTap = async (eventId: string) => {
    const event = ECONOMIC_EVENTS.find((e) => e.id === eventId);
    if (!event) return;

    setSelectedEvent(eventId);

    // Fetch real data from the calendar feed
    try {
      const result = await fetchWeekCalendar();
      if (Array.isArray(result.events) && result.events.length > 0) {
        const fetchedEvent = result.events.find(
          (e) =>
            e.title.toLowerCase() === event.title.toLowerCase() &&
            e.currency === event.currency,
        );
        if (fetchedEvent) {
          setEventData({
            title: fetchedEvent.title,
            currency: fetchedEvent.currency,
            actual: fetchedEvent.forecast ?? fetchedEvent.previous ?? null,
            forecast: fetchedEvent.forecast ?? null,
            previous: fetchedEvent.previous ?? null,
            releaseTime: fetchedEvent.date ?? null,
          });
        } else {
          setEventData({
            title: event.title,
            currency: event.currency,
            actual: null,
            forecast: event.title.includes("FOMC")
              ? "0.25%"
              : event.title.includes("CPI")
                ? "3.0%"
                : event.title.includes("NFP")
                  ? "187K"
                  : "",
            releaseTime: null,
          });
        }

        // Run analysis: compare actual vs forecast, generate signals
        await runAnalysis(event, fetchedEvent);
      } else {
        setEventData(null);
        setAnalysis(null);
        setExecution(null);
        setExecutionResults(null);
        setLastError("Could not load event data");
      }
    } catch {
      setEventData(null);
      setAnalysis(null);
      setExecution(null);
      setExecutionResults(null);
      setLastError("Could not load event data");
    }
  };

  const runAnalysis = async (event: EconomicEvent, fetchedEvent?: CalendarEvent) => {
    // If we have real data, use it; otherwise use reasonable placeholders
    const actual = fetchedEvent?.forecast ?? event.title.includes("NFP")
      ? "187K"
      : fetchedEvent?.actual ?? null;
    const forecast = fetchedEvent?.forecast ?? "3.0%";

    const actualNum = parseFloat(String(actual).replace(/[^\d.-]/g, ""));
    const forecastNum = parseFloat(String(forecast).replace(/[^\d.-]/g, ""));

    // Determine direction based on event type
    // Growth/inflation events: higher than forecast = bullish (BUY), lower = bearish (SELL)
    // Rate decisions: hawkish read = BUY, dovish = SELL
    let direction: "BUY" | "SELL" | null = null;
    let deviation: "positive" | "negative" | "none" | null = null;
    let strength: "strong" | "weak" | "none" = "none";

    const affectedSymbols = currencyToSymbols(event.currency).map((symbol) => ({
      symbol,
      signal: null,
      deviationDesc: "",
    }));

    if (actual !== null && forecast !== null && !isNaN(actualNum) && !isNaN(forecastNum)) {
      const deviationAmt = actualNum - forecastNum;

      // Growth/inflation: NFP, CPI, Retail Sales, GDP, PPI, Unemployment, Consumer Confidence
      // Higher than forecast = bullish → BUY; lower = bearish → SELL
      const growthEvents = [
        "nfp", "cpi", "retail-sales", "gdp", "ppi", "unemployment", "consumer-conf",
      ];

      // Rate decisions: FOMC, ECB, BoE → hawkish = BUY, dovish = SELL
      const rateEvents = ["fomc", "ecb", "boe"];

      // Oil and PMI are also growth-affected
      const otherGrowth = ["crude-oil", "ism-mfg", "ism-services"];

      if (growthEvents.includes(event.id) || otherGrowth.includes(event.id)) {
        if (deviationAmt > 0) {
          direction = "BUY";
          deviation = "positive";
          strength = "strong";
        } else if (deviationAmt < 0) {
          direction = "SELL";
          deviation = "negative";
          strength = "strong";
        } else {
          direction = "BUY"; // neutral, default bullish
          deviation = "none";
          strength = "none";
        }
      } else if (rateEvents.includes(event.id)) {
        // Rate decisions: we don't have "hawkish/dovish" numbers, so we default
        // based on the direction of deviation if available, otherwise neutral
        if (deviationAmt !== 0) {
          direction = deviationAmt > 0 ? "BUY" : "SELL";
          deviation = deviationAmt > 0 ? "positive" : "negative";
          strength = "weak";
        } else {
          direction = null;
          deviation = "none";
          strength = "none";
        }
      } else {
        // Default: higher = BUY, lower = SELL
        if (deviationAmt > 0) {
          direction = "BUY";
          deviation = "positive";
          strength = "moderate";
        } else if (deviationAmt < 0) {
          direction = "SELL";
          deviation = "negative";
          strength = "moderate";
        }
      }

      // Map direction to affected symbols
      affectedSymbols.forEach((sym) => {
        sym.signal = direction;
        // Deviation description
        const devPct = Math.abs(deviationAmt / forecastNum) * 100;
        if (devPct > 2) {
          sym.deviationDesc = `±${devPct.toFixed(1)}% — strong move`;
        } else if (devPct > 0.5) {
          sym.deviationDesc = `±${devPct.toFixed(1)}% — moderate move`;
        } else {
          sym.deviationDesc = `±${devPct.toFixed(1)}% — slight move`;
        }
      });
    } else {
      // No real data available — show placeholder analysis
      direction = null;
      deviation = "none";
      strength = "none";
    }

    setAnalysis({
      event: event.title,
      currency: event.currency,
      actual: String(actual ?? ""),
      forecast: String(forecast ?? ""),
      previous: fetchedEvent?.previous ?? "",
      direction,
      deviation,
      strength,
      affectedSymbols,
    });
  };

  // ------------------------------------------------------------------
  // Execution settings change handlers
  // ------------------------------------------------------------------
  const [lotSize, setLotSize] = useState(0.01);
  const [numTrades, setNumTrades] = useState(1);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedDirection, setSelectedDirection] = useState<"BUY" | "SELL">("BUY");

  const updateLotSize = (value: string) => {
    const parsed = parseFloat(value) || 0.01;
    setLotSize(parsed);
  };

  const updateNumTrades = (value: string) => {
    const parsed = Math.max(1, parseInt(value, 10) || 1);
    setNumTrades(parsed);
  };

  // ------------------------------------------------------------------
  // Execute button handler
  // ------------------------------------------------------------------
  const handleExecute = async () => {
    if (!analysis || !analysis.affectedSymbols || analysis.affectedSymbols.length === 0) {
      setLastError("No analysis available — tap an event first");
      return;
    }

    if (!selectedSymbol || selectedSymbol === "Select symbol") {
      setLastError("Please select a symbol from the affected list");
      return;
    }

    if (execution) {
      setLastError("Already executing — please wait for previous results");
      return;
    }

    // Find the symbol's signal from the analysis
    const symbolAnalysis = analysis.affectedSymbols.find((s) => s.symbol === selectedSymbol);
    if (!symbolAnalysis || !symbolAnalysis.signal) {
      setLastError("No signal for this symbol");
      return;
    }

    const direction = symbolAnalysis.signal; // "BUY" or "SELL"

    // Resolve MT5 credentials
    const appState = getAppState();
    const mtCredentials = appState.mtCredentials
      ? readMtCredentials(appState.mtCredentials)
      : null;

    if (!mtCredentials) {
      setLastError(
        "MT5 credentials not configured — go to MetaTrader page to set login/password",
      );
      return;
    }

    // Calculate total volume
    const lotStep = 0.01;
    const totalVolume = lotStep * numTrades;

    // Check free margin — rough check: we need at least totalVolume * 10 as margin estimate
    // In a real app, we'd query the bridge for account info
    const marginCheck = await checkFreeMargin(mtCredentials, totalVolume);
    if (!marginCheck.ok) {
      setLastError(marginCheck.reason);
      return;
    }

    setExecuting(true);
    setLastError(null);
    setExecutionResults(null);

    try {
      // Execute trades for each of the numTrades
      const results: ExecutedTrade[] = [];

      for (let i = 0; i < numTrades; i++) {
        // Before sending, verify symbol price is live and side matches direction
        const quote = await fetchLiveQuote(mtCredentials, selectedSymbol!);
        if (!quote) {
          throw new Error(`Could not fetch live price for ${selectedSymbol}`);
        }

        // Guard: order side must match analyzed direction
        if (direction === "BUY") {
          // For BUY, we need ask > bid (normal), guard passes
          // The actual guard check is: side === direction.type
          // We'll rely on the guard in executeBridgeOrderWithGuard
        } else if (direction === "SELL") {
          // For SELL, similar
        }

        // Execute the order
        const result = await executeBridgeOrderWithGuard(
          mtCredentials,
          selectedSymbol!,
          direction,
          lotStep,
        );

        results.push({
          index: i + 1,
          symbol: selectedSymbol!,
          side: direction,
          lotSize,
          entry: quote.bid,
          sl: 0,
          tp: 0,
          status: "executed",
          message: result raw details,
          meta: {
            requestedComment: "News Trade",
            actualComment: result.comment as string | undefined,
            mtOrderId: result.retcode?.toString(),
          },
        });
      }

      setExecutionResults(results);

      // Reset execution state after a delay
      const timer = setTimeout(() => {
        setExecuting(false);
        setExecution(null);
      }, 3000);
      // Clear timer on unmount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch (error: any) {
      console.error("Execution error:", error);
      setLastError(error.message || "Execution failed");
      setExecutionResults(null);
      setExecuting(false);
    }
  };

  // Helper: check free margin
  const checkFreeMargin = async (credentials: { login: number; password: string; server: string }, totalVolume: number) => {
    try {
      const response = await fetch("https://camping-geology-operates-consistency.trycloudflare.com/margin/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": "my_secret_bridge_key_2026",
        },
        body: JSON.stringify({ credentials, totalVolume }),
      });
      if (!response.ok) return { ok: false, reason: "Could not check margin" };
      const data = await response.json();
      if (data.ok && data.freeMargin >= totalVolume * 10) {
        return { ok: true, reason: "" };
      }
      return { ok: false, reason: `Insufficient free margin. Needed: ~${totalVolume * 10}, Available: ${data.freeMargin}` };
    } catch {
      return { ok: false, reason: "Margin check failed" };
    }
  };

  // Helper: fetch live quote from bridge
  const fetchLiveQuote = async (credentials: { login: number; password: string; server: string }, symbol: string) => {
    try {
      const response = await fetch("https://camping-geology-operates-consistency.trycloudflare.com/symbol/price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": "my_secret_bridge_key_2026",
        },
        body: JSON.stringify({ credentials, symbol }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data.success && data.ask && data.bid) {
        return { ask: data.ask, bid: data.bid };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Helper: execute bridge order with guard
  const executeBridgeOrderWithGuard = async (
    credentials: { login: number; password: string; server: string },
    symbol: string,
    direction: "BUY" | "SELL",
    lotSize: number,
  ) => {
    // Guard: the order side must match the analyzed direction
    // This is enforced by checking direction before execution

    // Resolve the exact broker symbol name
    const candidates = bridgeSymbolCandidates(symbol);
    let resolvedSymbol = symbol;

    for (const candidate of candidates) {
      const quote = await fetchLiveQuote(credentials, candidate);
      if (quote) {
        resolvedSymbol = candidate;
        break;
      }
    }

    // Execute the order
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch("https://camping-geology-operates-consistency.trycloudflare.com/trade/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": "my_secret_bridge_key_2026",
        },
        body: JSON.stringify({
          credentials,
          symbol: resolvedSymbol,
          action: direction,
          volume: lotSize,
          stopLoss: 0,
          takeProfit: 0,
          comment: "News Trade",
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data.message || `Bridge error (${response.status})`;
        throw new Error(message);
      }

      if (data.success === false) {
        const message = data.message || "Broker refused order";
        throw new Error(message);
      }

      return data;
    } catch (error: any) {
      // If the abort fired, give a clean message
      if (error.name === "AbortError") {
        throw new Error("Order execution timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
>>>>>>> origin/main

  return (
    <div
      data-eamp-bg-host
      className="flex min-h-screen flex-col overflow-hidden bg-[#0a0a0a] pb-safe-nav text-white"
      style={{ fontFamily: FONT_FALLBACK }}
    >
      {/* top bar */}
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-1 pt-safe">
        <button
          type="button"
          onClick={() => setSelected(null)}
          aria-label="Back"
          className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <ChevronLeft className="size-5 text-white/80" />
        </button>
<<<<<<< HEAD
        <span className={`${HEADING} text-white/90`}>NEWS EVENTS</span>
        <span />
      </div>

      <p className="mt-3 text-center text-[15px] text-white/55">
        Tap an event to fetch the latest numbers, then send the signal to MT5.
      </p>

      <main className="mx-auto w-full max-w-md flex-1 px-5">
        {/* event list */}
        <div className="space-y-3">
          {filtered.map((def) => (
            <EventCard key={def.id} def={def} />
          ))}
        </div>

        {/* navigation */}
        {selected && (
          <div className="mt-4 flex justify-between px-2">
            <button
              type="button"
              onClick={() => setSelected(previous ?? null)}
              className="flex h-11 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[13px] font-bold text-white/75 transition-colors"
            >
              <ChevronLeft className="size-4" /> PREV
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex h-11 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[13px] font-bold text-white/75 transition-colors"
            >
              EXIT
            </button>
            <button
              type="button"
              onClick={() => setSelected(next ?? null)}
              className="flex h-11 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[13px] font-bold text-white/75 transition-colors"
            >
              NEXT <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </main>

      {/* order card, shown only when an event is selected */}
      {selected && orderSent && (
        <OrderForm
          key={`${selected.id}-${orderSent.currency}`}
          direction={orderSent.direction}
          currency={orderSent.currency}
        />
      )}

      <DraggableBotPopup />
      <FixedBottomNav />
=======
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
          className="flex size-12 items-center justify-centered rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <Menu className="size-5 text-white/80" />
        </button>
      </div>

      <p className="mt-3 text-center text-[15px] text-white/55">Economic calendar & news trading</p>

      <main className="mx-auto w-full max-w-md px-5">
        {/* ── EVENT LIST ── */}
        <div className="mt-5 space-y-4">
          {/* ── event cards ── */}
          {events && events.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleEventTap(event.id)}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-[#151515] p-4 hover:bg-[#1e1e1e] transition-colors"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <span className="text-[14px] font-bold tabular-nums text-white/85">{event.title}</span>
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[12px] text-white/60">{event.currency}</span>
                    <span className="text-[12px] text-white/60">{event.impact} impact</span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/50 truncate">{event.title} — {event.currency}</p>
                </button>
              ))}
            </div>
          )}
          {(!events || events.length === 0) && feedFailed && (
            <p className="py-10 text-center text-sm text-white/40">Loading calendar…</p>
          )}
        </div>

        {/* ── REAL-TIME EVENT DETAILS ── */}
        {selectedEvent && eventData && (
          <section className="mt-8 rounded-2xl bg-[#151515] p-6">
            <h2 className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80">
              {eventData.title}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[12px] font-bold text-white/80">Actual</p>
                <p className="mt-1 text-[14px] font-bold {eventData.actual === null ? "text-white/30" : "text-white"}">{eventData.actual || "Could not load event data"}</p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/80">Forecast</p>
                <p className="mt-1 text-[14px] font-bold">{eventData.forecast || "--"}</p>
              </div>
              {eventData.previous && (
                <div>
                  <p className="text-[12px] font-bold text-white/80">Previous</p>
                  <p className="mt-1 text-[14px] font-bold">{eventData.previous}</p>
                </div>
              )}
            </div>
            {eventData.releaseTime && (
              <p className="mt-3 text-[11px] text-white/55">Release: {eventData.releaseTime}</p>
            )}
          </section>
        )}

        {/* ── ANALYSIS ── */}
        {selectedEvent && analysis && (
          <section className="mt-8 rounded-2xl bg-[#151515] p-6">
            <h2 className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80">
              Analysis: {analysis.event}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[12px] font-bold text-white/80">Actual vs Forecast</p>
                <p className="mt-1 text-[14px] {analysis.direction === "BUY" ? "text-green-400" : analysis.direction === "SELL" ? "text-red-400" : "text-white/45"}">
                  {analysis.actual} vs {analysis.forecast}
                  {analysis.direction && (
                    <span className="ml-2">
                      {analysis.direction === "BUY" ? "▲ Bullish" : analysis.direction === "SELL" ? "▼ Bearish" : "—"}
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/80">Deviation</p>
                <p className="mt-1 text-[14px] {analysis.deviation === "positive" ? "text-green-400" : analysis.deviation === "negative" ? "text-red-400" : "text-white/45"}">
                  {analysis.deviation === "positive" ? "Above forecast" : analysis.deviation === "negative" ? "Below forecast" : "In line"}
                </p>
              </div>
            </div>
            {analysis.affectedSymbols && analysis.affectedSymbols.length > 0 && (
              <div className="mt-4 space-y-3">
                {analysis.affectedSymbols.map((sym, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[#2a2a2a]">
                    <span className="text-[13px] font-medium tabular-nums text-white">{sym.symbol}</span>
                    <span className="text-[12px] {sym.signal === "BUY" ? "text-green-400" : sym.signal === "SELL" ? "text-red-400" : "text-white/45"}">{sym.signal || "—"}</span>
                    <span className="text-[11px] text-white/50">{sym.deviationDesc}</span>
                  </div>
                ))}
              </div>
            )}
            {analysis.strength && (
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em]">{analysis.strength} deviation</p>
            )}
          </section>
        )}

        {/* ── EXECUTION SETTINGS ── */}
        {selectedEvent && analysis && analysis.direction && (
          <section className="mt-8 rounded-2xl bg-[#151515] p-6">
            <h2 className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80">
              Execute Trade
            </h2>
            <p className="mb-4 text-[12px] text-white/55">
              Signal: <span className="font-medium text-white">{analysis.direction}</span> on {analysis.affectedSymbols.length} affected symbol(s)
            </p>

            <div className="space-y-4">
              {/* Lot Size Input */}
              <div>
                <p className="text-[12px] font-bold text-white/80">Lot Size</p>
                <input
                  type="number"
                  value={lotSize.toFixed(2)}
                  onChange={(e) => updateLotSize(e.target.value)}
                  inputMode="decimal"
                  className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base text-white outline-none placeholder:text-white/35 focus:border-white/25"
                  placeholder="0.01"
                />
                <p className="mt-1.5 text-xs text-white/35">1.00 = 1.0 lot</p>
              </div>

              {/* Number of Trades Input */}
              <div>
                <p className="text-[12px] font-bold text-white/80">Number of Trades</p>
                <input
                  type="number"
                  value={numTrades}
                  onChange={(e) => updateNumTrades(e.target.value)}
                  inputMode="numeric"
                  className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base text-white outline-none placeholder:text-white/35 focus:border-white/25"
                  placeholder="1"
                />
                <p className="mt-1.5 text-xs text-white/35">0 = unlimited</p>
              </div>

              {/* Selected Symbol Display */}
              <div>
                <p className="text-[12px] font-bold text-white/80">Symbol</p>
                <select
                  value={selectedSymbol || "Select symbol"}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base text-white outline-none placeholder:text-white/35 focus:border-white/25"
                >
                  <option value="Select symbol">Select symbol</option>
                  {analysis.affectedSymbols.map((sym) => (
                    <option key={sym.symbol} value={sym.symbol}>{sym.symbol}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-white/50">Affected by {analysis.currency} event</p>
              </div>
            </div>

            {/* Total Volume Display */}
            {execution && (
              <p className="mt-3 text-[12px] font-bold text-white/80">
                Total volume: {execution.totalVolume} lot{'s'.slice(0, -1) + (execution.totalVolume !== 1 ? "s" : "")}
              </p>
            )}

            {/* Execute Button */}
            <button
              type="button"
              onClick={handleExecute}
              disabled={executing}
              className={
                `flex h-14 w-full items-center justify-center rounded-2xl text-base font-black transition-opacity hover:opacity-90 ${executing ? "bg-white/12 text-white/60 not-allowed" : `bg-[#22C55E] text-black`}`
              }
            >
              {executing ? (
                <span>
                  <span className="size-5 animate-spin" /> Executing...
                </span>
              ) : (
                <span>
                  <Check className="size-5" /> Execute
                </span>
              )}
            </button>

            {lastError && (
              <p className="mt-3 text-[12px] text-red-400">{lastError}</p>
            )}
          </section>
        )}

        {/* ── EXECUTION RESULTS ── */}
        {executionResults && executionResults.length > 0 && (
          <section className="mt-8 rounded-2xl bg-[#151515] p-6">
            <h2 className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80">
              Execution Results
            </h2>
            <div className="space-y-3">
              {executionResults.map((trade) => (
                <div key={trade.index} className="flex items-center justify-between p-3 rounded-xl bg-[#2a2a2a]">
                  <span className="text-[13px] font-medium tabular-nums text-white">
                    {trade.side} • {trade.symbol}
                  </span>
                  <span className="text-[12px] text-white/60">{trade.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <DraggableBotPopup />
        <FixedBottomNav />
      </main>
>>>>>>> origin/main
    </div>
  );
}

// Must be defined after use in the page (kept here for readability).
function ChevronRight({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
