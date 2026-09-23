import { useCallback, useEffect, useRef, useState } from "react";
import { getScannerAnalysis, type ScannerAnalysis } from "@/lib/metaapi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ScannerTimeframe = "15m" | "1h" | "4h";

/**
 * Scanner lifecycle states (per product spec):
 *  loading  — waiting for market data
 *  no-data  — broker data unavailable
 *  no-trade — conditions are not satisfied
 *  ready    — valid setup with Entry/SL/TP
 *  executing— order is being submitted
 *  executed — order successfully placed
 *  error    — backend/broker error
 */
export type ScannerPhase = "idle" | "loading" | "no-data" | "no-trade" | "ready" | "executing" | "executed" | "error";

export type ExecutionPlan = {
  symbol: string;
  lot: string;
  trades: number;
  direction: "BUY" | "SELL";
  entry: string;
  stopLoss: string;
  takeProfit: string;
  riskReward: string;
  confidence: number;
  executionReady: boolean;
};

export type ExecutionOutcome = {
  ok: boolean;
  /** Broker order ticket / position id when available. */
  orderId?: string;
  /** Filled price when the broker echoes it. */
  executionPrice?: number;
  /** "x/y trades executed" style summary, or the real broker/backend error. */
  message: string;
};

type Props = {
  /** Symbols the mentor attached to this bot (EA creation on the mentor portal). */
  symbols: string[];
  /** MetaApi account used for live quotes and historical candles. */
  accountId?: string;
  /** MetaApi region returned when the MT5 account was connected. */
  region?: string;
  /** Per-symbol lot/max trades saved on the robot (falls back to sensible defaults). */
  pairs?: { symbol: string; lotSize: string; maxTrades: string }[];
  /** Accent color hex, applied to buttons, bullets and highlights. */
  accent: string;
  /** Remaining scans today (out of 5). Infinity for unlimited admins. */
  scansLeft: number;
  /** Called when the user taps Scan — registers the daily scan. Return false to block (limit reached). */
  onScanStart: () => boolean;
  /**
   * Fires the REAL trade through the server-side MT5 integration.
   * onProgress streams live status ("broker connection opening…") while the
   * order is in flight; the Promise resolves with the broker's actual outcome.
   */
  onExecute: (
    plan: ExecutionPlan,
    onProgress: (message: string) => void,
  ) => Promise<ExecutionOutcome>;
};

const SCAN_STEPS = [
  "Connecting to the live MT5 quote...",
  "Loading recent candles...",
  "Measuring EMA trend structure...",
  "Checking RSI momentum...",
  "Calculating ATR volatility and swing levels...",
  "Building entry, stop-loss and take-profit...",
];

const MAX_CHART_BYTES = 5 * 1024 * 1024;

function detectTimeframe(file: File): ScannerTimeframe {
  const name = file.name.toLowerCase();
  if (/(^|[^\d])15(?:m|min|minute)(?=[^a-z]|$)/.test(name)) return "15m";
  if (/(^|[^\d])4(?:h|hour)(?=[^a-z]|$)/.test(name)) return "4h";
  if (/(^|[^\d])1(?:h|hour)(?=[^a-z]|$)/.test(name)) return "1h";
  return "1h";
}

function fmtPrice(value: number): string {
  const magnitude = Math.abs(value);
  return value.toFixed(magnitude >= 1000 ? 2 : magnitude >= 10 ? 3 : 5);
}

function fmtSignalLevel(value: number): string {
  return value > 0 ? fmtPrice(value) : "—";
}

const SIGNAL_COLORS: Record<ScannerAnalysis["signal"], string> = {
  BUY: "#22c55e",
  SELL: "#ef4444",
  "NO TRADE": "#9ca3af",
};

/** Derives the visible scanner phase from the analysis + execution state. */
function phaseOf(
  scanning: boolean,
  analysis: ScannerAnalysis | null,
  analysisError: string,
  executing: boolean,
  executionError: string,
): Exclude<ScannerPhase, "idle" | "executing" | "executed"> | ScannerPhase {
  if (executing) return "executing";
  if (executionError) return "error";
  if (scanning) return "loading";
  if (analysisError) return "error";
  if (!analysis) return "idle";
  if (analysis.signal === "NO TRADE") {
    // The server distinguishes "no data at all" from "data but no setup".
    return analysis.dataStatus === "no-data" ? "no-data" : "no-trade";
  }
  return "ready";
}

