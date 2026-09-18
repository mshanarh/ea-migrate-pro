import { useEffect, useRef, useState } from "react";
type ScannerTimeframe = "15m" | "1h" | "4h";

type ScannerAnalysis = {
  symbol: string;
  timeframe: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  signal: "BUY" | "SELL" | "NO TRADE";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  executionReady: boolean;
  atr: number;
  rsi: number;
  reasons: string[];
  readouts: { label: string; value: string; bullish: boolean | null }[];
};

function detectTimeframe(file: File): ScannerTimeframe {
  const name = file.name.toLowerCase();
  if (/(^|[^\d])15(?:m|min|minute)(?=[^a-z]|$)/.test(name)) return "15m";
  if (/(^|[^\d])4(?:h|hour)(?=[^a-z]|$)/.test(name)) return "4h";
  if (/(^|[^\d])1(?:h|hour)(?=[^a-z]|$)/.test(name)) return "1h";
  return "1h";
}

function chartOnlyFallback(symbol: string, timeframe: string, reason: string): ScannerAnalysis {
  return {
    symbol,
    timeframe,
    bias: "NEUTRAL",
    signal: "NO TRADE",
    confidence: 0,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: "—",
    executionReady: false,
    atr: 0,
    rsi: 50,
    reasons: [reason, "Upload a clearer candlestick chart to get a directional signal."],
    readouts: [
      { label: "Chart source", value: "Uploaded image", bullish: null },
      { label: "Candle colors", value: "Not detected", bullish: null },
      { label: "Signal", value: "NO TRADE", bullish: null },
    ],
  };
}

function analyzeUploadedChart(source: string, symbol: string, timeframe: string): Promise<ScannerAnalysis> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = 320;
        const height = Math.max(180, Math.round(width * (image.naturalHeight / Math.max(image.naturalWidth, 1))));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be read."));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let green = 0;
        let red = 0;
        let earlyGreen = 0;
        let earlyRed = 0;
        let recentGreen = 0;
        let recentRed = 0;
        const top = Math.floor(height * 0.08);
        const bottom = Math.floor(height * 0.88);
        for (let y = top; y < bottom; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const r = pixels[index] ?? 0;
            const g = pixels[index + 1] ?? 0;
            const b = pixels[index + 2] ?? 0;
            const isGreen = g > 75 && g > r * 1.22 && g > b * 1.08;
            const isRed = r > 75 && r > g * 1.22 && r > b * 1.08;
            if (isGreen) {
              green += 1;
              if (x < width * 0.55) earlyGreen += 1;
              else recentGreen += 1;
            } else if (isRed) {
              red += 1;
              if (x < width * 0.55) earlyRed += 1;
              else recentRed += 1;
            }
          }
        }
        const total = green + red;
        if (total < 12) {
          resolve(chartOnlyFallback(symbol, timeframe, "No clear green or red candlesticks were detected in the uploaded chart."));
          return;
        }
        const trendScore = (recentGreen - recentRed) - (earlyGreen - earlyRed) * 0.5;
        const signal: ScannerAnalysis["signal"] = trendScore >= 0 ? "BUY" : "SELL";
        const bias: ScannerAnalysis["bias"] = signal === "BUY" ? "BULLISH" : "BEARISH";
        const confidence = Math.min(84, 56 + Math.round(Math.min(28, Math.abs(trendScore) / 12)));
        const directionText = signal === "BUY" ? "recent candles lean upward" : "recent candles lean downward";
        resolve({
          symbol,
          timeframe,
          bias,
          signal,
          confidence,
          entry: 0,
          stopLoss: 0,
          takeProfit: 0,
          riskReward: "—",
          executionReady: false,
          atr: 0,
          rsi: 50,
          reasons: [
            "Chart-only signal from the uploaded candlestick image.",
            "The " + directionText + " based on the green/red candle balance.",
            "Trading stays disabled because this scan does not use a live price.",
          ],
          readouts: [
            { label: "Chart source", value: "Uploaded image", bullish: null },
            { label: "Green / red candles", value: green + " / " + red, bullish: signal === "BUY" },
            { label: "Detected direction", value: signal, bullish: signal === "BUY" },
          ],
        });
      } catch {
        resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be analyzed."));
      }
    };
    image.onerror = () => resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be opened."));
    image.src = source;
  });
}
/**
 * ChartScanner — the AI Scanner experience.
 *
 * Chart Scanner reads the uploaded chart image locally. It does not require
 * an MT5 account or live market data. Directional chart signals are for
 * analysis only; broker execution remains disabled for screenshot-based reads.
 *
 * Everything follows the user's accent color from the customization drawer.
 */

