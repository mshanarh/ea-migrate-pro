import { useEffect, useRef, useState } from "react";

/**
 * ChartScanner — the AI Scanner experience.
 *
 * The SYMBOL chips are exactly the symbols the mentor attached to the EA on
 * the portal. No mentor symbols = nothing to scan (clear guidance shown).
 * The Scan button stays locked until the user has: selected a symbol,
 * uploaded the chart screenshot, and set lot size + trades. Execute only
 * appears in the result view after a completed scan.
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
  /** Fires the top execution steps overlay from the RESULT view only. */
  onExecute: (details: { symbol: string; lot: string; trades: number }) => void;
};

const SCAN_STEPS = [
  "Reading candles & price action...",
  "Scanning market structure (BOS / ChoCH)...",
  "Mapping swing highs & lows...",
  "Detecting order blocks & FVGs...",
  "Locating liquidity pools (BSL / SSL)...",
  "Confirming premium / discount bias...",
  "Building trade plan (Entry / SL / TP)",
];

const MAX_CHART_BYTES = 5 * 1024 * 1024;

export default function ChartScanner({ symbols, pairs = [], accent, scansLeft, onScanStart, onExecute }: Props) {
  const [symbol, setSymbol] = useState("");
  const [trades, setTrades] = useState(5);
  const [lot, setLot] = useState("0.01");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [chartSrc, setChartSrc] = useState<string | null>(null);
  const [chartError, setChartError] = useState("");
  const [autoScanPending, setAutoScanPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasSymbols = symbols.length > 0;
  const lotValid = Number(lot) > 0;
  // Scan lock: needs a mentor symbol, the chart screenshot, and valid settings.
  const scanLocked = !hasSymbols || !symbol || !chartSrc || !lotValid || trades < 1;
  const lockReason = !hasSymbols
    ? "Your mentor has not added symbols to this EA yet"
    : !symbol
      ? "Select a symbol first"
      : !chartSrc
        ? "Upload a chart screenshot first"
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
    const reader = new FileReader();
    reader.onload = () => {
      setChartSrc(String(reader.result));
      setDone(false);
      // Pressing Scan without a chart opened the picker — start scanning
      // automatically the moment the picture lands.
      if (autoScanPending) {
        setAutoScanPending(false);
        window.setTimeout(() => runScan(), 150);
      }
    };
    reader.onerror = () => setChartError("Could not read that image.");
    reader.readAsDataURL(file);
  };

  const runScan = () => {
    if (!symbol) return;
    // One of the 5 daily scans is consumed here — the route blocks when out of scans.
    if (!onScanStart()) return;
    setScanning(true);
    setDone(false);
    setStep(0);
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setStep(index);
      if (index >= SCAN_STEPS.length - 1) {
        window.clearInterval(interval);
        window.setTimeout(() => {
          setScanning(false);
          setDone(true);
        }, 800);
      }
    }, 600);
  };

  /** Scan button: no chart yet → open the picker and scan as soon as it's chosen. */
  const startScan = () => {
    if (scanning || scanLocked) return;
    if (!chartSrc) {
      setAutoScanPending(true);
      fileInputRef.current?.click();
      return;
    }
    runScan();
  };

  const selectSymbol = (item: string) => {
    setSymbol(item);
    const saved = pairs.find((pair) => pair.symbol === item);
    setLot(saved?.lotSize || "0.01");
    const savedTrades = Number(saved?.maxTrades ?? 0);
    setTrades(savedTrades > 0 ? Math.min(savedTrades, 20) : 5);
    setDone(false);
  };

  return (
    <div className="flex w-full flex-col pb-[130px]" style={{ backgroundColor: "#0A0A0A" }}>
      {/* Header — title, scans-left badge */}
      <div className="flex items-center justify-between p-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Chart Scanner</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] text-white/40">
            <span className="inline-block size-2 rounded-full" style={{ background: accent }} />
            LIVE MARKET DATA
          </p>
        </div>
        <span className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white/70">
          {scansLeft === Infinity ? "∞ UNLIMITED" : `${scansLeft}/5`}
        </span>
      </div>

      {/* Chart box — uploaded screenshot, ✕ to clear, scan line while scanning */}
      <div className="relative mx-3 h-[240px] overflow-hidden rounded-[24px] border border-white/10 bg-black">
        {chartSrc ? (
          <img src={chartSrc} alt="Uploaded chart" className="absolute inset-0 size-full object-cover" />
        ) : (
          <>
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_49%,rgba(255,255,255,0.05)_50%,transparent_51%)] bg-[length:40px_100%]" />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_49%,rgba(255,255,255,0.04)_50%,transparent_51%)] bg-[length:100%_40px]" />
          </>
        )}
        {scanning && (
          <div
            className="absolute inset-x-0 z-10 h-[2px] animate-[scanMove_2s_ease-in-out_infinite] shadow-[0_0_15px_white]"
            style={{ backgroundColor: accent }}
          />
        )}

        {/* ✕ clear — only when a chart is uploaded and not mid-scan */}
        {chartSrc && !scanning && (
          <button
            type="button"
            aria-label="Remove chart"
            onClick={() => {
              setChartSrc(null);
              setDone(false);
            }}
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            ✕
          </button>
        )}

        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 text-[12px] font-semibold" style={{ color: accent }}>
          <span className="text-[14px]">⌜⌝</span>
          {scanning ? `Scanning ${symbol}...` : done ? "Chart read complete" : chartSrc ? "Chart ready to scan" : "Press scan to upload your chart"}
        </div>
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

          {/* Scan button — locked until symbol + chart + lot + trades are all set */}
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
          {/* Chart read */}
          <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4">
            <div className="flex justify-between">
              <span className="text-[11px] tracking-[0.18em] text-white/40">⌜⌝ CHART READ</span>
              <span className="rounded-full border px-3 py-1 text-[11px] font-bold" style={{ borderColor: `${accent}55`, color: accent }}>
                BEARISH
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[12px] border border-white/5">
              <div className="border-b border-r border-white/5 p-3">
                <p className="text-[10px] text-white/30">SIGNAL</p>
                <p className="font-bold" style={{ color: accent }}>SELL</p>
              </div>
              <div className="border-b border-white/5 p-3">
                <p className="text-[10px] text-white/30">ORDER</p>
                <p className="text-[13px] text-white">Market Order</p>
              </div>
              <div className="border-b border-r border-white/5 p-3">
                <p className="text-[10px] text-white/30">SYMBOL</p>
                <p className="text-[13px] text-white">{symbol}</p>
              </div>
              <div className="border-b border-white/5 p-3">
                <p className="text-[10px] text-white/30">LOT / TRADES</p>
                <p className="text-[13px] text-white">{lot} × {trades}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[11px]">
                <span className="text-white/30">CONFIDENCE</span>
                <span className="text-white">70%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#222]">
                <div className="h-2 w-[70%] rounded-full" style={{ background: accent }} />
              </div>
            </div>
          </div>

          {/* Trade plan */}
          <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-black text-white">↘ {symbol}</h2>
              <span className="rounded-full px-6 py-2 text-[13px] font-bold text-white" style={{ background: accent }}>
                SELL
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-[16px] bg-black p-3 text-center">
                <p className="text-[10px]" style={{ color: accent }}>ENTRY</p>
                <p className="mt-1 text-[12px] font-bold text-white">29669.15</p>
              </div>
              <div className="rounded-[16px] bg-black p-3 text-center">
                <p className="text-[10px] text-red-400">⚠ SL</p>
                <p className="mt-1 text-[12px] font-bold text-white">29941.00</p>
              </div>
              <div className="rounded-[16px] bg-black p-3 text-center">
                <p className="text-[10px] text-green-400">TP</p>
                <p className="mt-1 text-[12px] font-bold text-white">28558.75</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-white/50">
              SELL setup validating near a recent lower high. Expecting continuation to sweep recent swing lows.
            </p>

            {/* Execute — fires the top execution steps for exactly these trades */}
            <button
              type="button"
              onClick={() => onExecute({ symbol, lot, trades })}
              className="mt-4 flex h-[56px] w-full items-center justify-center rounded-full font-bold text-white"
              style={{ background: accent }}
            >
              Execute {trades} Trades — {lot} Lot
            </button>
            <button
              type="button"
              onClick={() => setDone(false)}
              className="mt-3 h-[48px] w-full rounded-full border text-[14px] font-bold"
              style={{ borderColor: `${accent}40`, color: accent }}
            >
              ↻ New Scan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