const PHASE_META: Record<
  Exclude<ScannerPhase, "idle">,
  { label: string; color: string; hint: string }
> = {
  loading: { label: "LOADING", color: "#facc15", hint: "Reading live broker data..." },
  "no-data": { label: "NO DATA", color: "#f87171", hint: "Broker data unavailable for this symbol." },
  "no-trade": { label: "NO TRADE", color: "#9ca3af", hint: "Conditions not satisfied — waiting for a cleaner setup." },
  ready: { label: "READY TO EXECUTE", color: "#22c55e", hint: "Valid setup with Entry, Stop-Loss and Take-Profit." },
  executing: { label: "EXECUTING", color: "#facc15", hint: "Sending the order through the secure server link..." },
  executed: { label: "EXECUTED", color: "#22c55e", hint: "Order placed with the broker." },
  error: { label: "ERROR", color: "#f87171", hint: "The provider reported a problem — details below." },
};

export default function ChartScanner({
  symbols,
  accountId,
  region,
  pairs = [],
  accent,
  scansLeft,
  onScanStart,
  onExecute,
}: Props) {
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState<ScannerTimeframe>("1h");
  const [trades, setTrades] = useState(5);
  const [lot, setLot] = useState("0.01");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<ScannerAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [chartSrc, setChartSrc] = useState<string | null>(null);
  const [chartError, setChartError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Execution state ────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [execError, setExecError] = useState("");
  const [execResult, setExecResult] = useState<ExecutionOutcome | null>(null);
  const [execProgress, setExecProgress] = useState("");
  /** Visible lifecycle: Offline → Connecting → Connected → Executing → done → Disconnected. */
  const [execStage, setExecStage] = useState<
    "OFFLINE" | "CONNECTING" | "CONNECTED" | "EXECUTING" | "EXECUTED" | "DISCONNECTED"
  >("OFFLINE");

  /** Paints the status chain with the current stage highlighted. */
  const statusChain = [
    { label: "OFFLINE", at: 0 },
    { label: "CONNECTING", at: 1 },
    { label: "CONNECTED", at: 2 },
    { label: "EXECUTING", at: 3 },
    { label: "EXECUTED", at: 4 },
    { label: "DISCONNECTED", at: 5 },
  ] as const;

  const hasSymbols = symbols.length > 0;
  const lotValid = Number(lot) > 0;
  const scanLocked = !accountId || !symbol || !lotValid || trades < 1;
  const lockReason = !accountId
    ? "Connect your MT5 account first"
    : !symbol
      ? "Add a symbol to your EA"
      : !lotValid
        ? "Set a lot size"
        : "";

  const resetResult = () => {
    setExecuted(false);
    setExecError("");
    setExecResult(null);
    setExecProgress("");
    setExecStage("OFFLINE");
  };

  // Preselect the first mentor symbol and its saved lot/trades once known.
  useEffect(() => {
    if (symbols.length === 0 || symbol) return;
    const first = symbols[0];
    if (!first) return;
    setSymbol(first);
    const saved = pairs.find((pair) => pair.symbol === first);
    setLot(saved?.lotSize || "0.01");
    const savedTrades = Number(saved?.maxTrades ?? 0);
    setTrades(savedTrades > 0 ? Math.min(savedTrades, 20) : 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  const pickChart = (file: File | undefined) => {
    if (!file) return;
    setChartError("");
    if (file.size > MAX_CHART_BYTES) {
      setChartError("That image is too large (max 5 MB).");
      return;
    }
    const detectedTimeframe = detectTimeframe(file);
    const reader = new FileReader();
    reader.onload = () => {
      setChartSrc(String(reader.result));
      setTimeframe(detectedTimeframe);
      setAnalysis(null);
      setAnalysisError("");
      resetResult();
    };
    reader.onerror = () => setChartError("Could not read that image.");
    reader.readAsDataURL(file);
  };

  const runScan = useCallback(async () => {
    if (scanning) return;
    // One of the 5 daily scans is consumed here — the route blocks when out of scans.
    if (!onScanStart()) return;
    setScanning(true);
    setStep(0);
    setAnalysis(null);
    setAnalysisError("");
    resetResult();
    // Narrated steps advance while the real analysis runs. The result shows as
    // soon as the live analysis responds — no artificial delay.
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setStep(Math.min(index, SCAN_STEPS.length - 1));
    }, 650);
    try {
      const result = await getScannerAnalysis({
        data: {
          accountId: accountId ?? "",
          symbol,
          timeframe,
          ...(region ? { region } : {}),
        },
      });
      if (!result.ok) {
        setAnalysisError(result.message);
      } else {
        setAnalysis(result.analysis);
      }
    } catch {
      setAnalysisError("Could not run the chart analysis. Check your connection and try again.");
    } finally {
      window.clearInterval(interval);
      setScanning(false);
    }
  }, [accountId, region, symbol, timeframe, onScanStart, scanning]);

  const startScan = () => {
    if (scanning || scanLocked) return;
    void runScan();
  };

  const selectSymbol = (item: string) => {
    setSymbol(item);
    const saved = pairs.find((pair) => pair.symbol === item);
    setLot(saved?.lotSize || "0.01");
    const savedTrades = Number(saved?.maxTrades ?? 0);
    setTrades(savedTrades > 0 ? Math.min(savedTrades, 20) : 5);
    setAnalysis(null);
    setAnalysisError("");
    resetResult();
  };

  // EXECUTE pressed → open the confirmation popup with the full plan.
  const openConfirm = () => {
    if (!analysis || analysis.signal === "NO TRADE" || executing) return;
    resetResult();
    setConfirmOpen(true);
  };

  // Confirmed → fire the real order through the server-side integration.
  const confirmExecute = useCallback(async () => {
    if (!analysis || executing) return;
    setConfirmOpen(false);
    setExecuting(true);
    setExecuted(false);
    setExecError("");
    setExecResult(null);
    setExecProgress("Connecting to broker...");
    setExecStage("CONNECTING");
    try {
      const outcome = await onExecute(
        {
          symbol: analysis.symbol,
          lot,
          trades,
          direction: analysis.signal as "BUY" | "SELL",
          entry: fmtPrice(analysis.entry),
          stopLoss: fmtPrice(analysis.stopLoss),
          takeProfit: fmtPrice(analysis.takeProfit),
          riskReward: analysis.riskReward,
          confidence: analysis.confidence,
          executionReady: analysis.executionReady,
        },
        (message) => {
          setExecProgress(message);
          // Derive the visible chain stage from the real progress stream.
          if (/connecting/i.test(message)) setExecStage("CONNECTING");
          else if (/verified|connected/i.test(message)) setExecStage("CONNECTED");
          else if (/executing|order/i.test(message)) setExecStage("EXECUTING");
          else if (/disconnect/i.test(message)) setExecStage("DISCONNECTED");
        },
      );
      if (outcome.ok) {
        setExecResult(outcome);
        setExecuted(true);
        setExecStage("EXECUTED");
      } else {
        setExecError(outcome.message);
        setExecStage("EXECUTED");
      }
      // The server closed the temporary connection — reflect it, then rest offline.
      window.setTimeout(() => setExecStage((stage) => (stage === "EXECUTED" ? "DISCONNECTED" : stage)), 1600);
    } catch {
      setExecError("Could not reach the execution service. Check your connection and try again.");
      setExecStage("DISCONNECTED");
    } finally {
      setExecuting(false);
      setExecProgress("");
    }
  }, [analysis, executing, lot, onExecute, trades]);

  const phase = phaseOf(scanning, analysis, analysisError, executing, execError);
  const planVisible = Boolean(analysis && analysis.signal !== "NO TRADE");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col pb-[130px]" style={{ backgroundColor: "#090c10" }}>
      {/* Header — title, scans-left badge */}
      <div className="flex items-start justify-between gap-4 px-4 pb-5 pt-5 sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: accountId ? "#22c55e" : "#9ca3af" }} />
            <span className="text-[10px] font-bold tracking-[0.2em] text-white/40">
              {accountId ? "MT5 CONNECTED" : "MT5 NOT CONNECTED"}
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Market scanner</h1>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-white/45">
            Live broker quotes build executable trade plans with entry, stop-loss and take-profit.
          </p>
        </div>
        <span
          data-testid="text-scans-remaining"
          className="shrink-0 rounded-full border border-white/15 px-3 py-2 text-xs font-bold text-white/65 sm:px-4 sm:text-sm"
        >
          {scansLeft === Infinity ? "∞ UNLIMITED" : `${scansLeft}/5`}
        </span>
      </div>

      {/* SCANNER STATE banner */}
      {phase !== "idle" && (
        <div
          data-testid="banner-scanner-state"
          className="mx-3 flex items-center justify-between rounded-2xl border px-4 py-3 sm:mx-6"
          style={{ borderColor: `${PHASE_META[phase].color}55`, backgroundColor: `${PHASE_META[phase].color}0f` }}
        >
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full" style={{ background: PHASE_META[phase].color }} />
            <span className="text-[12px] font-black tracking-[0.18em]" style={{ color: PHASE_META[phase].color }}>
              {PHASE_META[phase].label}
            </span>
          </span>
          <span className="text-right text-[11px] text-white/50">{PHASE_META[phase].hint}</span>
        </div>
      )}

      {/* Optional screenshot — the signal is calculated from MT5 market data. */}
      <div
        className="relative mx-3 mt-3 min-h-[220px] overflow-hidden rounded-[26px] border-2 border-dashed sm:mx-6 sm:min-h-[280px]"
        style={{ borderColor: dragging ? accent : "#4a2029", backgroundColor: "#120b10" }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pickChart(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            pickChart(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {!chartSrc ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative z-10 flex min-h-[260px] w-full flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <span
              className="flex size-[68px] items-center justify-center rounded-full border text-white/85"
              style={{ borderColor: accent, boxShadow: `0 0 28px ${accent}33` }}
            >
              <svg viewBox="0 0 24 24" className="size-9" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4" />
              </svg>
            </span>
            <span className="text-[18px] font-black text-white">Attach a chart screenshot</span>
            <span className="text-[13px] text-white/45">Optional — live MT5 data powers the signal</span>
          </button>
        ) : (
          <img src={chartSrc} alt="Uploaded chart" className="absolute inset-0 size-full object-cover" />
        )}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,35,63,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,35,63,0.16) 1px, transparent 1px)",
            backgroundSize: "38px 38px",
          }}
        />
        {scanning && (
          <div
            className="absolute inset-x-0 top-1/2 z-10 h-[2px] animate-[scanMove_2s_ease-in-out_infinite]"
            style={{ background: accent, boxShadow: `0 0 15px ${accent}` }}
          />
        )}
        {chartSrc && !scanning && (
          <button
            type="button"
            aria-label="Remove chart"
            onClick={() => {
              setChartSrc(null);
              setAnalysis(null);
              setAnalysisError("");
              resetResult();
            }}
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/85"
          >
            ✕
          </button>
        )}
        {chartError && (
          <p className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 text-center text-[12px] text-red-300">{chartError}</p>
        )}
      </div>

      {!analysis || analysis.signal === "NO TRADE" ? (
        <>
          {/* Upload row — hidden while scanning */}
          {!scanning && (
            <div className="mx-3 mt-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-bold text-white/80 transition-colors hover:bg-white/[0.08]"
              >
                {chartSrc ? "Replace chart image" : "Attach chart screenshot"}
              </button>
              {chartError && <p className="mt-2 text-[12px] text-red-400">{chartError}</p>}
            </div>
          )}

          {/* Narrated analysis steps */}
          {scanning && (
            <div className="mt-4 space-y-2 px-6 sm:px-8">
              {SCAN_STEPS.slice(0, step + 1).map((text, index) => (
                <div key={index} className="flex gap-2 text-[13px] text-white/70">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: accent }} />
                  {text}
                </div>
              ))}
            </div>
          )}

          {/* Error from the analysis (key missing / rejected / account problems) */}
          {analysisError && !scanning && (
            <div className="mx-3 mt-3 rounded-[24px] border border-red-500/25 bg-red-500/[0.06] p-4 sm:mx-6">
              <p className="text-[13px] font-bold text-red-300">Configuration / data error</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/60">{analysisError}</p>
            </div>
          )}

          {/* NO-DATA panel — analysis completed but no broker/public data */}
          {analysis && !scanning && analysis.dataStatus === "no-data" && (
            <div className="mx-3 mt-3 rounded-[24px] border border-white/10 bg-[#151a20] p-4 sm:mx-6">
              <p className="text-[13px] font-bold text-white/80">No market data for {analysis.symbol}</p>
              {analysis.reasons.map((reason, index) => (
                <p key={index} className="mt-2 flex gap-2 text-[12px] leading-relaxed text-white/50">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />
                  <span>{reason}</span>
                </p>
              ))}
            </div>
          )}

          {/* SYMBOL — exactly the mentor's EA symbols; the user picks one */}
          <div className="mx-3 mt-4 rounded-[20px] border border-white/8 bg-[#151a20] p-4 sm:mx-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] tracking-[0.28em] text-white/30">SYMBOL</p>
              <p className="text-[10px] font-bold text-white/25">{symbols.length} FROM YOUR EA</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {symbols.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectSymbol(item)}
                  className="rounded-full px-5 py-2.5 text-[13px] font-bold transition-colors"
                  style={
                    symbol === item
                      ? { background: accent, color: "#fff" }
                      : { background: "#222", color: "rgba(255,255,255,0.5)" }
                  }
                >
                  {item}
                </button>
              ))}
            </div>
            {!hasSymbols && (
              <p className="mt-3 text-[12px] font-semibold text-white/45">
                No symbols on this EA yet — your mentor adds them on the portal when creating the EA. Until then scanning
                is locked.
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[10px] tracking-[0.28em] text-white/30">TIMEFRAME</p>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-bold text-white/65">
                {timeframe}
              </span>
            </div>
          </div>

          {/* Trades + lot size */}
          <div className="mx-3 mt-3 divide-y divide-white/5 rounded-[20px] border border-white/8 bg-[#151a20] sm:mx-6">
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="font-bold text-white">Trades</p>
                <p className="text-[11px] text-white/30">Max 20 per scan · set before scanning</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Fewer trades"
                  onClick={() => setTrades((value) => Math.max(1, value - 1))}
                  className="size-10 rounded-full bg-[#222] text-white"
                >
                  −
                </button>
                <span className="w-6 text-center font-bold text-white">{trades}</span>
                <button
                  type="button"
                  aria-label="More trades"
                  onClick={() => setTrades((value) => Math.min(20, value + 1))}
                  className="size-10 rounded-full text-white"
                  style={{ background: accent }}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="font-bold text-white">Lot size</p>
                <p className="text-[11px] text-white/30">Volume per trade</p>
              </div>
              <input
                value={lot}
                onChange={(event) => setLot(event.target.value)}
                inputMode="decimal"
                aria-label="Lot size"
                className="h-[42px] w-[110px] rounded-full border border-white/10 bg-[#222] text-center text-white outline-none focus:border-white/30"
              />
            </div>
          </div>

          {/* Scan button — locked until symbol + account + trade settings are set */}
          <button
            type="button"
            onClick={startScan}
            disabled={scanning || scanLocked}
            data-testid="button-run-scan"
            className="mx-3 mt-4 flex h-[56px] items-center justify-center gap-2 rounded-full font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-60 sm:mx-6"
            style={{ background: accent, boxShadow: scanLocked ? "none" : `0 0 20px ${accent}66` }}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> {scanning ? "SCANNING..." : `Scan ${symbol || "market"}`}
          </button>
          {scanLocked && !scanning && lockReason && (
            <p className="mx-6 mt-2 text-center text-[12px] font-semibold text-white/40">Scanning locked · {lockReason}</p>
          )}
        </>
      ) : (
        /* ---------- RESULT VIEW ---------- */
        <div className="mx-3 mt-3 space-y-3 sm:mx-6">
          {/* LIVE MARKET DATA — real broker values only */}
          <div className="rounded-[24px] border border-white/8 bg-[#151a20] p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-white/35">
                <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                LIVE MARKET DATA
              </p>
              <span
                className="rounded-full px-3 py-1 text-[10px] font-bold"
                style={{
                  border: `1px solid ${analysis.executionReady ? "#22c55e66" : "#9ca3af55"}`,
                  color: analysis.executionReady ? "#4ade80" : "#9ca3af",
                }}
              >
                {analysis.executionReady ? "LIVE QUOTE" : "CONDITIONAL · NO LIVE QUOTE"}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <p data-testid="text-live-price" className="text-[30px] font-black leading-none text-white">
                {analysis.livePrice > 0 ? fmtPrice(analysis.livePrice) : "—"}
              </p>
              <p className="text-[11px] font-semibold text-white/45">{analysis.dataSource}</p>
            </div>
            {analysis.lastCandle && (
              <p className="mt-2 text-[11px] text-white/40">
                Latest candle ({analysis.timeframe}): O {fmtPrice(analysis.lastCandle.open)} · H{" "}
                {fmtPrice(analysis.lastCandle.high)} · L {fmtPrice(analysis.lastCandle.low)} · C{" "}
                {fmtPrice(analysis.lastCandle.close)} · {analysis.candleCount} candles loaded
              </p>
            )}
            <div className="mt-3 space-y-2">
              {analysis.readouts.map((readout) => (
                <div key={readout.label} className="flex items-center justify-between text-[12px]">
                  <span className="text-white/40">{readout.label}</span>
                  <span
                    className="font-bold"
                    style={{
                      color: readout.bullish === true ? "#22c55e" : readout.bullish === false ? "#ef4444" : "rgba(255,255,255,0.85)",
                    }}
                  >
                    {readout.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* TRADE PLAN — real calculated levels */}
          <div className="rounded-[24px] border-2 bg-[#151a20] p-4" style={{ borderColor: `${SIGNAL_COLORS[analysis.signal]}44` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] text-white/35">TRADE PLAN</p>
                <h2 data-testid="text-analysis-symbol" className="mt-1 text-[22px] font-black text-white">
                  {analysis.symbol}
                </h2>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  data-testid="status-analysis-signal"
                  className="rounded-full px-6 py-2 text-[13px] font-bold text-white"
                  style={{ background: SIGNAL_COLORS[analysis.signal] }}
                >
                  {analysis.signal}
                </span>
                <span className="text-[10px] font-bold text-white/40">CONFIDENCE {analysis.confidence}%</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-[16px] bg-[#0d1116] p-3 text-center">
                <p className="text-[10px]" style={{ color: accent }}>
                  ENTRY
                </p>
                <p data-testid="text-analysis-entry" className="mt-1 text-[13px] font-bold text-white">
                  {fmtSignalLevel(analysis.entry)}
                </p>
              </div>
              <div className="rounded-[16px] bg-[#0d1116] p-3 text-center">
                <p className="text-[10px] text-red-400">STOP-LOSS</p>
                <p data-testid="text-analysis-stop-loss" className="mt-1 text-[13px] font-bold text-white">
                  {fmtSignalLevel(analysis.stopLoss)}
                </p>
              </div>
              <div className="rounded-[16px] bg-[#0d1116] p-3 text-center">
                <p className="text-[10px] text-green-400">TAKE-PROFIT</p>
                <p data-testid="text-analysis-take-profit" className="mt-1 text-[13px] font-bold text-white">
                  {fmtSignalLevel(analysis.takeProfit)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px]">
              <span className="text-white/30">RISK : REWARD</span>
              <span data-testid="text-analysis-risk-reward" className="font-bold" style={{ color: accent }}>
                {analysis.riskReward}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-white/30">CONFIDENCE</span>
              <span data-testid="text-analysis-confidence" className="font-bold" style={{ color: accent }}>
                {analysis.confidence}%
              </span>
            </div>

            <div className="mt-3 space-y-1.5">
              {analysis.reasons.map((reason, index) => (
                <p key={index} className="flex gap-2 text-[12px] leading-relaxed text-white/50">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />
                  <span>{reason}</span>
                </p>
              ))}
            </div>

            {/* EXECUTE TRADE — the single visible action on a valid plan */}
            <button
              type="button"
              onClick={openConfirm}
              disabled={executing}
              data-testid="button-execute-trade"
              className="mt-4 flex h-[58px] w-full items-center justify-center rounded-full text-[15px] font-black tracking-wide text-white transition-transform active:scale-[0.98] disabled:opacity-60"
              style={{ background: accent, boxShadow: `0 0 24px ${accent}66` }}
            >
              {executing ? "EXECUTING..." : `EXECUTE TRADE — ${analysis.signal} ${lot} Lot`}
            </button>

            {/* Connection lifecycle: Offline → Connecting → Connected → Executing → Executed → Disconnected */}
            <div data-testid="chain-execution-status" className="mt-3 flex flex-wrap items-center gap-1.5">
              {statusChain.map((stage) => {
                const order = ["OFFLINE", "CONNECTING", "CONNECTED", "EXECUTING", "EXECUTED", "DISCONNECTED"] as const;
                const currentIndex = order.indexOf(execStage);
                const stageIndex = order.indexOf(stage.label);
                const done = stageIndex < currentIndex || (executed && stage.label !== "DISCONNECTED");
                const active = stageIndex === currentIndex && !executed;
                const color = done || active ? accent : "rgba(255,255,255,0.25)";
                return (
                  <span
                    key={stage.label}
                    className="rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide"
                    style={{
                      borderColor: active ? accent : color + "55",
                      color,
                      backgroundColor: active ? accent + "1f" : "transparent",
                    }}
                  >
                    {stage.label}
                  </span>
                );
              })}
            </div>

            {/* EXECUTING state — live progress while the order is in flight */}
            {executing && (
              <div className="mt-3 rounded-[16px] border border-yellow-400/25 bg-yellow-400/[0.05] p-3">
                <p className="text-[12px] font-bold text-yellow-300">EXECUTING — {execStage === "CONNECTING" ? "opening broker connection" : "order in flight"}</p>
                <p className="mt-1 text-[12px] text-white/60">{execProgress || "Connecting and sending the order..."}</p>
              </div>
            )}

            {/* EXECUTED state — real broker ticket + price */}
            {executed && execResult && (
              <div className="mt-3 rounded-[16px] border border-emerald-400/30 bg-emerald-400/[0.06] p-3">
                <p className="text-[12px] font-black tracking-wide text-emerald-300">EXECUTED ✔</p>
                <div className="mt-1.5 space-y-1 text-[12px] text-white/70">
                  <p>
                    Order: {analysis.signal} {analysis.symbol} · {lot} lots × {trades}
                  </p>
                  {execResult.orderId && <p>Ticket / order ID: {execResult.orderId}</p>}
                  {execResult.executionPrice !== undefined && (
                    <p>Execution price: {fmtPrice(execResult.executionPrice)}</p>
                  )}
                  <p className="text-white/50">{execResult.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysis(null);
                    resetResult();
                  }}
                  className="mt-3 h-[44px] w-full rounded-full border text-[13px] font-bold"
                  style={{ borderColor: `${accent}40`, color: accent }}
                >
                  New scan
                </button>
              </div>
            )}

            {/* ERROR state — the real backend/broker error, verbatim */}
            {execError && (
              <div className="mt-3 rounded-[16px] border border-red-500/30 bg-red-500/[0.06] p-3">
                <p className="text-[12px] font-black tracking-wide text-red-300">EXECUTION ERROR</p>
                <p className="mt-1 text-[12px] leading-relaxed text-white/65">{execError}</p>
                <button
                  type="button"
                  onClick={() => setExecError("")}
                  className="mt-3 h-[44px] w-full rounded-full border border-red-400/40 text-[13px] font-bold text-red-300"
                >
                  Try again
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setAnalysis(null);
                resetResult();
              }}
              className="mt-3 h-[48px] w-full rounded-full border text-[14px] font-bold"
              style={{ borderColor: `${accent}40`, color: accent }}
            >
              New scan
            </button>
          </div>
        </div>
      )}

      {/* Confirmation popup — symbol, direction, entry, SL, TP and lot */}
      <Dialog open={confirmOpen} onOpenChange={(open) => (open ? setConfirmOpen(true) : setConfirmOpen(false))}>
        <DialogContent className="max-w-sm rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Confirm trade</DialogTitle>
            <DialogDescription className="text-sm text-white/55">
              The order is sent through the secure server-side MT5 link. Nothing is executed until you confirm.
            </DialogDescription>
          </DialogHeader>
          {analysis && (
            <div className="mt-2 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[13px]">
              <div className="flex justify-between">
                <span className="text-white/45">Symbol</span>
                <span className="font-bold text-white">{analysis.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Direction</span>
                <span className="font-black" style={{ color: SIGNAL_COLORS[analysis.signal] }}>
                  {analysis.signal}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Entry</span>
                <span className="font-bold text-white">{fmtPrice(analysis.entry)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Stop-loss</span>
                <span className="font-bold text-red-300">{fmtPrice(analysis.stopLoss)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Take-profit</span>
                <span className="font-bold text-green-300">{fmtPrice(analysis.takeProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Lot size</span>
                <span className="font-bold text-white">{lot}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Trades</span>
                <span className="font-bold text-white">{trades}</span>
              </div>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="h-12 flex-1 rounded-2xl border border-white/15 text-sm font-bold text-white/75"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={() => void confirmExecute()}
              data-testid="button-confirm-execute"
              className="h-12 flex-1 rounded-2xl text-sm font-black text-white"
              style={{ background: accent }}
            >
              CONFIRM
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
