import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, MoreHorizontal, Pause, Play, Plus, ScanLine, Trash2, X } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { removeRobot, setActiveRobot, toggleRobot, useAppState, type Robot } from "@/lib/app-store";
import { useInterfaceStore } from "@/stores/interfaceStore";
import { BlueEdge } from "@/components/interfaces/BlueEdge";
import { CrimsonHalo } from "@/components/interfaces/CrimsonHalo";
import { NeonScan } from "@/components/interfaces/NeonScan";
import { PredatorOval } from "@/components/interfaces/PredatorOval";
import { SniperClassic } from "@/components/interfaces/SniperClassic";
import { TacticalStack } from "@/components/interfaces/TacticalStack";
import type { InterfaceProps } from "@/components/interfaces/types";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({ meta: [{ title: "Robot Dashboard - EA Migrate Pro" }, { name: "description", content: "Control your licensed Forex robots." }] }),
  component: AppHome,
});

function BotModal({ active, onClose }: { active: Robot; onClose: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-5" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Bot details" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] p-5" onClick={(event) => event.stopPropagation()}><div className="flex items-center gap-3"><img src={active.image || "/ea-migrate-platform-robot.jpg"} alt={active.name} className="size-16 rounded-2xl object-cover" /><div className="min-w-0 flex-1"><h2 className="truncate text-xl font-black">{active.name}</h2><p className="text-xs text-white/50">{active.running ? "Trading active" : "Ready"} · {active.symbols.join(" · ") || "No symbols"}</p></div><button type="button" onClick={onClose} aria-label="Close bot details" className="flex size-9 items-center justify-center rounded-full bg-white/10"><X className="size-4" /></button></div><div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-2xl bg-white/5 p-3"><p className="text-[10px] uppercase text-white/40">Pairs</p><p className="mt-1 font-black">{active.symbols.length}</p></div><div className="rounded-2xl bg-white/5 p-3"><p className="text-[10px] uppercase text-white/40">Lot</p><p className="mt-1 font-black">{active.pairs?.[0]?.lotSize || "0.01"}</p></div><div className="rounded-2xl bg-white/5 p-3"><p className="text-[10px] uppercase text-white/40">Status</p><p className="mt-1 truncate font-black">{active.running ? "Live" : "Idle"}</p></div></div></section></div>;
}

function InterfaceHome({ active, robots, onStart, onRemove, onSelectBot, onOpenBotModal, onOpenPairs, onOpenScanner }: InterfaceProps) {
  const { selected } = useInterfaceStore();
  const props = { active, robots, onStart, onRemove, onSelectBot, onOpenBotModal, onOpenPairs, onOpenScanner };
  if (selected === "blue-edge") return <BlueEdge {...props} />;
  if (selected === "crimson-halo") return <CrimsonHalo {...props} />;
  if (selected === "predator-oval") return <PredatorOval {...props} />;
  if (selected === "tactical-stack") return <TacticalStack {...props} />;
  if (selected === "neon-scan") return <NeonScan {...props} />;
  return <SniperClassic {...props} />;
}

function AppHome() {
  const app = useAppState();
  const navigate = useNavigate();
  const [showBotModal, setShowBotModal] = useState(false);
  const active = app.robots.find((robot) => robot.id === app.activeRobotId) || app.robots[0];
  if (!active) return <AppFrame><div className="min-h-screen bg-[#0A0A0A] pt-16 text-center text-white"><span className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#1A2332] text-[#38BDF8]"><Plus className="size-8" /></span><h1 className="mt-5 text-2xl font-black">No robot connected</h1><p className="mt-2 text-sm text-white/50">Add a licence key to unlock your first trading robot.</p><Link to="/app/activate" className="mx-auto mt-6 flex h-14 max-w-sm items-center justify-center gap-2 rounded-full bg-[#00A8FF] text-sm font-black uppercase text-[#0A0A0A]"><Plus className="size-5" />Connect your EA</Link></div></AppFrame>;
  const actions: InterfaceProps = { active, robots: app.robots, license: null, onStart: () => toggleRobot(active.id), onRemove: () => removeRobot(active.id), onSelectBot: (id) => setActiveRobot(id), onOpenBotModal: () => setShowBotModal(true), onOpenPairs: () => navigate({ to: "/app/pairs", search: { robot: active.id } }), onOpenScanner: () => navigate({ to: "/app/settings/scanner" }) };
  return <AppFrame><div className="px-5 pb-20"><InterfaceHome {...actions} />{showBotModal && <BotModal active={active} onClose={() => setShowBotModal(false)} />}</div></AppFrame>;
}