type Props = {
  /** Symbols the mentor attached to this bot (EA creation on the mentor portal). */
  symbols: string[];
  /** Per-symbol lot/max trades saved on the robot (falls back to sensible defaults). */
  pairs?: { symbol: string; lotSize: string; maxTrades: string }[];
  /** Accent color hex, applied to buttons, bullets and highlights. */
  accent: string;
  /** Remaining scans today (out of 5). Infinity for unlimited admins. */
  scansLeft: number;
  /** Called when the user taps Scan — registers the daily scan. Return false to block (limit reached). */
  onScanStart: () => boolean;
  /** Fires the top execution steps from the RESULT view only. */
  onExecute: (details: { symbol: string; lot: string; trades: number; direction: "BUY" | "SELL"; stopLoss?: string; takeProfit?: string }) => void;
};

const SCAN_STEPS = [
  "Preparing uploaded chart...",
  "Reading candle colors & price action...",
  "Measuring recent direction...",
  "Checking bullish vs bearish momentum...",
  "Scoring chart trend strength...",
  "Building chart signal...",
];

const MAX_CHART_BYTES = 5 * 1024 * 1024;
type ScannerTimeframe = "15m" | "1h" | "4h";

type ScannerAnalysis = {
  symbol: string;
  timeframe: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  signal: "BUY" | "SELL" | "NO TRADE";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  executionReady: boolean;
  atr: number;
  rsi: number;
  reasons: string[];
  readouts: { label: string; value: string; bullish: boolean | null }[];
};

function detectTimeframe(file: File): ScannerTimeframe {
  const name = file.name.toLowerCase();
  if (/(^|[^\d])15(?:m|min|minute)(?=[^a-z]|$)/.test(name)) return "15m";
  if (/(^|[^\d])4(?:h|hour)(?=[^a-z]|$)/.test(name)) return "4h";
  if (/(^|[^\d])1(?:h|hour)(?=[^a-z]|$)/.test(name)) return "1h";
  return "1h";
}

function chartOnlyFallback(symbol: string, timeframe: string, reason: string): ScannerAnalysis {
  return {
    symbol,
    timeframe,
    bias: "NEUTRAL",
    signal: "NO TRADE",
    confidence: 0,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: "—",
    executionReady: false,
    atr: 0,
    rsi: 50,
    reasons: [reason, "Upload a clearer candlestick chart to get a directional signal."],
    readouts: [
      { label: "Chart source", value: "Uploaded image", bullish: null },
      { label: "Candle colors", value: "Not detected", bullish: null },
      { label: "Signal", value: "NO TRADE", bullish: null },
    ],
  };
}

function analyzeUploadedChart(source: string, symbol: string, timeframe: string): Promise<ScannerAnalysis> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = 320;
        const height = Math.max(180, Math.round(width * (image.naturalHeight / Math.max(image.naturalWidth, 1))));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be read."));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let green = 0;
        let red = 0;
        let earlyGreen = 0;
        let earlyRed = 0;
        let recentGreen = 0;
        let recentRed = 0;
        const top = Math.floor(height * 0.08);
        const bottom = Math.floor(height * 0.88);
        for (let y = top; y < bottom; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const r = pixels[index] ?? 0;
            const g = pixels[index + 1] ?? 0;
            const b = pixels[index + 2] ?? 0;
            const isGreen = g > 75 && g > r * 1.22 && g > b * 1.08;
            const isRed = r > 75 && r > g * 1.22 && r > b * 1.08;
            if (isGreen) {
              green += 1;
              if (x < width * 0.55) earlyGreen += 1;
              else recentGreen += 1;
            } else if (isRed) {
              red += 1;
              if (x < width * 0.55) earlyRed += 1;
              else recentRed += 1;
            }
          }
        }
        const total = green + red;
        if (total < 12) {
          resolve(chartOnlyFallback(symbol, timeframe, "No clear green or red candlesticks were detected in the uploaded chart."));
          return;
        }
        const trendScore = (recentGreen - recentRed) - (earlyGreen - earlyRed) * 0.5;
        const signal: ScannerAnalysis["signal"] = trendScore >= 0 ? "BUY" : "SELL";
        const bias: ScannerAnalysis["bias"] = signal === "BUY" ? "BULLISH" : "BEARISH";
        const confidence = Math.min(84, 56 + Math.round(Math.min(28, Math.abs(trendScore) / 12)));
        const directionText = signal === "BUY" ? "recent candles lean upward" : "recent candles lean downward";
        resolve({
          symbol,
          timeframe,
          bias,
          signal,
          confidence,
          entry: 0,
          stopLoss: 0,
          takeProfit: 0,
          riskReward: "—",
          executionReady: false,
          atr: 0,
          rsi: 50,
          reasons: [
            "Chart-only signal from the uploaded candlestick image.",
            "The " + directionText + " based on the green/red candle balance.",
            "Trading stays disabled because this scan does not use a live price.",
          ],
          readouts: [
            { label: "Chart source", value: "Uploaded image", bullish: null },
            { label: "Green / red candles", value: green + " / " + red, bullish: signal === "BUY" },
            { label: "Detected direction", value: signal, bullish: signal === "BUY" },
          ],
        });
      } catch {
        resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be analyzed."));
      }
    };
    image.onerror = () => resolve(chartOnlyFallback(symbol, timeframe, "The uploaded chart could not be opened."));
    image.src = source;
  });
}

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

