import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { INTERFACE_IDS, useInterfaceStore, type InterfaceId } from "@/stores/interfaceStore";

export const Route = createFileRoute("/app/settings/interface")({
  ssr: false,
  head: () => ({ meta: [{ title: "Interface Styles - EA Migrate Pro" }, { name: "description", content: "Choose the interface shown on Home." }] }),
  component: InterfaceStyles,
});

const styles: { id: InterfaceId; name: string; description: string; accent: string; label: string }[] = [
  { id: "spectre-grid", name: "SPECTRE GRID", description: "Dark grid card with robot, red ready pill and three controls.", accent: "#D32F2F", label: "READY" },
  { id: "blue-orbit", name: "BLUE ORBIT", description: "Blue glow ring, white command pill and connected bot row.", accent: "#38BDF8", label: "CONNECTED" },
  { id: "red-halo", name: "RED HALO", description: "Red outer halo, ready image card and circular commands.", accent: "#D32F2F", label: "READY" },
  { id: "predator-oval", name: "PREDATOR OVAL", description: "Thin red oval, standby pill and aggressive scanner action.", accent: "#D32F2F", label: "STANDBY" },
  { id: "skyline-stack", name: "SKYLINE STACK", description: "Double blue ring with stacked pairs, start and logs.", accent: "#38BDF8", label: "ONLINE" },
  { id: "neon-edge", name: "NEON EDGE", description: "Red neon edge card with green AI chart scanner.", accent: "#39FF88", label: "READY" },
  { id: "void-pulse", name: "VOID PULSE", description: "Red grid pulse with dynamic mentor and EA labels.", accent: "#FF1A1A", label: "READY" },
  { id: "eclipse-core", name: "ECLIPSE CORE", description: "Image-led core dashboard with live bot identity.", accent: "#FF1A1A", label: "CONNECTED" },
  { id: "crimson-nexus", name: "CRIMSON NEXUS", description: "Red halo dashboard with dynamic uppercase EA title.", accent: "#FF1A1A", label: "READY" },
  { id: "neon-phantom", name: "NEON PHANTOM", description: "Red edge scanner with dynamic trading badge.", accent: "#39FF88", label: "TRADING" },
];

function InterfaceStyles() {
  const navigate = useNavigate();
  const { selected, setSelected } = useInterfaceStore();
  const apply = (id: InterfaceId) => {
    setSelected(id);
    toast.success("Applied to Home");
    navigate({ to: "/app/home" });
  };
  return <AppFrame><div className="min-h-screen bg-[#0A0A0A] pb-20 text-white"><header className="flex items-center gap-3"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5"><ArrowLeft className="size-5" /></Link><div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#38BDF8]">Settings</p><h1 className="text-2xl font-black">Interface Styles</h1></div></header><p className="mt-4 text-sm text-white/50">Choose the dashboard style shown on Home.</p><div className="mt-6 space-y-3">{styles.map((style) => <button key={style.id} type="button" onClick={() => apply(style.id)} className={`grid w-full grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-3xl border p-4 text-left ${selected === style.id ? "border-[#38BDF8] bg-[#1A2332]" : "border-white/10 bg-[#111111]"}`}><span className="flex h-16 flex-col justify-between rounded-2xl border p-2" style={{ borderColor: `${style.accent}80`, background: `linear-gradient(145deg, ${style.accent}30, #0A0A0A 65%)` }}><LayoutDashboard className="size-4" style={{ color: style.accent }} /><span className="text-[8px] font-black uppercase" style={{ color: style.accent }}>{style.label}</span></span><span className="min-w-0"><span className="block font-black">{style.name}</span><span className="mt-1 block text-xs leading-5 text-white/50">{style.description}</span></span>{selected === style.id && <Check className="size-5 text-[#38BDF8]" />}</button>)}</div><div className="mt-5 text-center text-xs text-white/35">{INTERFACE_IDS.length} interfaces available</div></div></AppFrame>;
}
