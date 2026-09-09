import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Palette } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/interface")({
  ssr: false,
  head: () => ({ meta: [{ title: "Interface Styles — EA Migrate Pro" }, { name: "description", content: "Choose the interface that appears on your Home screen." }] }),
  component: InterfaceStyles,
});

const STYLES = [
  { id: "layout_orange", name: "EA MIGRATE ORANGE", description: "Classic EA style", image: "/interface-layout-orange.jpg", swatch: "#ff6a2b" },
  { id: "layout_blue", name: "EA MIGRATE BLUE", description: "Connected robot command deck", image: "/interface-layout-blue.jpg", swatch: "#3b82ff" },
  { id: "layout_green", name: "EA MIGRATE GREEN", description: "Fast green robot launchpad", image: "/interface-layout-green.jpg", swatch: "#58f05b" },
  { id: "layout_sniper_circle", name: "SNIPER CIRCLE HERO", description: "Circular command hero", image: "/interface-sniper-circle.jpg", swatch: "#ff3b3b" },
  { id: "layout_sniper_full", name: "SNIPER FULL BLEED", description: "Full-screen scanner deck", image: "/interface-sniper-full.jpg", swatch: "#ff3b3b" },
  { id: "layout_sniper_vertical", name: "SNIPER VERTICAL", description: "Vertical controls with AI scan", image: "/interface-sniper-circle.jpg", swatch: "#ff3b3b" },
] as const;

function InterfaceStyles() {
  const { settings } = useAppState();
  const navigate = useNavigate();
  const selectedColor = settings.accentColor || (typeof window !== "undefined" ? window.localStorage.getItem("themeColor") : null) || "#FF3B3B";
  const currentLayout = settings.interfaceStyle || (typeof window !== "undefined" ? window.localStorage.getItem("layout") : null) || "layout_blue";
  const applyLayout = (id: string) => {
    const style = STYLES.find((item) => item.id === id);
    setSetting("interfaceStyle", id);
    if (typeof window !== "undefined") window.localStorage.setItem("layout", id);
    toast.success("Interface Applied: " + (style?.name || id) + " ✅");
    navigate({ to: "/app/home" });
  };
  return <AppFrame><div className="max-h-[calc(100vh-8rem)] overflow-y-auto pb-8 pr-1"><div className="flex items-center gap-3"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Settings</p><h1 className="text-2xl font-black">Interface Styles</h1></div></div><p className="mt-3 text-sm text-muted-foreground">Tap to apply to Home</p><div className="mt-6 space-y-3">{STYLES.map((style) => { const selected = style.id === currentLayout; return <button type="button" key={style.id} onClick={() => applyLayout(style.id)} className="flex w-full items-center gap-3 rounded-3xl border-2 p-3 text-left transition-transform active:scale-[.99]" style={{ borderColor: selected ? selectedColor : "rgba(255,255,255,.1)", backgroundColor: selected ? selectedColor + "20" : "rgba(255,255,255,.035)", boxShadow: selected ? "0 0 22px " + selectedColor + "44" : "none" }}><img src={style.image} alt={style.name + " preview"} className="h-24 w-[4.8rem] shrink-0 rounded-2xl border border-white/10 object-cover" /><span className="min-w-0 flex-1"><span className="block text-sm font-black uppercase" style={{ color: selected ? selectedColor : undefined }}>{style.name}</span><span className="mt-1 block text-xs text-muted-foreground">{style.description}</span><span className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground"><span className="size-2 rounded-full" style={{ backgroundColor: style.swatch }} /> Home preview</span></span>{selected ? <span className="flex shrink-0 items-center gap-1 text-xs font-black uppercase" style={{ color: selectedColor }}><Check className="size-5" /> Selected</span> : <span className="shrink-0 rounded-full border px-3 py-2 text-[10px] font-black uppercase" style={{ borderColor: selectedColor, color: selectedColor }}>Apply</span>}</button>; })}</div><div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-4"><Palette className="size-5 shrink-0" style={{ color: selectedColor }} /><p className="text-xs leading-5 text-muted-foreground">Your current theme color controls the borders, glows, icons, and active Home button across every interface.</p></div></div></AppFrame>;
}
