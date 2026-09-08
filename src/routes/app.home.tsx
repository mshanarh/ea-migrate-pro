import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowLeftRight, Cpu, History, Pause, Play, Plus, ScanLine, Trash2 } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { removeRobot, setActiveRobot, toggleRobot, useAppState, type Robot } from "@/lib/app-store";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({ meta: [{ title: "My Robots — EA Migrate Pro" }, { name: "description", content: "Run and manage your activated trading robots." }] }),
  component: AppHome,
});

const robot = { url: "/botlogic-mascot.jpg?v=2" };
const STYLE_META = {
  Prime: { pairs: ["XAUUSD", "NAS100", "EURUSD"] },
  Custom: { pairs: ["EURUSD", "GBPUSD", "USDJPY"] },
  "Neuro Scalper": { pairs: ["BTCUSD", "ETHUSD", "XAUUSD"] },
  "Prime Pro": { pairs: ["XAUUSD", "US30", "GBPJPY"] },
} as const;

function PowerPill() {
  return <div className="mx-auto mt-5 w-fit rounded-full border-2 border-primary bg-background/90 px-6 py-3 text-sm font-black text-primary shadow-glow">Powered by EA Migrate</div>;
}
function StartButton({ active, circle = false }: { active: Robot; circle?: boolean }) {
  return <button type="button" onClick={() => toggleRobot(active.id)} className={circle ? "flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.08em] text-primary shadow-glow transition-transform active:scale-95" : "flex h-14 flex-1 items-center justify-center gap-3 rounded-2xl bg-primary px-5 text-sm font-black uppercase text-primary-foreground shadow-glow transition-transform active:scale-95"}>{active.running ? <Pause className="size-5" /> : <Play className="size-5" />}{active.running ? "Stop" : "Start"}</button>;
}
function PairButton({ pairs, className = "" }: { pairs: string[]; className?: string }) {
  return <Link to="/app/metatrader" className={"flex min-w-0 items-center justify-center gap-3 rounded-2xl border-2 border-primary bg-background/85 px-5 py-3 text-sm font-black text-primary shadow-glow " + className}><ArrowLeftRight className="size-5" /><span><span className="block uppercase tracking-[0.1em]">Pairs</span><span className="block truncate text-[10px] font-semibold opacity-80">{pairs.join(" • ")}</span></span></Link>;
}
function LogsButton({ className = "" }: { className?: string }) {
  return <button type="button" className={"flex items-center justify-center gap-3 rounded-2xl border-2 border-primary bg-background/85 px-5 py-3 text-sm font-black uppercase text-primary shadow-glow " + className}><History className="size-5" /> Logs</button>;
}
function QuotesButton() {
  return <Link to="/app/metatrader" className="flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.08em] text-primary shadow-glow"><Activity className="size-5" />Quotes</Link>;
}
function RemoveButton({ active, circle = false }: { active: Robot; circle?: boolean }) {
  return <button type="button" onClick={() => removeRobot(active.id)} aria-label="Remove robot" className={circle ? "flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.08em] text-primary shadow-glow" : "flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-primary text-primary"}><Trash2 className="size-5" />{circle && <span>Remove</span>}</button>;
}
function ScannerCard() {
  return <Link to="/app/settings/scanner" className="mt-6 flex items-center gap-4 rounded-3xl border border-primary/40 bg-card/80 p-4 shadow-glow"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><ScanLine className="size-6" /></span><span className="min-w-0 flex-1"><span className="block text-base font-black">AI Scanner <span className="text-primary">✣</span></span><span className="block truncate text-sm text-muted-foreground">Snap a chart — get an instant signal</span></span><span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">›</span></Link>;
}
function ConnectedRobots({ active, robots }: { active: Robot; robots: Robot[] }) {
  return <><p className="mt-8 text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">Connected Robots:</p><ul className="mt-3 space-y-3">{robots.map((item) => <li key={item.id}><button type="button" onClick={() => setActiveRobot(item.id)} className={item.id === active.id ? "flex w-full items-center gap-4 rounded-full bg-primary p-3 pr-6 text-left text-primary-foreground shadow-glow" : "flex w-full items-center gap-4 rounded-full border border-primary/50 bg-card/70 p-3 pr-6 text-left"}><img src={item.image || robot.url} alt="" className="size-12 rounded-full object-cover" /><span className="truncate font-black uppercase">{item.name}</span></button></li>)}</ul><Link to="/app/activate" className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-black uppercase text-primary-foreground shadow-glow"><Plus className="size-5" /> Connect Your Edge EA</Link></>;
}

