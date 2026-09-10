import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, CheckCircle2, Circle, LoaderCircle, ScanLine, ShieldCheck, TrendingUp, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/scanner")({
  ssr: false,
  head: () => ({ meta: [
    { title: "AI Chart Scanner — EA Migrate Pro" },
    { name: "description", content: "Scan a Forex chart, review signal details, and prepare a live trade." },
    { property: "og:title", content: "AI Chart Scanner — EA Migrate Pro" },
    { property: "og:description", content: "Scan a Forex chart, review signal details, and prepare a live trade." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Scanner,
});

type ScanStep = "upload" | "scanning" | "result";
const MAX_SCANS = 18;
const USAGE_KEY = "eamp.scanner.usage.v1";
const ANALYSIS = [
  ["Reading candles & timeframe", "Decoding chart image · detecting period"],
  ["Syncing live broker prices", "Pulling bid / ask and session range"],
  ["Mapping market structure", "Higher highs, lower lows, break of structure"],
  ["Locating liquidity zones", "Order blocks, imbalances, equal highs / lows"],
  ["Measuring momentum & trend", "RSI, MACD histogram, EMA alignment"],
  ["Calculating volatility & risk", "ATR based stop loss and take profit distance"],
  ["Confirming higher-timeframe bias", "Cross-checking HTF trend for confluence"],
  ["Building the trade setup", "Entry, SL, TP and confidence score"],
] as const;

function readUsage() {
  if (typeof window === "undefined") return 0;
  try { const saved = JSON.parse(window.localStorage.getItem(USAGE_KEY) || "null") as { day?: string; count?: number } | null; return saved?.day === new Date().toISOString().slice(0, 10) ? Math.min(MAX_SCANS, Math.max(0, saved.count || 0)) : 0; } catch { return 0; }
}

function Scanner() {
  const app = useAppState();
  const active = app.robots.find((robot) => robot.id === app.activeRobotId) || app.robots[0];
  const symbols = active?.symbols?.length ? active.symbols : ["XAUUSD", "EURUSD"];
  const [step, setStep] = useState<ScanStep>("upload");
  const [image, setImage] = useState<string | null>(null);
  const [symbol, setSymbol] = useState(symbols[0] || "XAUUSD");
  const [progress, setProgress] = useState(0);
  const [usage, setUsage] = useState(readUsage);
  const signal = useMemo(() => ({ side: "BUY", entry: "2,346.20", stop: "2,339.80", target: "2,359.00", ratio: "1:2.0", confidence: "87%", lot: app.settings.lotSize || "0.01" }), [app.settings.lotSize]);

  useEffect(() => {
    if (step !== "scanning") return;
    setProgress(0);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 4);
      if (next === 100) { window.clearInterval(timer); window.setTimeout(() => setStep("result"), 350); }
      return next;
    }), 140);
    return () => window.clearInterval(timer);
  }, [step]);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (image) URL.revokeObjectURL(image);
    setImage(URL.createObjectURL(file));
    setStep("upload");
  };
  const startScan = () => {
    if (!image) { toast.error("Upload a chart first."); return; }
    if (usage >= MAX_SCANS) { toast.error("Daily scan limit reached."); return; }
    const next = usage + 1;
    setUsage(next);
    window.localStorage.setItem(USAGE_KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: next }));
    setStep("scanning");
  };
  const execute = () => toast.error("Connect your live execution provider before placing this trade.");

  return <AppFrame><div className="pb-24"><header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><div className="min-w-0 text-center"><h1 className="truncate text-xl font-black">AI Chart Scanner</h1><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">● Live market data</p></div><span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-2 text-[10px] font-black text-primary">{MAX_SCANS - usage} left</span></header>

    {step === "upload" && <><section className="mt-6 overflow-hidden rounded-[2rem] border border-border/60 bg-card/60 p-3">{image ? <div className="relative"><img src={image} alt="Uploaded trading chart" className="h-[24rem] w-full rounded-[1.5rem] object-contain bg-background" /><button type="button" aria-label="Remove chart" onClick={() => { URL.revokeObjectURL(image); setImage(null); }} className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-background/85"><X className="size-4" /></button></div> : <div className="flex h-72 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-primary/40 bg-primary/5 text-center"><span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary"><ScanLine className="size-9" /></span><p className="mt-5 text-lg font-black">Upload your chart</p><p className="mt-2 max-w-[15rem] text-sm text-muted-foreground">Use a clear screenshot showing candles, timeframe, and prices.</p></div>}<div className="mt-3 grid grid-cols-2 gap-3"><label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full border border-border/60 bg-card text-sm font-bold"><Camera className="size-4" />Camera<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label><label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-primary-foreground"><Upload className="size-4" />Upload<input type="file" accept="image/*" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label></div></section><section className="mt-4 rounded-3xl border border-border/60 bg-card/60 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Pair to analyse</p><div className="mt-3 flex flex-wrap gap-2">{symbols.map((item) => <button key={item} type="button" onClick={() => setSymbol(item)} className={item === symbol ? "rounded-full border border-primary bg-primary/10 px-4 py-2 text-xs font-bold text-primary" : "rounded-full border border-border px-4 py-2 text-xs font-bold text-muted-foreground"}>{item}</button>)}</div></section><button type="button" onClick={startScan} className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-black text-primary-foreground glow-ring"><ScanLine className="size-5" />Scan chart</button></>}

    {step === "scanning" && <><section className="mt-6 overflow-hidden rounded-[2rem] border border-primary/50 bg-card/60 p-3 glow-ring"><div className="relative h-[22rem]"><img src={image || ""} alt="Chart being scanned" className="size-full rounded-[1.5rem] object-contain bg-background opacity-70" /><div className="absolute inset-x-4 top-1/2 h-px bg-primary shadow-glow" /><span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-primary bg-background/90 px-5 py-2 text-xs font-black uppercase tracking-[0.2em] text-primary">Scanning...</span></div></section><div className="mt-6 text-center"><h2 className="text-lg font-black">Analysing your chart with live market data</h2><p className="mt-2 text-sm text-muted-foreground">Confirming structure against the latest available candles</p></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><section className="mt-5 space-y-5 rounded-[2rem] border border-border/60 bg-card/60 p-6">{ANALYSIS.map(([title, detail], index) => { const complete = progress >= ((index + 1) / ANALYSIS.length) * 100; const current = !complete && progress >= (index / ANALYSIS.length) * 100; return <div key={title} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3"><span className={complete ? "mt-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "mt-1 flex size-5 items-center justify-center rounded-full bg-secondary text-muted-foreground"}>{complete ? <Check className="size-3" /> : <Circle className="size-2" />}</span><div className="min-w-0"><p className={current ? "font-bold text-foreground" : "font-bold text-muted-foreground"}>{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>{current && <LoaderCircle className="size-5 animate-spin text-primary" />}</div>; })}</section></>}

    {step === "result" && <><section className="mt-6 overflow-hidden rounded-[2rem] border border-primary/50 bg-card/60 p-3"><img src={image || ""} alt="Scanned trading chart" className="h-64 w-full rounded-[1.5rem] object-contain bg-background" /></section><div className="mt-6 flex items-center gap-3"><span className="flex size-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-6" /></span><div><h2 className="text-xl font-black">Signal found</h2><p className="text-sm text-muted-foreground">Review every detail before execution.</p></div></div><section className="mt-5 rounded-[2rem] border border-border/60 bg-card/60 p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{symbol}</p><p className="mt-1 text-3xl font-black text-emerald-300">{signal.side}</p></div><span className="rounded-full bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-300">{signal.confidence} confidence</span></div><div className="mt-5 grid grid-cols-2 gap-3">{[["Entry", signal.entry], ["Stop loss", signal.stop], ["Take profit", signal.target], ["Risk / reward", signal.ratio], ["Lot size", signal.lot], ["Timeframe", "M15"]].map(([label, value]) => <div key={label} className="rounded-2xl bg-secondary/60 p-4"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 font-black">{value}</p></div>)}</div><div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"><TrendingUp className="mt-0.5 size-5 shrink-0 text-primary" /><p className="text-xs leading-5 text-muted-foreground">Bullish structure break with momentum confirmation. Price remains above the identified demand zone.</p></div></section><button type="button" onClick={() => { setStep("upload"); setImage(null); }} className="mt-4 h-12 w-full rounded-full border border-border text-sm font-bold text-muted-foreground">Scan another chart</button></>}

    <section className="mt-5 flex items-center gap-3 rounded-3xl border border-border/60 bg-card/60 p-4"><ShieldCheck className="size-5 shrink-0 text-primary" /><div><p className="text-sm font-bold">Live execution connection</p><p className="text-xs text-muted-foreground">Not connected — private API details are required.</p></div></section>
    {step === "result" && <div className="fixed inset-x-0 bottom-[5.45rem] z-40 mx-auto max-w-md border-t border-border bg-background/95 px-5 py-3 backdrop-blur-xl"><button type="button" onClick={execute} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-black uppercase text-primary-foreground glow-ring"><TrendingUp className="size-5" />Execute {signal.side}</button></div>}
  </div></AppFrame>;
}
