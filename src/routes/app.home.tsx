import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, Info, Pause, Play, Plus, Radar, ShieldCheck, Sparkles, Trash2, Zap } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { removeRobot, setActiveRobot, toggleRobot, useAppState, type Robot } from "@/lib/app-store";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Robots — EA Migrate Pro" },
      { name: "description", content: "Run and manage your activated trading robots." },
      { property: "og:title", content: "My Robots — EA Migrate Pro" },
      { property: "og:description", content: "Run and manage your activated trading robots." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppHome,
});

const robot = { url: "/botlogic-mascot.jpg?v=2" };
type DockMode = "neuro" | "bottom" | "center" | "right" | "top" | "floating";
type StyleMeta = { pairs: string[]; mode: DockMode; eyebrow: string; description: string };
const STYLE_META: Record<string, StyleMeta> = {
  "Neuro Scalper": { pairs: ["XAUUSD", "NAS100", "EURUSD"], mode: "neuro", eyebrow: "Neuro Scalper // Online", description: "Precision signals. Zero noise." },
  "Interface 1": { pairs: ["EURUSD", "GBPUSD", "USDJPY"], mode: "bottom", eyebrow: "Core Console", description: "Fully automated" },
  "Interface 2": { pairs: ["XAUUSD", "US30", "GBPJPY"], mode: "top", eyebrow: "Full-bleed Poster", description: "High-impact execution" },
  "Interface 3": { pairs: ["BTCUSD", "ETHUSD", "XAUUSD"], mode: "right", eyebrow: "Half-screen Halo", description: "Fully automated" },
  "Interface 4": { pairs: ["EURUSD", "AUDUSD", "USDCHF"], mode: "center", eyebrow: "White-to-blue Poster", description: "Clean execution" },
  "Pulse Grid": { pairs: ["NAS100", "US30", "GER40"], mode: "top", eyebrow: "Pulse Grid // Scanning", description: "Live market radar" },
  "Aurora Vault": { pairs: ["XAUUSD", "EURUSD", "GBPJPY"], mode: "center", eyebrow: "Aurora Vault", description: "Premium signal suite" },
  "Midnight Glass": { pairs: ["BTCUSD", "NAS100", "XAGUSD"], mode: "floating", eyebrow: "Midnight Glass", description: "Stealth execution" },
  "Orbit Command": { pairs: ["USDJPY", "XAUUSD", "US30"], mode: "right", eyebrow: "Orbit Command", description: "Mission control" },
};

function ActionDock({ active, pairs, mode, onToggle, onRemove }: { active: Robot; pairs: string[]; mode: DockMode; onToggle: () => void; onRemove: () => void }) {
  const startButton = <button type="button" onClick={onToggle} className={mode === "neuro" ? "flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.12em] text-primary shadow-glow transition-transform active:scale-95" : mode === "right" ? "flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold uppercase text-primary-foreground shadow-glow transition-transform active:scale-95" : "flex h-14 flex-1 items-center justify-center gap-3 rounded-2xl bg-primary px-5 text-sm font-bold uppercase text-primary-foreground shadow-glow transition-transform active:scale-95"}>{active.running ? <Pause className="size-5" /> : <Play className="size-5" />} {active.running ? "Stop" : "Start"}</button>;
  const pairLink = <Link to="/app/metatrader" className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-primary/35 bg-card/70 px-4 py-3 transition-colors hover:border-primary"><ArrowLeftRight className="size-5 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-xs font-bold uppercase tracking-[0.14em]">Pairs</span><span className="block truncate text-xs text-muted-foreground">{pairs.join(" • ")}</span></span></Link>;
  const removeButton = <button type="button" onClick={onRemove} aria-label="Remove robot" className={mode === "neuro" ? "flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.08em] text-primary shadow-glow" : "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/40 text-primary"}><Trash2 className="size-5" />{mode === "neuro" && <span>Remove</span>}</button>;
  const quotesButton = <Link to="/app/metatrader" className="flex size-28 flex-col items-center justify-center gap-2 rounded-full border-4 border-primary bg-background text-sm font-black uppercase tracking-[0.08em] text-primary shadow-glow"><ArrowLeftRight className="size-5" /><span>Quotes</span></Link>;
  if (mode === "neuro") return <div className="mt-5 grid grid-cols-3 items-center justify-items-center gap-2">{removeButton}{startButton}{quotesButton}</div>;
  if (mode === "right") return <div className="mt-6 grid grid-cols-[1fr_auto] items-center gap-3">{pairLink}<div className="flex flex-col gap-2">{startButton}<button type="button" onClick={onRemove} aria-label="Remove robot" className="flex h-10 items-center justify-center rounded-2xl border border-primary/40 text-xs font-bold uppercase text-primary"><Trash2 className="size-4" /></button></div></div>;
  if (mode === "top") return <div className="mt-5 flex items-center gap-3">{startButton}{pairLink}</div>;
  if (mode === "floating") return <div className="relative mt-5 flex items-center gap-3 rounded-[2rem] border border-primary/30 bg-card/60 p-3 backdrop-blur-xl">{pairLink}{startButton}<button type="button" onClick={onRemove} aria-label="Remove robot" className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/40 text-primary"><Trash2 className="size-4" /></button></div>;
  return <div className={mode === "center" ? "mt-6 flex flex-col items-center gap-3" : "mt-6 flex items-center gap-3"}>{mode === "center" && startButton}{mode !== "center" && pairLink}{mode !== "center" && startButton}{mode === "center" && pairLink}<button type="button" onClick={onRemove} aria-label="Remove robot" className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/40 text-primary"><Trash2 className="size-4" /></button></div>;
}