function AppHome() {
  const app = useAppState();
  const active = app.robots.find((robotItem) => robotItem.id === app.activeRobotId) || app.robots[0];
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const styleKey = app.settings.interfaceStyle as keyof typeof STYLE_META;
  const style = STYLE_META[styleKey] ? styleKey : "Prime";
  const meta = STYLE_META[style];
  const heroImage = active?.image || robot.url;
  useEffect(() => { const handleHomeHold = () => setVideoOpen(Boolean(active?.video)); window.addEventListener("eamp:home-hold", handleHomeHold); return () => window.removeEventListener("eamp:home-hold", handleHomeHold); }, [active?.video]);
  useEffect(() => { if (videoOpen) videoRef.current?.play().catch(() => undefined); }, [videoOpen]);

  if (!active) return <AppFrame><div className="panel mt-16 p-10 text-center"><p className="font-semibold">No robot yet</p><p className="mt-2 text-sm text-muted-foreground">Add a licence key to unlock your first trading robot.</p><Link to="/app/activate" className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-black uppercase text-primary-foreground shadow-glow"><Plus className="size-5" /> Connect Your Edge EA</Link></div></AppFrame>;

  return <AppFrame>
    {style === "Prime" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.7rem] border-b border-primary/40 bg-background shadow-glow"><img src={heroImage} alt={active.name} className="absolute inset-0 h-full w-full object-cover opacity-45" /><div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/50 to-background" /><div className="relative px-6 pb-7 pt-6 text-center"><div className="mx-auto size-48 overflow-hidden rounded-full border-4 border-primary p-1 shadow-glow"><img src={heroImage} alt={active.name} className="size-full rounded-full object-cover" /></div><h1 className="mt-7 text-3xl font-black uppercase">{active.name}</h1><p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Aggressive</p><PowerPill /><div className="mt-8 grid grid-cols-[1fr_auto] items-center gap-5"><div className="space-y-3"><PairButton pairs={meta.pairs} /><StartButton active={active} /><LogsButton /></div><div className="flex size-28 items-center justify-center rounded-full border-4 border-primary bg-background/85 text-primary shadow-glow"><Cpu className="size-10" /></div></div></div></div>}
    {style === "Custom" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.7rem] border-b border-primary/40 bg-background shadow-glow"><img src={heroImage} alt={active.name} className="h-[34rem] w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" /><div className="absolute inset-x-6 bottom-8 text-center"><h1 className="text-3xl font-black uppercase text-white">{active.name}</h1><p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Aggressive</p><div className="mt-6 grid grid-cols-3 gap-2 rounded-[2rem] border border-primary/60 bg-background/75 p-3 backdrop-blur-xl"><PairButton pairs={meta.pairs} className="flex-col gap-1 border-0 bg-transparent px-1 py-2 text-xs shadow-none" /><StartButton active={active} /><LogsButton className="flex-col gap-1 border-0 bg-transparent px-1 py-2 text-xs shadow-none" /></div></div></div>}
    {style === "Neuro Scalper" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.7rem] border-b border-primary/50 bg-background shadow-glow"><img src={heroImage} alt={active.name} className="h-[31rem] w-full object-cover opacity-70" /><div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/25 to-background" /><div className="absolute inset-x-6 top-12 text-center"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">You're trading with</p><h1 className="mt-4 text-4xl font-black uppercase tracking-tight">{active.name}</h1><PowerPill /><div className="mt-8 grid grid-cols-3 items-center gap-2"><RemoveButton active={active} circle /><StartButton active={active} circle /><QuotesButton /></div></div></div>}
    {style === "Prime Pro" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.7rem] border-b border-primary/50 bg-background shadow-glow"><div className="relative mx-5 mt-2 overflow-hidden rounded-[2rem] border-4 border-primary shadow-glow"><img src={heroImage} alt={active.name} className="h-[27rem] w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" /><div className="absolute inset-x-6 bottom-8 text-center"><h1 className="text-3xl font-black uppercase text-white">{active.name}</h1><p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Aggressive</p></div></div><div className="mx-5 mt-5 rounded-[2rem] border border-primary/50 bg-card/70 p-3"><div className="grid grid-cols-3 gap-2"><PairButton pairs={meta.pairs} className="flex-col gap-1 border-0 bg-transparent px-1 py-2 text-xs shadow-none" /><StartButton active={active} /><LogsButton className="flex-col gap-1 border-0 bg-transparent px-1 py-2 text-xs shadow-none" /></div></div><PowerPill /></div>}
    {videoOpen && active.video && <div className="mt-6 overflow-hidden rounded-3xl border border-primary/40 bg-card/70 p-3 shadow-glow"><video ref={videoRef} src={active.video} poster={active.image} controls autoPlay playsInline className="max-h-[28rem] w-full rounded-2xl object-contain" /><button type="button" onClick={() => setVideoOpen(false)} className="mt-3 h-11 w-full rounded-full border border-primary/50 text-sm font-semibold text-primary">Close video</button></div>}
    {style === "Neuro Scalper" && <div className="mt-6 overflow-hidden rounded-[2rem] border-4 border-primary bg-card shadow-glow"><div className="relative"><img src={heroImage} alt={active.name} className="h-60 w-full object-cover" /><span className="absolute bottom-4 left-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-primary-foreground"><span className="size-3 rounded-full bg-primary shadow-glow" /> Ready</span></div></div>}
    {style !== "Prime" && <PowerPill />}
    <ScannerCard />
    <ConnectedRobots active={active} robots={app.robots} />
  </AppFrame>;
}
