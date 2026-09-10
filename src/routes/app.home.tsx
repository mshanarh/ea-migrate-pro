import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowLeftRight, Check, ChevronRight, CircleGauge, Cpu, History, Pause, Play, Plus, ScanLine, Trash2, X } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { removeRobot, setActiveRobot, toggleRobot, useAppState, type Robot } from "@/lib/app-store";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Robot Dashboard — EA Migrate Pro" },
    { name: "description", content: "Control your licensed Forex robots and open the AI chart scanner." },
    { property: "og:title", content: "Robot Dashboard — EA Migrate Pro" },
    { property: "og:description", content: "Control your licensed Forex robots and open the AI chart scanner." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: AppHome,
});

const fallbackRobotImage = "/ea-migrate-platform-robot.jpg";

type DashboardProps = {
  active: Robot;
  robots: Robot[];
  color: string;
  robotName: string;
  running: boolean;
  openControl: () => void;
};

const STYLE_META: Record<string, { name: string; structure: "horizontal" | "hero" | "vertical"; accent?: string }> = {
  crimson_navigator: { name: "Crimson Navigator", structure: "horizontal" },
  navigator_plus: { name: "Navigator Plus", structure: "hero" },
  pablo_crimson: { name: "Pablo Crimson", structure: "hero" },
  pablo_elite: { name: "Pablo Elite", structure: "vertical" },
  quantum_blue: { name: "Quantum Blue", structure: "horizontal", accent: "#1683F7" },
  darkweb_ai: { name: "Darkweb AI", structure: "hero" },
  supreme_equinox: { name: "Supreme Equinox", structure: "vertical" },
  ultron_mega: { name: "Ultron Mega", structure: "hero" },
  ea_cloud: { name: "EA Cloud", structure: "horizontal", accent: "#22C55E" },
};

function glow(color: string) {
  return `0 0 28px ${color}55`;
}

function RobotList({ active, robots, color }: Pick<DashboardProps, "active" | "robots" | "color">) {
  return <section className="mt-7">
    <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Connected Robots</p>
    <div className="mt-3 space-y-3">
      {robots.map((robot) => <button key={robot.id} type="button" onClick={() => setActiveRobot(robot.id)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-full border border-border/60 bg-card/70 p-2 text-left" style={robot.id === active.id ? { borderColor: color, boxShadow: glow(color) } : undefined}>
        <img src={robot.image || fallbackRobotImage} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        <span className="min-w-0"><span className="block truncate text-sm font-black uppercase">{robot.name}</span><span className="block truncate text-xs text-muted-foreground">{robot.symbols.join(" · ") || "Ready to configure"}</span></span>
        {robot.id === active.id ? <Check className="mr-2 size-5 shrink-0" style={{ color }} /> : <ChevronRight className="mr-2 size-5 shrink-0 text-muted-foreground" />}
      </button>)}
      <Link to="/app/activate" className="flex min-h-16 w-full items-center gap-3 rounded-full border border-dashed border-primary/50 bg-primary/5 px-4 text-sm font-black uppercase text-primary"><span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus className="size-5" /></span>Connect New Robot</Link>
    </div>
  </section>;
}

function Powered({ color }: { color: string }) {
  return <div className="mx-auto mt-4 w-fit rounded-full border bg-card/80 px-5 py-2 text-xs font-bold" style={{ borderColor: color }}>Powered by <span style={{ color }}>EA Migrate</span></div>;
}

function RoundControl({ label, icon, primary, color, onClick }: { label: string; icon: ReactNode; primary?: boolean; color: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="flex size-[4.7rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full border-2 text-[9px] font-black uppercase" style={{ borderColor: color, backgroundColor: primary ? color : "var(--card)", color: primary ? "var(--primary-foreground)" : color, boxShadow: primary ? glow(color) : undefined }}>{icon}{label}</button>;
}

function HorizontalDashboard({ active, robots, color, robotName, running, openControl }: DashboardProps) {
  return <main>
    <header className="text-center"><p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color }}>EA Migrate Pro</p><h1 className="mt-1 truncate text-xl font-black uppercase">{robotName}</h1></header>
    <div className="mx-auto mt-6 size-48 rounded-full border-4 p-2" style={{ borderColor: color, boxShadow: glow(color) }}><img src={active.image || fallbackRobotImage} alt={robotName} className="size-full rounded-full object-cover" /></div>
    <p className="mt-5 text-center text-2xl font-black uppercase">{robotName}</p><p className="mt-1 text-center text-xs font-semibold text-muted-foreground">{running ? "Connected · Trading active" : "Connected · Ready to trade"}</p><Powered color={color} />
    <div className="mt-6 flex items-center justify-around rounded-[2rem] border border-border/60 bg-card/70 px-3 py-4">
      <RoundControl label="Remove" icon={<Trash2 className="size-5" />} color={color} onClick={() => removeRobot(active.id)} />
      <RoundControl label={running ? "Stop" : "Start"} icon={running ? <Pause className="size-5" /> : <Play className="size-5" />} primary color={color} onClick={openControl} />
      <RoundControl label="Quotes" icon={<Activity className="size-5" />} color={color} />
    </div>
    <RobotList active={active} robots={robots} color={color} />
  </main>;
}