function AppHome() {
  const app = useAppState();
  const active = app.robots.find((robotItem) => robotItem.id === app.activeRobotId) || app.robots[0];
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const style = app.settings.interfaceStyle;
  const meta = STYLE_META[style] || STYLE_META["Interface 1"];
  const heroImage = active?.image || robot.url;
  useEffect(() => { const handleHomeHold = () => setVideoOpen(Boolean(active?.video)); window.addEventListener("eamp:home-hold", handleHomeHold); return () => window.removeEventListener("eamp:home-hold", handleHomeHold); }, [active?.video]);
  useEffect(() => { if (videoOpen) videoRef.current?.play().catch(() => undefined); }, [videoOpen]);
  const imageStyle = { boxShadow: "0 0 60px " + app.settings.accentColor + "66" };

  return <AppFrame>
    {active ? <>
      {style === "Neuro Scalper" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.6rem] border-b border-primary/50 bg-background shadow-glow"><img src={heroImage} alt={active.name} className="h-[30rem] w-full object-cover opacity-75" /><div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/35 to-background" /><div className="absolute inset-x-6 top-12 text-center"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">You're trading with</p><h1 className="mt-4 text-4xl font-black uppercase tracking-tight text-foreground">{active.name}</h1><div className="mx-auto mt-6 max-w-[18rem] rounded-full border-2 border-primary bg-background/85 px-5 py-3 text-sm font-black text-primary shadow-glow">Powered by EAConnect</div></div></div>}
      {style === "Interface 1" && <div className="flex flex-col items-center text-center"><img src={heroImage} alt={active.name} className="size-56 rounded-full border-4 border-primary object-cover" style={imageStyle} /><p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-primary">{meta.eyebrow}</p><h1 className="mt-2 text-3xl font-bold uppercase">{active.name}</h1><p className="mt-1 text-sm text-muted-foreground">{meta.description}</p><div className="mt-4 rounded-full border border-border/60 bg-card/70 px-5 py-2 text-sm font-semibold">Powered By <span className="text-primary">EA Migrate</span></div></div>}
      {style === "Interface 2" && <div className="relative -mx-5 overflow-hidden rounded-b-[2.5rem] border-b border-primary/40"><img src={heroImage} alt={active.name} className="h-80 w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" /><div className="absolute inset-x-6 bottom-6"><p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">{meta.eyebrow}</p><h1 className="mt-2 text-3xl font-black uppercase">{active.name}</h1><p className="mt-1 text-sm text-muted-foreground">{meta.description}</p></div></div>}
      {style === "Interface 3" && <div className="grid grid-cols-[1.15fr_0.85fr] items-center gap-4 rounded-3xl border border-primary/30 bg-card/60 p-4 glow-ring"><img src={heroImage} alt={active.name} className="aspect-square w-full rounded-[2rem] border-4 border-primary object-cover" style={imageStyle} /><div><p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{meta.eyebrow}</p><h1 className="mt-3 break-words text-2xl font-bold uppercase">{active.name}</h1><p className="mt-2 text-sm text-muted-foreground">{meta.description}</p></div></div>}
      {style === "Interface 4" && <div className="rounded-[2rem] bg-card p-5 text-slate-950 shadow-2xl"><p className="text-xs font-bold tracking-[0.22em] text-slate-700 uppercase">{meta.eyebrow}</p><img src={heroImage} alt={active.name} className="mx-auto mt-6 size-52 rounded-full border-8 border-white/80 object-cover shadow-2xl" /><h1 className="mt-6 text-center text-3xl font-black uppercase">{active.name}</h1><p className="mt-1 text-center text-sm font-semibold text-slate-700">{meta.description}</p></div>}
      {style === "Pulse Grid" && <div className="rounded-[2.5rem] border border-primary/50 bg-card p-4 shadow-glow"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Radar className="size-6" /></span><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{meta.eyebrow}</p><h1 className="mt-1 text-xl font-black uppercase text-white">{active.name}</h1></div></div><span className="size-3 rounded-full bg-cyan-300 shadow-[0_0_15px_#67e8f9]" /></div><img src={heroImage} alt={active.name} className="mt-5 h-56 w-full rounded-[1.7rem] object-cover" /><div className="mt-4 grid grid-cols-3 gap-2">{meta.pairs.map((pair) => <span key={pair} className="rounded-xl border border-primary/50 bg-primary/15 px-2 py-3 text-center text-xs font-bold text-primary">{pair}</span>)}</div></div>}
      {style === "Aurora Vault" && <div className="rounded-[2.5rem] bg-primary p-[2px] shadow-glow"><div className="rounded-[2.4rem] bg-card p-6 text-center"><p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">{meta.eyebrow}</p><img src={heroImage} alt={active.name} className="mx-auto mt-5 size-52 rounded-full border-4 border-primary/50 object-cover shadow-glow" /><h1 className="mt-5 text-3xl font-black uppercase text-white">{active.name}</h1><p className="mt-1 text-sm text-slate-300">{meta.description}</p></div></div>}
      {style === "Midnight Glass" && <div className="rounded-[2.5rem] border border-white/20 bg-primary/15 p-5 shadow-2xl backdrop-blur-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{meta.eyebrow}</p><h1 className="mt-2 text-2xl font-black uppercase">{active.name}</h1></div><ShieldCheck className="size-8 text-primary" /></div><div className="mt-5 overflow-hidden rounded-[2rem] border border-primary/20"><img src={heroImage} alt={active.name} className="h-64 w-full object-cover" /></div><div className="mt-4 flex items-center justify-between text-sm text-muted-foreground"><span>{meta.description}</span><span className="flex items-center gap-2 text-primary"><Zap className="size-4" /> Ready</span></div></div>}
      {style === "Orbit Command" && <div className="grid grid-cols-[0.86fr_1.14fr] overflow-hidden rounded-[2.5rem] border border-primary/50 bg-card shadow-glow"><div className="flex flex-col justify-between p-5"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{meta.eyebrow}</p><h1 className="mt-4 break-words text-2xl font-black uppercase text-white">{active.name}</h1></div><div className="mt-8 flex items-center gap-2 text-xs font-semibold text-primary"><Sparkles className="size-4" /> {meta.description}</div></div><img src={heroImage} alt={active.name} className="h-72 w-full object-cover" /></div>}
      {videoOpen && active.video && <div className="mt-6 overflow-hidden rounded-3xl border border-primary/40 bg-card/70 p-3 glow-ring"><video ref={videoRef} src={active.video} poster={active.image} controls autoPlay playsInline className="max-h-[28rem] w-full rounded-2xl object-contain" /><button type="button" onClick={() => setVideoOpen(false)} className="mt-3 h-11 w-full rounded-full border border-border/70 text-sm font-semibold">Close video</button></div>}
      <ActionDock active={active} pairs={meta.pairs} mode={meta.mode} onToggle={() => toggleRobot(active.id)} onRemove={() => removeRobot(active.id)} />
      {style === "Neuro Scalper" && <div className="mt-6 overflow-hidden rounded-[2rem] border-4 border-primary bg-card shadow-glow"><div className="relative"><img src={heroImage} alt={active.name} className="h-60 w-full object-cover" /><span className="absolute bottom-4 left-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-primary-foreground"><span className="size-3 rounded-full bg-primary shadow-glow" /> Ready</span></div></div>}
      
      <p className="mt-8 text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">Connected Robots:</p>
      <ul className="mt-3 space-y-3">{app.robots.map((item) => <li key={item.id}><button type="button" onClick={() => setActiveRobot(item.id)} className={item.id === active.id ? "flex w-full items-center gap-4 rounded-full border border-primary bg-primary/10 p-3 pr-6 text-left glow-ring" : "flex w-full items-center gap-4 rounded-full border border-border/60 bg-card/50 p-3 pr-6 text-left"}><img src={item.image || robot.url} alt="" className="size-12 rounded-full object-cover" /><span className={item.id === active.id ? "font-semibold text-primary" : "font-semibold"}>{item.name}</span></button></li>)}</ul>
    </> : <div className="panel mt-16 p-10 text-center"><p className="font-semibold">No robot yet</p><p className="mt-2 text-sm text-muted-foreground">Add a licence key to unlock your first trading robot.</p></div>}
    <Link to="/app/activate" className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-black uppercase text-primary-foreground shadow-glow"><Plus className="size-5" /> Connect Your Edge EA</Link>
  </AppFrame>;
}
