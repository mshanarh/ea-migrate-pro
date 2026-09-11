import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, CheckCircle2, Circle, LoaderCircle, Minus, Plus, ScanLine, TrendingUp, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { ExecutionNotification, type ExecutionStatus } from "@/components/ExecutionNotification";
import { useAppState } from "@/lib/app-store";
import { executeTrade, type TradeDirection } from "@/lib/execution";

export const Route = createFileRoute("/app/settings/scanner")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chart Scanner - EA Migrate Pro" }, { name: "description", content: "Scan a trading chart with live market data." }] }),
  component: Scanner,
});

type ScanState = "upload" | "scanning" | "result";
const SCAN_STEPS = [
  ["Reading candles & timeframe", "Decoding chart image and detecting period"],
  ["Syncing live broker prices", "Pulling bid / ask and current session range"],
  ["Mapping market structure", "Checking highs, lows and breaks of structure"],
  ["Locating liquidity zones", "Finding order blocks and imbalance zones"],
  ["Measuring momentum & trend", "Comparing RSI, MACD histogram and EMA"],
  ["Calculating volatility & risk", "Measuring ATR and safe trade distance"],
  ["Confirming higher timeframe bias", "Cross-checking HTF direction for confluence"],
  ["Building the trade setup", "Preparing entry, stop loss and take profit"],
] as const;

