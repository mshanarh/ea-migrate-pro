import { useEffect, useState } from "react";

/**
 * ChartScanner — the AI Scanner experience.
 *
 * Phase 1 (scan): pick a pair from My Pairs, set trades + lot, watch the scan
 * line sweep the chart while the analysis steps narrate.
 * Phase 2 (result): chart read card (signal, order, lot/trades, confidence),
 * trade plan (entry / SL / TP), and an EXECUTE button that fires the
 * execution steps overlay at the top of the screen for the chosen trades.
 *
 * Everything follows the user's accent color from the customization drawer.
 */

type Props = {
  /** Pairs the user owns (My Pairs from the trading pairs store). */
  pairs: { id: string; symbol: string; lotSize: number; maxTrades: number }[];
  /** Accent color hex, applied to buttons, bullets and highlights. */
  accent: string;
  /** Active EA name shown in the execute call. */
  eaName: string;
  /** Fires the top execution steps overlay. */
  onExecute: (details: { symbol: string; lot: string; trades: number }) => void;
  /** Remaining scans today (out of 5). */
  scansLeft: number;
  /** Called when the user taps Scan — registers the daily scan. Return false to block (limit reached). */
  onScanStart: () => boolean;
  /** Redirect helper when there are no pairs. */
  onGoToPairs: () => void;
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

export default function ChartScanner({ pairs, accent, eaName, onExecute, scansLeft, onScanStart, onGoToPairs }: Props) {
  const [symbol, setSymbol] = useState("");
  const [trades, setTrades] = useState(5);
  const [lot, setLot] = useState("0.01");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [missing, setMissing] = useState(false);

  // Preselect the first pair and apply its lot/max trades as the starting values.
  useEffect(() => {
    if (pairs.length === 0) return;
    const first = pairs[0];
    if (first) {
      if (!symbol) setSymbol(first.symbol);
      setLot(String(first.lotSize));
      setTrades(first.maxTrades > 0 ? Math.min(first.maxTrades, 20) : 5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs]);

  const startScan = () => {
    if (!symbol) {
      setMissing(true);
      return;
    }
    if (trades > 20) return;
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

  if (pairs.length === 0) {
    return (
      <div className="flex h-[100dvh] w-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center">
        <p className="text-4xl">📊</p>
        <p className="text-sm font-bold text-white">No pairs added yet</p>
        <p className="max-w-[260px] text-[13px] text-white/40">
          Go to Trading Pairs and add pairs first — the scanner only scans My Pairs.
        </p>
        <button
          type="button"
          onClick={onGoToPairs}
          className="mt-3 rounded-full px-8 py-3 text-sm font-black text-white"
          style={{ background: accent }}
        >
          ADD PAIRS
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col overflow-y-auto pb-[130px]" style={{ backgroundColor: "#0A0A0A" }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <h1 className="text-sm font-bold tracking-[0.18em] text-white">CHART SCANNER</h1>
        <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/60">
          {scansLeft}/5 SCANS LEFT
        </span>
      </div>

      {/* Chart box with moving scan line */}
      <div className="relative mx-3 h-[240px] overflow-hidden rounded-[24px] border border-white/10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_49%,rgba(255,255,255,0.05)_50%,transparent_51%)] bg-[length:40px_100%]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_49%,rgba(255,255,255,0.04)_50%,transparent_51%)] bg-[length:100%_40px]" />
        {scanning && (
          <div
            className="absolute inset-x-0 z-10 h-[2px] animate-[scanMove_2s_ease-in-out_infinite] shadow-[0_0_15px_white]"
            style={{ backgroundColor: accent }}
          />
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[12px]" style={{ color: accent }}>
          ⌜⌝ {scanning ? `Scanning ${symbol}...` : done ? "Chart read complete" : "Chart ready to scan"}
        </div>
      </div>

      {!done ? (
        <>
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

          {/* Pair selector */}
          <div className="mx-3 mt-4 rounded-[20px] border border-white/5 bg-[#151515] p-4">
            <p className="mb-3 text-[10px] tracking-[0.18em] text-white/30">SELECT PAIR — {pairs.length} ADDED</p>
            <div className="flex flex-wrap gap-2">
              {pairs.map((pair) => (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => {
                    setSymbol(pair.symbol);
                    setLot(String(pair.lotSize));
                    setTrades(pair.maxTrades > 0 ? Math.min(pair.maxTrades, 20) : 5);
                    setMissing(false);
                  }}
                  className="rounded-full px-5 py-2.5 text-[13px] font-bold transition-colors"
                  style={symbol === pair.symbol ? { background: accent, color: "#fff" } : { background: "#222", color: "rgba(255,255,255,0.5)" }}
                >
                  {pair.symbol}
                </button>
              ))}
            </div>
            {missing && !symbol && <p className="mt-3 text-[12px] text-red-400">Pick a pair first.</p>}
          </div>

          {/* Trades + lot size */}
          <div className="mx-3 mt-3 divide-y divide-white/5 rounded-[20px] border border-white/5 bg-[#151515]">
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="font-bold text-white">Trades</p>
                <p className="text-[11px] text-white/30">Max 20 per scan</p>
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

          {/* Scan button */}
          <button
            type="button"
            onClick={startScan}
            disabled={scanning}
            className="mx-3 mt-4 flex h-[56px] items-center justify-center gap-2 rounded-full font-bold text-white shadow-[0_0_20px_rgba(255,0,170,0.25)] transition-transform active:scale-[0.98] disabled:opacity-70"
            style={{ background: accent, boxShadow: `0 0 20px ${accent}66` }}
          >
            {scanning ? "SCANNING..." : `⌜⌝ Scan ${symbol}`}
          </button>
        </>
      ) : (
        /* ---------- RESULT VIEW ---------- */
        <div className="mx-3 mt-3 space-y-3">
          {/* Chart read */}
          <div className="rounded-[24px] border border-white/5 bg-[#151515] p-4">
            <div className="flex justify-between">
              <span className="text-[11px] tracking-[0.18em] text-white/40">⌜⌝ CHART READ</span>
              <span className="rounded-full border px-3 py-1 text-[11px] text-red-400" style={{ borderColor: `${accent}55`, color: accent }}>
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
