import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, LayoutDashboard } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/interface")({
  ssr: false,
  head: () => ({ meta: [{ title: "Interface Styles — EA Migrate Pro" }, { name: "description", content: "Choose the interface that appears on your Home screen." }] }),
  component: InterfaceStyles,
});

const STYLES = [
  { id: "crimson_navigator", name: "Crimson Navigator", description: "Circular robot dashboard with horizontal controls", group: "Horizontal" },
  { id: "navigator_plus", name: "Navigator Plus", description: "Full hero robot with three-control command deck", group: "Hero" },
  { id: "pablo_crimson", name: "Pablo Crimson", description: "Crimson hero dashboard with focused controls", group: "Hero" },
  { id: "pablo_elite", name: "Pablo Elite", description: "Vertical command controls and side scanner", group: "Vertical" },
  { id: "quantum_blue", name: "Quantum Blue", description: "Blue horizontal robot command dashboard", group: "Horizontal" },
  { id: "darkweb_ai", name: "Darkweb AI", description: "Dark hero interface with AI scanner access", group: "Hero" },
  { id: "supreme_equinox", name: "Supreme Equinox", description: "Balanced vertical controls for fast access", group: "Vertical" },
  { id: "ultron_mega", name: "Ultron Mega", description: "Large robot hero and compact action controls", group: "Hero" },
  { id: "ea_cloud", name: "EA Cloud", description: "Clean connected-robot dashboard for cloud EAs", group: "Horizontal" },
] as const;

function InterfaceStyles() {
  const { settings } = useAppState();
  const currentLayout = STYLES.some((style) => style.id === settings.interfaceStyle)
    ? settings.interfaceStyle
    : STYLES[0].id;
  const applyLayout = (id: string) => {
    setSetting("interfaceStyle", id);
  };
  return <AppFrame><div className="max-h-[calc(100vh-8rem)] overflow-y-auto pb-8 pr-1"><div className="flex items-center gap-3"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Settings</p><h1 className="truncate text-2xl font-black">Interface Styles</h1></div></div><p className="mt-3 text-sm text-muted-foreground">Tap a style to apply it instantly.</p><div className="mt-6 space-y-3">{STYLES.map((style) => { const selected = style.id === currentLayout; return <button type="button" key={style.id} aria-pressed={selected} onClick={() => applyLayout(style.id)} className={selected ? "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-3xl border border-primary bg-primary/10 p-5 text-left glow-ring" : "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-3xl border border-border/60 bg-card/60 p-5 text-left"}><span className={selected ? "flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" : "flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"}><LayoutDashboard className="size-5" /></span><span className="min-w-0"><span className="block truncate font-black">{style.name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{style.description}</span><span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{style.group} style</span></span>{selected ? <span className="flex shrink-0 items-center gap-1 text-xs font-black uppercase text-primary"><Check className="size-5" /> Active</span> : null}</button>; })}</div></div></AppFrame>;
}
