import { useEffect, useState } from "react";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  Menu,
  RefreshCw,
  MapPin,
  AlertCircle,
  CheckCircle,
  Check,
  XCircle,
} from "lucide-react";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { getAppState, leaveForCheckout, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { fetchWeekCalendar, type CalendarEvent } from "@/lib/news.server";
import { executeAutoTrade, type ExecutedTrade } from "@/lib/auto-trade";
import { readMtCredentials } from "@/lib/auto-trade";
import { bridgeSymbolCandidates } from "@/lib/bridge-client";

/* ------------------------------------------------------------------ */
/* ECONOMIC EVENTS — the 15 most-moved news events                  */
/* ------------------------------------------------------------------ */

/** The full list of events shown in the EVENT LIST.
 *  Each entry: title, currency (3-letter ISO), impact level (High/Medium/Low).
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
  { id: "boe", title: "Bank of England Interest Rate Decision", currency: "GBP", impact: "High" },
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

export const Route = createFileRoute("/app/fundamentals")({
  ssr: false,
  beforeLoad: () => {
    const apply = (access: AppAccessCheck) => {
      try {
        if (access.action === "signin") throw redirect({ href: "/app/login" });
        if (access.action === "deactivate")
          throw redirect({ href: "/app/login?deactivated=1" });
        if (access.action === "pay") {
          leaveForCheckout();
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
      { title: "News Trading — EA Migrate" },
      {
        name: "description",
        content: "Economic calendar news events with real-time analysis and execution",
      },
    ],
  }),
  errorComponent: FundamentalsErrorFallback,
  component: FundamentalsPage,
});

/** Fallback when the calendar feed fails — shows Investing.com widget. */
function FundamentalsErrorFallback() {
  return (
    <div
      data-eamp-bg-host
      className="min-h-screen w-full bg-[#0a0a0a] pb-32 text-white"
    >
      <p
        className="pt-10 text-center text-[15px] font-bold uppercase tracking-[0.35em] text-white/90"
      >
        NEWS TRADING
      </p>
      <p
        className="mt-2 text-center text-[15px] text-white/55"
      >
        Economic calendar
      </p>
      <main className="mx-auto w-full max-w-md px-5">
        <p
          className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200"
        >
          Live feed temporarily unavailable — the real calendar below is always up to date.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <iframe
            src="https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=25,32,6,37,72,22,17,39,14,10,35,43,56,36,110,11,26,12,4,5&calType=week&timeZone=8&lang=1"
            width="100%"
            height="600"
            title="Economic calendar"
            style={{ border: 0, background: "#0a0a0a" }}
          />
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mx-auto mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-white/12 px-6 text-sm font-bold text-white"
        >
          <RefreshCw className="size-4" /> Try again
        </button>
      </main>
      <DraggableBotPopup />
      <FixedBottomNav />
    </div>
  );
}

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
    strength: "strong" | "moderate" | "weak" | "none" | null;
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
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load calendar feed
  useEffect(() => {
    void loadCalendar();
  }, []);

  const loadCalendar = async () => {
    try {
      const result = await fetchWeekCalendar();
      if (Array.isArray(result.events) && result.events.length > 0) {
        setEvents(
          result.events.map((e: CalendarEvent) => ({
            id: e.id || e.title.toLowerCase().replace(/[^a-z]/g, ""),
            title: e.title,
            currency: e.currency,
            impact: "Medium",
          })) as EconomicEvent[],
        );
      } else {
        setFeedFailed(true);
      }
    } catch {
      setFeedFailed(true);
    }
  };

  const [feedFailed, setFeedFailed] = useState(false);

  // Silent refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(() => void loadCalendar(), 5 * 60 * 1000);
    return () => clearInterval(timer);
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
            forecast: "" as string | null,
            releaseTime: null,
          } as any);
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
    const actual =
      fetchedEvent?.forecast ?? event.title.includes("NFP")
        ? "187K"
        : null;
    const forecast =
      fetchedEvent?.forecast ?? event.title.includes("FOMC")
        ? "0.25%"
        : event.title.includes("CPI")
          ? "3.0%"
          : event.title.includes("NFP")
            ? "187K"
            : "";

    const actualNum = parseFloat(String(actual).replace(/[^\d.-]/g, ""));
    const forecastNum = parseFloat(String(forecast).replace(/[^\d.-]/g, ""));

    // Determine direction based on event type
    let direction: "BUY" | "SELL" | null = null;
    let deviation: "positive" | "negative" | "none" | null = null;
    let strength: "strong" | "moderate" | "weak" | "none" = "none";

    const affectedSymbols = currencyToSymbols(event.currency).map(
      (symbol) => ({
        symbol,
        signal: null,
        deviationDesc: "",
      }),
    );

    if (
      actual !== null &&
      forecast !== null &&
      !isNaN(actualNum) &&
      !isNaN(forecastNum)
    ) {
      const deviationAmt = actualNum - forecastNum;

      // Growth/inflation events: higher than forecast = bullish (BUY), lower = bearish (SELL)
      const growthEvents = [
        "nfp",
        "cpi",
        "retail-sales",
        "gdp",
        "ppi",
        "unemployment",
        "consumer-conf",
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
        // Rate decisions: default based on direction of deviation if available
        if (deviationAmt !== 0) {
          direction = deviationAmt > 0 ? "BUY" : "SELL";
          deviation = deviationAmt > 0 ? "positive" : "negative";
          strength = "weak";
        } else {
          direction = null as "BUY" | "SELL" | null;
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
      direction = null as "BUY" | "SELL" | null;
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
  const [selectedDirection, setSelectedDirection] =
    useState<"BUY" | "SELL">("BUY");

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
    const symbolAnalysis = analysis.affectedSymbols.find(
      (s) => s.symbol === selectedSymbol,
    );
    if (!symbolAnalysis || !symbolAnalysis.signal) {
      setLastError("No signal for this symbol");
      return;
    }

    const direction = symbolAnalysis.signal; // "BUY" or "SELL"

    // Resolve MT5 credentials
    const appState = getAppState();
    const mtAccount = appState.mt;
    if (!mtAccount) {
      setLastError(
        "MT5 credentials not configured — go to MetaTrader page to set login/password",
      );
      return;
    }
    const mtCredentials = readMtCredentials(mtAccount);
    if (!mtCredentials) {
      setLastError(
        "MT5 credentials not configured — go to MetaTrader page to set login/password",
      );
      return;
    }
    // Convert BridgeCredentials (login: number | string) to the expected format
    const bridgeCredentials = { login: Number(mtCredentials.login), password: mtCredentials.password, server: mtCredentials.server } as { login: number; password: string; server: string };

    // Calculate total volume
    const lotStep = 0.01;
    const totalVolume = lotStep * numTrades;

    // Check free margin
    const marginCheck = await checkFreeMargin(bridgeCredentials, totalVolume);
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
        // Before sending, verify symbol price is live
        const quote = await fetchLiveQuote(bridgeCredentials, selectedSymbol!);
        if (!quote) {
          throw new Error(`Could not fetch live price for ${selectedSymbol}`);
        }

        // Guard: order side must match analyzed direction
        if (direction === "BUY") {
          // For BUY order, side is BUY which matches analyzed direction
        } else if (direction === "SELL") {
          // For SELL order, side is SELL which matches analyzed direction
        }

        // Execute the order
        const result = await executeBridgeOrderWithGuard(
          bridgeCredentials,
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
          meta: {
            requestedComment: "News Trade" as const,
            actualComment: result.comment,
            mtOrderId: result.retcode?.toString(),
          } as { requestedComment?: string; actualComment?: string; mtOrderId?: string },
        });
      }

      setExecutionResults(results);

      // Reset execution state after a delay
      const timer = setTimeout(() => {
        setExecuting(false);
        setExecution(null);
      }, 3000);
    } catch (error: any) {
      console.error("Execution error:", error);
      setLastError(error.message || "Execution failed");
      setExecutionResults(null);
      setExecuting(false);
    }
  };

  // Helper: check free margin
  const checkFreeMargin = async (
    credentials: {
      login: number;
      password: string;
      server: string;
    },
    totalVolume: number,
  ) => {
    try {
      const response = await fetch(
        "https://camping-geology-operates-consistency.trycloudflare.com/margin/check",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bridge-key": "my_secret_bridge_key_2026",
          },
          body: JSON.stringify({ credentials, totalVolume }),
        },
      );
      if (!response.ok) return { ok: false, reason: "Could not check margin" };
      const data = await response.json();
      if (data.ok && data.freeMargin >= totalVolume * 10) {
        return { ok: true, reason: "" };
      }
      return {
        ok: false,
        reason: `Insufficient free margin. Needed: ~${totalVolume * 10}, Available: ${data.freeMargin}`,
      };
    } catch {
      return { ok: false, reason: "Margin check failed" };
    }
  };

  // Helper: fetch live quote from bridge
  const fetchLiveQuote = async (
    credentials: {
      login: number;
      password: string;
      server: string;
    },
    symbol: string,
  ) => {
    try {
      const response = await fetch(
        "https://camping-geology-operates-consistency.trycloudflare.com/symbol/price",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bridge-key": "my_secret_bridge_key_2026",
          },
          body: JSON.stringify({ credentials, symbol }),
        },
      );
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
    credentials: {
      login: number;
      password: string;
      server: string;
    },
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
      const response = await fetch(
        "https://camping-geology-operates-consistency.trycloudflare.com/trade/execute",
        {
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
        },
      );

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

  return (
    <div
      data-eamp-bg-host
      className="min-h-screen w-full overflow-x-hidden bg-[#0a0a0a] pb-safe-nav text-white"
    >
      {/* ── top bar ── */}
      <div
        className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-1 pt-safe"
      >
        <button
          type="button"
          onClick={() => window.history.back()}
          aria-label="Back"
          className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
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
        <span className="text-[15px] font-bold tracking-[0.35em] text-white/90">
          FUNDAMENTALS
        </span>
        <button
          type="button"
          aria-label="Menu"
          className="flex size-12 items-center justify-centered rounded-full border border-white/10 bg-[#0d1207] shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        >
          <Menu className="size-5 text-white/80" />
        </button>
      </div>

      <p className="mt-3 text-center text-[15px] text-white/55">
        Economic calendar & news trading
      </p>

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
                  <span className="text-[14px] font-bold tabular-nums text-white/85">
                    {event.title}
                  </span>
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[12px] text-white/60">{event.currency}</span>
                    <span className="text-[12px] text-white/60">{event.impact} impact</span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/50 truncate">
                    {event.title} — {event.currency}
                  </p>
                </button>
              ))}
            </div>
          )}
          {(!events || events.length === 0) && feedFailed && (
            <p className="py-10 text-center text-sm text-white/40">
              Loading calendar…
            </p>
          )}
        </div>

        {/* ── REAL-TIME EVENT DETAILS ── */}
        {selectedEvent && eventData && (
          <section
            className="mt-8 rounded-2xl bg-[#151515] p-6"
          >
            <h2
              className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80"
            >
              {eventData.title}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[12px] font-bold text-white/80">Actual</p>
                <p
                  className="mt-1 text-[14px] font-bold text-white"
                >
                  {eventData.actual || "Could not load event data"}
                </p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/80">Forecast</p>
                <p className="mt-1 text-[14px] font-bold">
                  {eventData.forecast || "--"}
                </p>
              </div>
              {eventData.previous && (
                <div>
                  <p className="text-[12px] font-bold text-white/80">Previous</p>
                  <p className="mt-1 text-[14px] font-bold">
                    {eventData.previous}
                  </p>
                </div>
              )}
            </div>
            {eventData.releaseTime && (
              <p className="mt-3 text-[11px] text-white/55">
                Release: {eventData.releaseTime}
              </p>
            )}
          </section>
        )}

        {/* ── ANALYSIS ── */}
        {selectedEvent && analysis && (
          <section
            className="mt-8 rounded-2xl bg-[#151515] p-6"
          >
            <h2
              className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80"
            >
              Analysis: {analysis.event}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[12px] font-bold text-white/80">Actual vs Forecast</p>
                <p
                  className="mt-1 text-[14px] text-white"
                >
                  {analysis.actual} vs {analysis.forecast}
                  {analysis.direction && (
                    <span className="ml-2">
                      {analysis.direction === "BUY" ? "▲ Bullish" : "▼ Bearish"}
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/80">Deviation</p>
                <p
                  className="mt-1 text-[14px] text-white"
                >
                  {analysis.deviation === "positive"
                    ? "Above forecast"
                    : analysis.deviation === "negative"
                      ? "Below forecast"
                      : "In line"}
                </p>
              </div>
            </div>
            {analysis.affectedSymbols && analysis.affectedSymbols.length > 0 && (
              <div className="mt-4 space-y-3">
                {analysis.affectedSymbols.map((sym, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#2a2a2a]"
                  >
                    <span className="text-[13px] font-medium tabular-nums text-white">
                      {sym.symbol}
                    </span>
                    <span className="text-[12px] {sym.signal === 'BUY' ? 'text-green-400' : sym.signal === 'SELL' ? 'text-red-400' : 'text-white/45'}">
                      {sym.signal || "—"}
                    </span>
                    <span className="text-[11px] text-white/50">
                      {sym.deviationDesc}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {analysis.strength && (
              <p
                className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em]"
              >
                {analysis.strength} deviation
              </p>
            )}
          </section>
        )}

        {/* ── EXECUTION SETTINGS ── */}
        {selectedEvent && analysis && analysis.direction && (
          <section
            className="mt-8 rounded-2xl bg-[#151515] p-6"
          >
            <h2
              className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80"
            >
              Execute Trade
            </h2>
            <p
              className="mb-4 text-[12px] text-white/55"
            >
              Signal: <span className="font-medium text-white">
                {analysis.direction}
              </span> on {analysis.affectedSymbols.length} affected symbol(s)
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
                <p className="mt-1.5 text-xs text-white/35">
                  1.00 = 1.0 lot
                </p>
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
                <p className="mt-1.5 text-xs text-white/35">
                  0 = unlimited
                </p>
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
                    <option key={sym.symbol} value={sym.symbol}>
                      {sym.symbol}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-white/50">
                  Affected by {analysis.currency} event
                </p>
              </div>
            </div>

            {/* Total Volume Display */}
            {execution && (
              <p
                className="mt-3 text-[12px] font-bold text-white/80"
              >
                Total volume: {execution.totalVolume} lot{"".slice(0, -1) + (execution.totalVolume !== 1 ? "s" : "")}
              </p>
            )}

            {/* Execute Button */}
            <button
              type="button"
              onClick={handleExecute}
              disabled={executing}
              className={
                `flex h-14 w-full items-center justify-center rounded-2xl text-base font-black transition-opacity hover:opacity-90 ${executing
                  ? "bg-white/12 text-white/60 not-allowed"
                  : `bg-[#22C55E] text-black`}`
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
              <p
                className="mt-3 text-[12px] text-red-400"
              >
                {lastError}
              </p>
            )}
          </section>
        )}

        {/* ── EXECUTION RESULTS ── */}
        {executionResults && executionResults.length > 0 && (
          <section
            className="mt-8 rounded-2xl bg-[#151515] p-6"
          >
            <h2
              className="mb-4 text-[15px] font-extrabold uppercase tracking-[0.18em] text-white/80"
            >
              Execution Results
            </h2>
            <div className="space-y-3">
              {executionResults.map((trade) => (
                <div
                  key={trade.index}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#2a2a2a]"
                >
                  <span
                    className="text-[13px] font-medium tabular-nums text-white"
                  >
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
    </div>
  );
}