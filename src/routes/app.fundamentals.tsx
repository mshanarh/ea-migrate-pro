import { useEffect, useMemo, useState } from "react";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
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

export const Route = createFileRoute("/app/fundamentals")({
  ssr: false,
  beforeLoad: () => {
    const apply = (access: AppAccessCheck) => {
      try {
        if (access.action === "signin") throw redirect({ href: "/app/login" });
        if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
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
      { title: "News Events — EA Migrate" },
      { name: "description", content: "Latest economic releases with live signal and lot sizing for your robot." },
    ],
  }),
  errorComponent: FundamentalsErrorFallback,
  component: FundamentalsPage,
});

function FundamentalsErrorFallback() {
  return (
    <div data-eamp-bg-host className="flex min-h-screen flex-col bg-[#0a0a0a] pb-28 text-white">
      <p className={`pt-10 text-center ${HEADING} text-white/90`}>NEWS EVENTS</p>
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
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [now, setNow] = useState(() => new Date());

  const filtered = useMemo(() => {
    if (!selected) return EVENTS;
    return [...EVENTS].sort((a, b) => a.label.localeCompare(b.label));
  }, [selected]);

  const selectedIndex = selected ? filtered.indexOf(selected) : -1;
  const previous = selectedIndex > 0 ? filtered[selectedIndex - 1] : null;
  const next = selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? filtered[selectedIndex + 1] : null;

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
          className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <ChevronLeft className="size-5 text-white/80" />
        </button>
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
    </div>
  );
}

// Must be defined after use in the page (kept here for readability).
function ChevronRight({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
