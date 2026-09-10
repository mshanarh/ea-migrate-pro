import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Plus, RefreshCw, Search, X } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFrame } from "@/components/AppFrame";
import { setRobotPairs, useAppState, type PairSetting } from "@/lib/app-store";

export const Route = createFileRoute("/app/pairs")({
  ssr: false,
  head: () => ({ meta: [{ title: "Trading Pairs — EA Migrate Pro" }, { name: "description", content: "Configure trading pairs for your selected robot." }] }),
  component: TradingPairs,
});

const AVAILABLE_SYMBOLS = [
  "BTCUSD", "ETHUSD", "EURGBP", "EURUSD", "GBPJPY", "GBPUSD", "XAUUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
  "EURJPY", "EURCHF", "EURAUD", "EURNZD", "EURCAD", "GBPCHF", "GBPAUD", "GBPCAD", "GBPNZD", "AUDJPY", "AUDCAD", "AUDCHF",
  "AUDNZD", "CADJPY", "CADCHF", "CHFJPY", "NZDJPY", "NZDCHF", "US30", "NAS100", "SPX500", "GER40",
];

const defaultPair = (symbol: string): PairSetting => ({ symbol, lotSize: "0.01", maxTrades: "0" });

function TradingPairs() {
  const app = useAppState();
  const [robotId, setRobotId] = useState<string | null>(null);
  const [tab, setTab] = useState<"my" | "available">("my");
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState(AVAILABLE_SYMBOLS);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("robot");
    setRobotId(selected && app.robots.some((robot) => robot.id === selected) ? selected : app.activeRobotId || app.robots[0]?.id || null);
  }, [app.activeRobotId, app.robots]);

  const robot = app.robots.find((item) => item.id === robotId) || app.robots[0];
  const pairs = robot?.pairs?.length ? robot.pairs : (robot?.symbols || []).map(defaultPair);
  const selectedSymbols = new Set(pairs.map((pair) => pair.symbol));
  const available = symbols.filter((symbol) => !selectedSymbols.has(symbol));
  const filteredAvailable = available.filter((symbol) => symbol.toLowerCase().includes(query.trim().toLowerCase()));

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 2600);
  };

  const updatePairs = (next: PairSetting[]) => {
    if (robot) setRobotPairs(robot.id, next);
  };
  const addPair = (symbol: string) => {
    updatePairs([...pairs, defaultPair(symbol)]);
    setTab("my");
    showNotice(`Added: ${symbol}`);
  };
  const removePair = (symbol: string) => updatePairs(pairs.filter((pair) => pair.symbol !== symbol));
  const updatePair = (symbol: string, field: "lotSize" | "maxTrades", value: string) => updatePairs(pairs.map((pair) => pair.symbol === symbol ? { ...pair, [field]: value } : pair));
  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => {
      setSymbols([...AVAILABLE_SYMBOLS]);
      setRefreshing(false);
    }, 450);
  };

  if (!robot) return <AppFrame><div className="panel mt-16 p-8 text-center"><h1 className="text-xl font-black">No robot selected</h1><p className="mt-2 text-sm text-muted-foreground">Connect a robot before configuring trading pairs.</p><Link to="/app/activate" className="mt-5 inline-flex h-12 items-center rounded-full bg-primary px-5 text-sm font-black text-primary-foreground">Connect robot</Link></div></AppFrame>;

  return <AppFrame><div className="pb-8">
    <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="fixed inset-x-4 top-4 z-[90] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-300/30 bg-[#101a16]/95 px-4 py-3 text-sm font-bold text-emerald-100 shadow-2xl backdrop-blur-xl"><Check className="size-5 shrink-0 text-emerald-300" />{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="ml-auto text-emerald-200/70"><X className="size-4" /></button></motion.div>}</AnimatePresence>
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"><Link to="/app/home" aria-label="Back to dashboard" className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5"><ArrowLeft className="size-5" /></Link><div className="min-w-0 text-center"><p className="truncate text-lg font-black">Trading Pairs</p><p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{robot.name}</p></div><button type="button" onClick={refresh} aria-label="Refresh available symbols" className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5"><RefreshCw className={refreshing ? "size-5 animate-spin text-primary" : "size-5 text-primary"} /></button></header>
    <div className="mt-7 grid grid-cols-2 rounded-2xl bg-[#11161c] p-1"><button type="button" onClick={() => setTab("my")} className={tab === "my" ? "rounded-xl bg-primary px-3 py-3 text-sm font-black text-primary-foreground" : "rounded-xl px-3 py-3 text-sm font-bold text-muted-foreground"}>My Pairs <span className="ml-1 opacity-75">{pairs.length}</span></button><button type="button" onClick={() => setTab("available")} className={tab === "available" ? "rounded-xl bg-primary px-3 py-3 text-sm font-black text-primary-foreground" : "rounded-xl px-3 py-3 text-sm font-bold text-muted-foreground"}>Available <span className="ml-1 opacity-75">{available.length}</span></button></div>
    {tab === "available" && <label className="mt-5 flex h-14 items-center gap-3 rounded-2xl border border-white/10 bg-[#11161c] px-4"><Search className="size-5 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbols" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label>}
    {tab === "my" ? <section className="mt-5 space-y-3"><div className="flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Selected for {robot.name}</p><p className="mt-1 text-sm text-muted-foreground">Configure each pair independently.</p></div><span className="text-xs font-bold text-muted-foreground">{pairs.length} selected</span></div>{pairs.length === 0 && <div className="rounded-3xl border border-dashed border-white/15 bg-[#11161c] p-8 text-center text-sm text-muted-foreground">No pairs selected. Open Available to add one.</div>}{pairs.map((pair) => <motion.div layout key={pair.symbol} className="rounded-3xl border border-white/10 bg-[#11161c] p-4"><div className="flex items-center justify-between gap-3"><p className="text-lg font-black text-white">{pair.symbol}</p><button type="button" onClick={() => removePair(pair.symbol)} aria-label={`Remove ${pair.symbol}`} className="flex size-9 items-center justify-center rounded-full bg-white/5 text-muted-foreground transition hover:bg-red-400/15 hover:text-red-300"><X className="size-4" /></button></div><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-muted-foreground">Lot size<input inputMode="decimal" value={pair.lotSize} onChange={(event) => updatePair(pair.symbol, "lotSize", event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0a0f14] px-3 text-sm font-bold text-white outline-none focus:border-primary" /></label><label className="text-xs font-bold text-muted-foreground">Max trades <span className="font-normal">(0 = unlimited)</span><input inputMode="numeric" value={pair.maxTrades} onChange={(event) => updatePair(pair.symbol, "maxTrades", event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0a0f14] px-3 text-sm font-bold text-white outline-none focus:border-primary" /></label></div></motion.div>)}</section> : <section className="mt-5"><div className="flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Available symbols</p><p className="mt-1 text-sm text-muted-foreground">Add pairs to this robot.</p></div><span className="text-xs font-bold text-muted-foreground">{available.length} available</span></div><div className="mt-4 grid grid-cols-2 gap-3">{filteredAvailable.map((symbol) => <motion.div layout key={symbol} className="rounded-2xl border border-white/10 bg-[#11161c] p-4"><p className="font-black text-white">{symbol}</p><p className="mt-1 text-xs text-muted-foreground">Min lot 0.01</p><button type="button" onClick={() => addPair(symbol)} aria-label={`Add ${symbol}`} className="mt-4 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_18px_rgba(255,59,59,.3)] transition hover:scale-105"><Plus className="size-5" /></button></motion.div>)}</div>{filteredAvailable.length === 0 && <div className="mt-4 rounded-3xl border border-dashed border-white/15 bg-[#11161c] p-8 text-center text-sm text-muted-foreground">No matching symbols.</div>}</section>}
  </div></AppFrame>;
}