function ScannerCard({ color }: { color: string }) {
  return <Link to="/app/settings/scanner" className="mt-5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-border/60 bg-card/70 p-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${color}25`, color }}><ScanLine className="size-6" /></span><span className="min-w-0"><span className="block font-black">AI Scanner</span><span className="block text-xs text-muted-foreground">Scan a chart and review a trade signal</span></span><ChevronRight className="size-5 shrink-0" style={{ color }} /></Link>;
}

function HeroDashboard({ active, robots, color, robotName, running, openControl }: DashboardProps) {
  return <main>
    <div className="relative h-[24rem] overflow-hidden rounded-[2.5rem] border border-border/60" style={{ boxShadow: glow(color) }}><img src={active.image || fallbackRobotImage} alt={robotName} className="size-full object-cover" /><div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" /><div className="absolute inset-x-5 bottom-5"><p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color }}>{running ? "● Trading active" : "● Robot ready"}</p><h1 className="mt-2 text-3xl font-black uppercase">{robotName}</h1><p className="mt-1 text-xs text-muted-foreground">Connected to {active.symbols.join(" · ") || "MetaTrader 5"}</p></div></div>
    <div className="mt-4 grid grid-cols-3 gap-2 rounded-full border border-border/60 bg-card/80 p-2"><button type="button" className="flex h-14 items-center justify-center gap-1 rounded-full text-xs font-black uppercase text-muted-foreground"><ArrowLeftRight className="size-4" />Pairs</button><button type="button" onClick={openControl} className="flex h-14 items-center justify-center gap-1 rounded-full text-xs font-black uppercase text-primary-foreground" style={{ backgroundColor: color, boxShadow: glow(color) }}>{running ? <Pause className="size-4" /> : <Play className="size-4" />}{running ? "Stop" : "Start"}</button><button type="button" className="flex h-14 items-center justify-center gap-1 rounded-full text-xs font-black uppercase text-muted-foreground"><History className="size-4" />Logs</button></div>
    <Powered color={color} /><ScannerCard color={color} /><RobotList active={active} robots={robots} color={color} />
  </main>;
}

function VerticalDashboard({ active, robots, color, robotName, running, openControl }: DashboardProps) {
  return <main>
    <div className="relative h-[22rem] overflow-hidden rounded-[2.5rem] border border-border/60" style={{ boxShadow: glow(color) }}><img src={active.image || fallbackRobotImage} alt={robotName} className="size-full object-cover" /><div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" /><div className="absolute inset-x-5 bottom-5"><h1 className="text-3xl font-black uppercase">{robotName}</h1><p className="mt-1 text-xs font-bold" style={{ color }}>{running ? "● Trading active" : "● Connected and ready"}</p></div></div>
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3"><div className="space-y-2">{[["Pairs", <ArrowLeftRight className="size-5" />], [running ? "Stop" : "Start", running ? <Pause className="size-5" /> : <Play className="size-5" />], ["Logs", <History className="size-5" />]].map(([label, icon], index) => <button key={String(label)} type="button" onClick={index === 1 ? openControl : undefined} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border text-sm font-black uppercase" style={{ borderColor: color, backgroundColor: index === 1 ? color : "var(--card)", color: index === 1 ? "var(--primary-foreground)" : color }}>{icon}{label}</button>)}</div><Link to="/app/settings/scanner" className="flex flex-col items-center justify-center gap-2 rounded-3xl border-2 text-center text-[10px] font-black uppercase" style={{ borderColor: color, color, boxShadow: glow(color) }}><CircleGauge className="size-7" />AI Scan</Link></div>
    <ScannerCard color={color} /><RobotList active={active} robots={robots} color={color} />
  </main>;
}