function Scanner() {
  const app = useAppState();
  const active = app.robots.find((robot) => robot.id === app.activeRobotId) || app.robots[0];
  const symbols = Array.from(new Set(active?.symbols || [])).filter(Boolean);
  const [state, setState] = useState<ScanState>("upload");
  const [image, setImage] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [trades, setTrades] = useState(1);
  const [lotSize, setLotSize] = useState("0.01");
  const [progress, setProgress] = useState(0);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus | null>(null);
  const [executionError, setExecutionError] = useState("");

  useEffect(() => {
    if (!symbols.length) {
      if (symbol) setSymbol("");
      return;
    }
    if (!symbols.includes(symbol)) setSymbol(symbols[0]);
  }, [symbol, symbols.join(",")]);

  useEffect(() => {
    if (state !== "scanning") return;
    setProgress(0);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 2);
      if (next === 100) {
        window.clearInterval(timer);
        window.setTimeout(() => setState("result"), 450);
      }
      return next;
    }), 110);
    return () => window.clearInterval(timer);
  }, [state]);

  const chooseImage = (file?: File) => {
    if (!file) return;
    if (image) URL.revokeObjectURL(image);
    setImage(URL.createObjectURL(file));
    setState("upload");
  };

  const scan = () => {
    if (!image) {
      toast.error("Upload a chart before scanning.");
      return;
    }
    setState("scanning");
  };

  const execute = () => {
    if (!active) { toast.error("Activate a robot before placing this trade."); return; }
    if (!app.mt) { toast.error("Connect MetaTrader 5 before placing this trade."); return; }
    setExecutionError("");
    setExecutionStatus("scanning");
    window.setTimeout(() => {
      setExecutionStatus("connecting");
      window.setTimeout(() => {
        setExecutionStatus("executing");
        void executeTrade({ robotId: active.id, symbol, direction: "SELL" as TradeDirection, lotSize, mt: app.mt! })
          .then(() => { setExecutionStatus("success"); window.setTimeout(() => setExecutionStatus(null), 4000); })
          .catch((error: unknown) => { setExecutionError(error instanceof Error ? error.message : "The execution service could not confirm the order."); setExecutionStatus("error"); window.setTimeout(() => setExecutionStatus(null), 6000); });
      }, 900);
    }, 900);
  };

  return <AppFrame><div className="min-h-screen bg-[#0A0A0A] px-5 pb-24 text-white">
    <header className="flex items-center gap-3 border-b border-white/10 py-5">
      <Link to="/app/settings" aria-label="Back to settings" className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5"><ArrowLeft className="size-5" /></Link>
      <div className="min-w-0 flex-1"><h1 className="text-xl font-black">Chart Scanner</h1><p className="mt-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/55"><span className="size-2 rounded-full bg-[#D32F2F] shadow-[0_0_8px_#D32F2F]" />Live market data</p></div>
      <ScanLine className="size-5 text-[#D32F2F]" />
    </header>

    {state === "upload" && <>
      <section className="mt-6 rounded-3xl border border-white/10 bg-[#111111] p-3">
        {image ? <div className="relative"><img src={image} alt="Uploaded trading chart" className="h-64 w-full rounded-2xl bg-black object-contain" /><button type="button" aria-label="Remove chart" onClick={() => { URL.revokeObjectURL(image); setImage(null); }} className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/80"><X className="size-4" /></button><div className="mt-3 flex items-center gap-2 px-1 text-sm font-bold text-[#38BDF8]"><CheckCircle2 className="size-4" />Chart ready to scan</div></div> : <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-[#0A0A0A] px-8 text-center"><ScanLine className="size-10 text-[#D32F2F]" /><p className="mt-4 text-lg font-black">Upload your chart</p><p className="mt-2 text-sm leading-5 text-white/55">Screenshot any MT4/MTF timeframe</p></div>}
        <div className="mt-3 grid grid-cols-2 gap-3"><label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 text-sm font-bold text-white/80"><Camera className="size-4" />Camera<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => chooseImage(event.target.files?.[0])} /></label><label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#D32F2F] text-sm font-bold text-white"><Upload className="size-4" />Upload<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseImage(event.target.files?.[0])} /></label></div>
      </section>
      <section className="mt-5 space-y-5 rounded-3xl border border-white/10 bg-[#111111] p-5">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Symbol</p>{symbols.length ? <div className="mt-3 flex flex-wrap gap-2">{symbols.map((item) => <button key={item} type="button" onClick={() => setSymbol(item)} className={`rounded-full px-4 py-2 text-sm font-black ${symbol === item ? "bg-[#D32F2F] text-white" : "bg-white/10 text-white/55"}`}>{item}</button>)}</div> : <p className="mt-3 text-sm text-white/50">No symbols were configured for this bot in the portal.</p>}</div>
        <div><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Trades</p><span className="text-xs text-white/45">Max 20 per scan</span></div><div className="mt-3 flex items-center gap-3"><button type="button" aria-label="Decrease trades" onClick={() => setTrades((value) => Math.max(1, value - 1))} className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Minus className="size-4" /></button><span className="min-w-8 text-center text-xl font-black">{trades}</span><button type="button" aria-label="Increase trades" onClick={() => setTrades((value) => Math.min(20, value + 1))} className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Plus className="size-4" /></button><span className="ml-auto flex size-10 items-center justify-center rounded-xl bg-[#D32F2F]"><Plus className="size-5" /></span></div></div>
        <label className="block"><span className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Lot size</span><input value={lotSize} onChange={(event) => setLotSize(event.target.value)} inputMode="decimal" className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-4 text-sm font-bold outline-none focus:border-[#D32F2F]" aria-label="Lot size" /></label>
      </section>
      <button type="button" onClick={scan} disabled={!image || !symbol} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#D32F2F] text-sm font-black uppercase tracking-[0.08em] text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"><ScanLine className="size-5" />Scan chart</button>
    </>}

    {state === "scanning" && <><section className="mt-6 overflow-hidden rounded-3xl border border-[#D32F2F]/50 bg-[#111111] p-3"><div className="relative h-64"><img src={image || ""} alt="Chart being scanned" className="size-full rounded-2xl bg-black object-contain opacity-60" /><div className="scanner-line absolute inset-x-3 top-1/2 h-0.5 bg-[#D32F2F] shadow-[0_0_14px_#D32F2F]" /><span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#ff7070]">Scanning {progress}%</span></div></section><div className="mt-5 flex items-center justify-between"><div><h2 className="font-black">Analysing chart</h2><p className="mt-1 text-xs text-white/50">Live market data in progress</p></div><LoaderCircle className="size-5 animate-spin text-[#D32F2F]" /></div><section className="mt-5 space-y-4 rounded-3xl border border-white/10 bg-[#111111] p-5">{SCAN_STEPS.map(([title, detail], index) => { const complete = progress >= ((index + 1) / SCAN_STEPS.length) * 100; const current = !complete && progress >= (index / SCAN_STEPS.length) * 100; return <div key={title} className="flex items-start gap-3"><span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${complete ? "bg-[#D32F2F]" : "bg-white/10"}`}>{complete ? <Check className="size-3" /> : <Circle className="size-2 text-white/40" />}</span><div className="min-w-0 flex-1"><p className={current ? "text-sm font-bold" : "text-sm font-bold text-white/45"}>{title}</p><p className="mt-1 text-[11px] text-white/40">{detail}</p></div>{current && <LoaderCircle className="size-4 animate-spin text-[#D32F2F]" />}</div>; })}</section></>}

    {state === "result" && <><section className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-[#111111] p-3"><img src={image || ""} alt="Scanned trading chart" className="h-56 w-full rounded-2xl bg-black object-contain" /></section><div className="mt-5 flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-full bg-[#D32F2F]/15 text-[#ff7070]"><CheckCircle2 className="size-6" /></span><div><h2 className="font-black">Scan complete</h2><p className="text-xs text-white/50">Live market data result for {symbol}</p></div></div><section className="mt-5 rounded-3xl border border-white/10 bg-[#111111] p-5"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Live market data</p><span className="rounded-full bg-[#D32F2F]/15 px-3 py-1 text-[10px] font-black uppercase text-[#ff7070]">Chart read bearish</span></div><div className="mt-4 grid grid-cols-2 gap-3">{[["HTF trend", "Bearish"], ["MACD hist", "-0.84"], ["EMA", "Below 200"], ["RSI", "42.6"], ["ATR", "12.40"], ["Session", "London"]].map(([label, value]) => <div key={label} className="rounded-2xl bg-white/5 p-3"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>)}</div><div className="mt-4 rounded-2xl border border-[#D32F2F]/40 bg-[#D32F2F]/10 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/45">Signal</p><p className="mt-1 text-2xl font-black text-[#ff7070]">SELL</p></div><div className="text-right"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/45">Order</p><p className="mt-1 text-sm font-bold">Market Order</p></div></div><div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm"><span className="text-white/50">Price</span><strong>2,346.20</strong></div></div></section><button type="button" onClick={execute} disabled={executionStatus !== null} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#D32F2F] text-sm font-black uppercase text-white disabled:opacity-50"><TrendingUp className="size-5" />Execute SELL</button><button type="button" onClick={() => setState("upload")} className="mt-3 h-12 w-full rounded-2xl border border-white/10 text-sm font-bold text-white/60">Scan another chart</button></>}
+
+    <ExecutionNotification open={executionStatus !== null} robotName={active?.name || "Selected robot"} robotImage={active?.image} robotId={active?.id || ""} symbol={symbol} direction="SELL" lotSize={lotSize} status={executionStatus || "scanning"} errorMessage={executionError} onClose={() => setExecutionStatus(null)} />
+  </div></AppFrame>;
+}