export default function ChartScanner({ symbols, pairs = [], accent, scansLeft, onScanStart, onExecute }: Props {
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState<ScannerTimeframe>("1h");
  const [trades, setTrades] = useState(5);
  const [lot, setLot] = useState("0.01");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [analysis, setAnalysis] = useState<ScannerAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [chartSrc, setChartSrc] = useState<string | null>(null);
  const [chartError, setChartError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [autoScanPending, setAutoScanPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasSymbols = symbols.length > 0;
  const lotValid = Number(lot) > 0;
  // Chart scans only need an uploaded image and valid trade settings.
  const scanLocked = !chartSrc || !lotValid || trades < 1;
  const lockReason = !chartSrc
    ? "Upload your chart first"
    : !lotValid
      ? "Set a lot size"
      : "";

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
      setDone(false);
      setAnalysis(null);
      setAnalysisError("");
      // Pressing Scan without a chart opened the picker — start scanning
      // automatically the moment the picture lands.
      if (autoScanPending) {
        setAutoScanPending(false);
        window.setTimeout(() => void runScanRef.current?.(), 150);
      }
    };
    reader.onerror = () => setChartError("Could not read that image.");
    reader.readAsDataURL(file);
  };

  const runScan = async () => {
    if (!chartSrc || scanning) return;
    // One of the 5 daily scans is consumed here — the route blocks when out of scans.
    if (!onScanStart()) return;
    setScanning(true);
    setDone(false);
    setStep(0);
    setAnalysis(null);
    setAnalysisError("");
    // Narrated steps advance while the real analysis runs. Show the result
    // as soon as the live analysis responds — never add an artificial delay.
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setStep(Math.min(index, SCAN_STEPS.length - 1));
    }, 650);
    try {
      const result = await analyzeUploadedChart(chartSrc, symbol || "CHART", timeframe);
      setAnalysis(result);
    } catch {
      setAnalysisError("Could not run the market analysis. Check your connection and try again.");
    } finally {
      window.clearInterval(interval);
      setScanning(false);
      setDone(true);
    }
  };
  const runScanRef = useRef<(() => Promise<void>) | null>(null);
  runScanRef.current = runScan;

  /** Scan button: no chart yet → open the picker and scan as soon as it's chosen. */
  const startScan = () => {
    if (scanning || scanLocked) return;
    if (!chartSrc) {
      setAutoScanPending(true);
      fileInputRef.current?.click();
      return;
    }
    void runScan();
  };

  const selectSymbol = (item: string) => {
    setSymbol(item);
    const saved = pairs.find((pair) => pair.symbol === item);
    setLot(saved?.lotSize || "0.01");
    const savedTrades = Number(saved?.maxTrades ?? 0);
    setTrades(savedTrades > 0 ? Math.min(savedTrades, 20) : 5);
    setDone(false);
    setAnalysis(null);
    setAnalysisError("");
  };

  const statusLine = scanning
    ? "Analyzing uploaded chart..."
    : done
      ? analysis
        ? "Analysis complete"
        : analysisError
          ? "Analysis unavailable"
          : "Chart read complete"
      : chartSrc
        ? "Chart ready to scan"
        : "Press scan to upload your chart";

  return (
    <div className="flex w-full flex-col pb-[130px]" style={{ backgroundColor: "#0A0A0A" }}>
      {/* Header — title, scans-left badge */}
      <div className="flex items-center justify-between p-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Chart Scanner</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] text-white/40">
            <span className="inline-block size-2 rounded-full" style={{ background: accent }} />
            UPLOAD A CHART · GET A SIGNAL
          </p>
        </div>
        <span className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white/70">
          {scansLeft === Infinity ? "∞ UNLIMITED" : `${scansLeft}/5`}
        </span>
      </div>

      {/* Chart upload — chart-only scanner */}
      <div
        className="relative mx-3 min-h-[300px] overflow-hidden rounded-[26px] border-2 border-dashed"
        style={{ borderColor: dragging ? "#ff334d" : "#9c1d2d", backgroundColor: "#180609" }}
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
            className="relative z-10 flex min-h-[300px] w-full flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <span className="flex size-[88px] items-center justify-center rounded-full border-2 border-[#ff233f] text-[#ff233f] shadow-[0_0_28px_rgba(255,35,63,0.2)]">
              <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4" />
              </svg>
            </span>
            <span className="text-[20px] font-black text-white">Upload your chart</span>
            <span className="text-[14px] text-white/45">Screenshot your chart and drop it here</span>
          </button>
        ) : (
          <img src={chartSrc} alt="Uploaded chart" className="absolute inset-0 size-full object-cover" />
        )}
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(rgba(255,35,63,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,35,63,0.16) 1px, transparent 1px)", backgroundSize: "38px 38px" }} />
        {scanning && <div className="absolute inset-x-0 top-1/2 z-10 h-[2px] animate-[scanMove_2s_ease-in-out_infinite] bg-[#ff233f] shadow-[0_0_15px_#ff233f]" />}
        {chartSrc && !scanning && (
          <button
            type="button"
            aria-label="Remove chart"
            onClick={() => {
              setChartSrc(null);
              setDone(false);
              setAnalysis(null);
              setAnalysisError("");
            }}
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/85"
          >
            ✕
          </button>
        )}
        {(chartSrc || scanning) && (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 text-[12px] font-semibold text-[#ff5a6e]">
            <span className="text-[14px]">⌜⌝</span>
            {statusLine}
          </div>
        )}
        {chartError && <p className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 text-center text-[12px] text-red-300">{chartError}</p>}
      </div>

      {!done ? (
        <>
          {/* Upload row — hidden while scanning */}
          {!scanning && (
            <div className="mx-3 mt-3">
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-bold text-white/80 transition-colors hover:bg-white/[0.08]"
              >
                📈 {chartSrc ? "Replace chart image" : "Upload chart screenshot"}
              </button>
              {chartError && <p className="mt-2 text-[12px] text-red-400">{chartError}</p>}
            </div>
          )}

          {/* Narrated analysis steps */}
          {scanning && (
            <div className="mt-4 space-y-2 px-6">
              {SCAN_STEPS.slice(0, step + 1).map((text, index) => (
                <div key={index} className="flex gap-2 text-[13px] text-white/70">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: accent }} />
                  {text}
                </div>
              ))}
            </div>
          )}

          {/* SYMBOL — exactly the mentor's EA symbols; the user picks one */}
          <div className="mx-3 mt-4 rounded-[20px] border border-white/5 bg-[#151515] p-4">
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
                  style={symbol === item ? { background: accent, color: "#fff" } : { background: "#222", color: "rgba(255,255,255,0.5)" }}
                >
                  {item}
                </button>
              ))}
            </div>
            {!hasSymbols && (
              <p className="mt-3 text-[12px] font-semibold text-white/45">
                No symbols on this EA yet — your mentor adds them on the portal when creating the EA. Until then scanning is locked.
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[10px] tracking-[0.28em] text-white/30">AUTO TIMEFRAME</p>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-bold text-white/65">
                {timeframe}
              </span>
            </div>
          </div>

          {/* Trades + lot size */}
          <div className="mx-3 mt-3 divide-y divide-white/5 rounded-[20px] border border-white/5 bg-[#151515]">
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

          {/* Scan button — locked until symbol + chart + lot + trades + account are all set */}
          <button
            type="button"
            onClick={startScan}
            disabled={scanning || scanLocked}
            className="mx-3 mt-4 flex h-[56px] items-center justify-center gap-2 rounded-full font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: accent, boxShadow: scanLocked ? "none" : `0 0 20px ${accent}66` }}
          >
            <span className="text-[15px]">⌜⌝</span> {scanning ? "SCANNING..." : `Scan ${symbol || "chart"}`}
          </button>
          {scanLocked && !scanning && lockReason && (
            <p className="mx-6 mt-2 text-center text-[12px] font-semibold text-white/40">🔒 {lockReason}</p>
          )}
        </>
      ) : (
        /* ---------- RESULT VIEW ---------- */
        <div className="mx-3 mt-3 space-y-3">
          {analysisError && (
            <div className="rounded-[24px] border border-red-500/25 bg-red-500/[0.06] p-4">
              <p className="text-[13px] font-bold text-red-300">Scan failed</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/60">{analysisError}</p>
            </div>
          )}

          {analysis && (
            <>
              {/* Chart read — real bias + indicator readouts */}
              <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4">
                <div className="flex justify-between">
                  <span className="text-[11px] tracking-[0.18em] text-white/40">⌜⌝ CHART SIGNAL · {analysis.timeframe}</span>
                  <span
                    className="rounded-full border px-3 py-1 text-[11px] font-bold"
                    style={{
                      borderColor: analysis.bias === "BULLISH" ? "#22c55e55" : analysis.bias === "BEARISH" ? "#ef444455" : "#9ca3af55",
                      color: analysis.bias === "BULLISH" ? "#22c55e" : analysis.bias === "BEARISH" ? "#ef4444" : "#9ca3af",
                    }}
                  >
                    {analysis.bias}
                  </span>
                </div>
                <div className="mt-4 space-y-2">
                  {analysis.readouts.map((readout) => (
                    <div key={readout.label} className="flex items-center justify-between text-[12px]">
                      <span className="text-white/40">{readout.label}</span>
                      <span
                        className="font-bold"
                        style={{ color: readout.bullish === true ? "#22c55e" : readout.bullish === false ? "#ef4444" : "rgba(255,255,255,0.85)" }}
                      >
                        {readout.value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-white/30">CONFIDENCE</span>
                    <span className="text-white">{analysis.confidence}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#222]">
                    <div className="h-2 rounded-full" style={{ width: `${analysis.confidence}%`, background: accent }} />
                  </div>
                </div>
              </div>

              {/* Trade plan — real levels from the analysis */}
              <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[22px] font-black text-white">↗ {analysis.symbol}</h2>
                  <span className="rounded-full px-6 py-2 text-[13px] font-bold text-white" style={{ background: SIGNAL_COLORS[analysis.signal] }}>
                    {analysis.signal}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-[16px] bg-black p-3 text-center">
                    <p className="text-[10px]" style={{ color: accent }}>ENTRY</p>
                    <p className="mt-1 text-[12px] font-bold text-white">{fmtSignalLevel(analysis.entry)}</p>
                  </div>
                  <div className="rounded-[16px] bg-black p-3 text-center">
                    <p className="text-[10px] text-red-400">⚠ SL</p>
                    <p className="mt-1 text-[12px] font-bold text-white">{fmtSignalLevel(analysis.stopLoss)}</p>
                  </div>
                  <div className="rounded-[16px] bg-black p-3 text-center">
                    <p className="text-[10px] text-green-400">TP</p>
                    <p className="mt-1 text-[12px] font-bold text-white">{fmtSignalLevel(analysis.takeProfit)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-white/30">RISK : REWARD</span>
                  <span className="font-bold" style={{ color: accent }}>{analysis.riskReward}</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {analysis.reasons.map((reason, index) => (
                    <p key={index} className="text-[12px] leading-relaxed text-white/50">• {reason}</p>
                  ))}
                </div>

                {/* Chart-only signals are informational; broker execution is disabled. */}
                {analysis.signal === "NO TRADE" ? (
                  <button
                    type="button"
                    disabled
                    className="mt-4 flex h-[56px] w-full items-center justify-center rounded-full bg-white/10 font-bold text-white/50"
                  >
                    No high-probability setup — Execute disabled
                  </button>
                ) : !analysis.executionReady ? (
                  <button
                    type="button"
                    disabled
                    className="mt-4 flex h-[56px] w-full items-center justify-center rounded-full bg-white/10 font-bold text-white/50"
                  >
                    Chart signal only — Trading disabled
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onExecute({ symbol: analysis.symbol, lot, trades, direction: analysis.signal as "BUY" | "SELL", stopLoss: String(analysis.stopLoss), takeProfit: String(analysis.takeProfit) })}
                    className="mt-4 flex h-[56px] w-full items-center justify-center rounded-full font-bold text-white"
                    style={{ background: accent }}
                  >
                    Execute {trades} Trades — {analysis.signal} {lot} Lot
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDone(false);
                    setAnalysis(null);
                    setAnalysisError("");
                  }}
                  className="mt-3 h-[48px] w-full rounded-full border text-[14px] font-bold"
                  style={{ borderColor: `${accent}40`, color: accent }}
                >
                  ↻ New Scan
                </button>
              </div>
            </>
          )}

          {!analysis && !analysisError && (
            <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4 text-center">
              <p className="text-[13px] text-white/60">Scan finished without a result — try again.</p>
              <button
                type="button"
                onClick={() => setDone(false)}
                className="mt-3 h-[48px] w-full rounded-full border text-[14px] font-bold"
                style={{ borderColor: `${accent}40`, color: accent }}
              >
                ↻ New Scan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