function TradingControl({ open, running, active, color, onClose }: { open: boolean; running: boolean; active: Robot; color: string; onClose: () => void }) {
  const action = () => { toggleRobot(active.id); onClose(); };
  return <AnimatePresence>{open && <><motion.button type="button" aria-label="Close trading controls" className="fixed inset-0 z-[70] bg-background/65 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} /><motion.section role="dialog" aria-modal="true" aria-label="Trading controls" initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} className="fixed inset-x-4 bottom-24 z-[80] mx-auto max-w-sm rounded-[2rem] border border-border bg-card p-5 shadow-2xl"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"><img src={active.image || fallbackRobotImage} alt="" className="size-12 shrink-0 rounded-full object-cover" /><div className="min-w-0"><p className="truncate font-black uppercase">{active.name}</p><p className="text-xs text-muted-foreground">{running ? "Trading is active" : "Ready to start live monitoring"}</p></div><button type="button" aria-label="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-full bg-secondary"><X className="size-4" /></button></div><button type="button" onClick={action} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-full text-sm font-black uppercase text-primary-foreground" style={{ backgroundColor: running ? "var(--destructive)" : color, boxShadow: glow(color) }}>{running ? <Pause className="size-5" /> : <Play className="size-5" />}{running ? "Stop robot" : "Start robot"}</button><p className="mt-3 text-center text-xs text-muted-foreground">Orders execute only after a live provider is securely connected.</p></motion.section></>}</AnimatePresence>;
}

function TradingBubble({ active, color, openControl }: { active: Robot; color: string; openControl: () => void }) {
  const pressed = useRef(false);
  return <motion.button type="button" drag dragMomentum={false} aria-label="Open trading controls" onClick={() => { if (!pressed.current) openControl(); }} onDragStart={() => { pressed.current = true; }} onDragEnd={() => { window.setTimeout(() => { pressed.current = false; }, 100); }} initial={{ scale: 0 }} animate={{ scale: 1 }} className="fixed bottom-[6.4rem] right-5 z-50 size-16 touch-none rounded-full border-[3px] bg-card p-1" style={{ borderColor: color, boxShadow: glow(color) }}><img src={active.image || fallbackRobotImage} alt="" className="size-full rounded-full object-cover" /><span className="absolute -bottom-1 -right-1 size-4 rounded-full border-2 border-background bg-emerald-400" /></motion.button>;
}

function AppHome() {
  const app = useAppState();
  const [controlOpen, setControlOpen] = useState(false);
  const active = app.robots.find((item) => item.id === app.activeRobotId) || app.robots[0];
  const style = STYLE_META[app.settings.interfaceStyle] || STYLE_META.crimson_navigator;
  const color = style?.accent || app.settings.accentColor;
  useEffect(() => { const open = () => setControlOpen(true); window.addEventListener("eamp:home-hold", open); return () => window.removeEventListener("eamp:home-hold", open); }, []);
  if (!active) return <AppFrame><div className="panel mt-16 p-10 text-center"><span className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><Cpu className="size-8" /></span><h1 className="mt-5 text-2xl font-black uppercase">EA Migrate Pro</h1><p className="mt-2 text-sm text-muted-foreground">Add a licence key to unlock your first trading robot.</p><Link to="/app/activate" className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-black uppercase text-primary-foreground"><Plus className="size-5" />Connect your EA</Link></div></AppFrame>;
  const props = { active, robots: app.robots, color, robotName: active.name, running: active.running, openControl: () => setControlOpen(true) };
  return <AppFrame><div className="pb-6"><p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{style?.name}</p>{style?.structure === "horizontal" && <HorizontalDashboard {...props} />}{style?.structure === "hero" && <HeroDashboard {...props} />}{style?.structure === "vertical" && <VerticalDashboard {...props} />}{active.running && <TradingBubble active={active} color={color} openControl={() => setControlOpen(true)} />}<TradingControl open={controlOpen} running={active.running} active={active} color={color} onClose={() => setControlOpen(false)} /></div></AppFrame>;
}
