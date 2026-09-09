import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, CheckCircle2, Minus, Plus, ScanLine, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/scanner")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chart Scanner — EA Migrate Pro" }, { name: "description", content: "Upload a chart and get an instant MT5 trade setup." }] }),
  component: Scanner,
});

const MAX_SCANS_PER_DAY = 18;
const USAGE_KEY = "eamp.scanner.usage.v1";
function utcDay() { return new Date().toISOString().slice(0, 10); }
function loadUsage() {
  if (typeof window === "undefined") return { day: utcDay(), count: 0 };
  try {
    const saved = JSON.parse(window.localStorage.getItem(USAGE_KEY) || "null") as { day?: string; count?: number } | null;
    if (!saved || saved.day !== utcDay()) return { day: utcDay(), count: 0 };
    return { day: saved.day, count: Math.min(MAX_SCANS_PER_DAY, Math.max(0, Number(saved.count) || 0)) };
  } catch { return { day: utcDay(), count: 0 }; }
}
function saveUsage(count: number) {
  if (typeof window !== "undefined") window.localStorage.setItem(USAGE_KEY, JSON.stringify({ day: utcDay(), count }));
}

function Scanner() {
  const app = useAppState();
  const active = app.robots.find((item) => item.id === app.activeRobotId) || app.robots[0];
  const scannerSymbols = active?.symbols?.length ? active.symbols : ["XAUUSDM", "HW_100"];
  const [file, setFile] = useState<string | null>(null);
  const [symbol, setSymbol] = useState(() => active?.symbols?.[0] || "XAUUSDM");
  const [trades, setTrades] = useState(1);
  const [lot, setLot] = useState("0.01");
  const [scanCount, setScanCount] = useState(() => loadUsage().count);
  const remaining = Math.max(0, MAX_SCANS_PER_DAY - scanCount);
  const runScan = () => {
    if (!file) { toast.error("Upload a chart first."); return; }
    if (scanCount >= MAX_SCANS_PER_DAY) { toast.error("Daily scan limit reached. Your 18 scans reset at midnight UTC."); return; }
    const next = scanCount + 1;
    setScanCount(next);
    saveUsage(next);
    toast.success("Scan " + next + "/" + MAX_SCANS_PER_DAY + ": " + symbol + " — " + trades + " trade(s) at " + lot + " lots");
  };
  return <AppFrame><div className="flex items-center gap-4"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><div><h1 className="text-2xl font-bold">Chart Scanner</h1><p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">● MT5 live market data</p></div></div><section className="panel mt-6 p-6 text-center"><span className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/12"><ScanLine className="size-8 text-primary" /></span><p className="mt-4 text-lg font-bold">{file ? "Chart ready" : "Upload your chart"}</p><p className="mt-1 text-sm text-muted-foreground">{file ?? "Screenshot any broker's MT5 timeframe"}</p><div className="mt-5 flex gap-3"><label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-border/60 bg-card/70 text-sm font-semibold"><Camera className="size-4" /> Camera<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} /></label><label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-primary-foreground glow-ring"><Upload className="size-4" /> Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} /></label></div></section><section className="panel mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Daily usage</p><p className="mt-1 text-2xl font-black text-primary">{remaining} <span className="text-sm font-semibold text-muted-foreground">scans remaining</span></p></div><span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-bold text-primary">{scanCount}/{MAX_SCANS_PER_DAY}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: (scanCount / MAX_SCANS_PER_DAY) * 100 + "%" }} /></div><p className="mt-2 text-xs text-muted-foreground">Limit resets automatically at midnight UTC.</p></section><section className="panel mt-4 p-5"><div className="flex items-center justify-between"><p className="text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Pairs from active EA</p><span className="text-xs font-bold text-primary">{scannerSymbols.length}</span></div><div className="mt-3 flex flex-wrap gap-3">{scannerSymbols.map((s) => <button key={s} type="button" onClick={() => setSymbol(s)} className={"h-11 rounded-full border px-5 text-sm font-semibold " + (symbol === s ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60")}>{s}</button>)}</div></section><section className="panel mt-4 divide-y divide-border/50"><div className="flex items-center gap-4 p-5"><div className="flex-1"><p className="font-semibold">Trades</p><p className="text-sm text-muted-foreground">Max 20 per scan</p></div><button type="button" onClick={() => setTrades((t) => Math.max(1, t - 1))} aria-label="Fewer trades" className="flex size-11 items-center justify-center rounded-full border border-border/60"><Minus className="size-4" /></button><span className="w-6 text-center font-bold">{trades}</span><button type="button" onClick={() => setTrades((t) => Math.min(20, t + 1))} aria-label="More trades" className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus className="size-4" /></button></div><div className="flex items-center gap-4 p-5"><div className="flex-1"><p className="font-semibold">Lot size</p><p className="text-sm text-muted-foreground">Volume per trade</p></div><input value={lot} onChange={(e) => setLot(e.target.value)} className="h-11 w-24 rounded-full border border-border/60 bg-card/70 text-center text-sm" /></div></section><button type="button" onClick={runScan} className={"mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-full text-base font-bold " + (file && scanCount < MAX_SCANS_PER_DAY ? "bg-primary text-primary-foreground glow-ring" : "bg-primary/25 text-primary-foreground/60")}><ScanLine className="size-5" /> Scan chart</button><section className="panel mt-4 p-5"><div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><ShieldCheck className="size-5 text-primary" /></span><div><p className="font-semibold">Live execution API</p><p className="text-xs text-muted-foreground">Secure server-side connection</p></div></div><div className="mt-4 flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/35 p-4"><span className="text-sm font-semibold">API key</span><span className="flex items-center gap-2 text-xs font-bold uppercase text-emerald-300"><CheckCircle2 className="size-4" /> Replit Secret</span></div><p className="mt-3 text-xs leading-5 text-muted-foreground">The execution key is never stored in this browser. Configure the replacement key as <span className="font-mono text-foreground">LIVE_EXECUTION_API_KEY</span> in Replit Secrets, then connect the execution provider endpoint before enabling live trades.</p></section></AppFrame>;
}
