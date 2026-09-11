import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ScanLine } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";

export const Route = createFileRoute("/app/settings/")({
  ssr: false,
  head: () => ({ meta: [{ title: "App Settings — EA Migrate Pro" }, { name: "description", content: "Change the look, interface styles, font and background effect of your EA app." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return <AppFrame><div className="min-h-screen bg-[#0A0A0A] pb-20"><h1 className="text-2xl font-bold text-white">Settings</h1><Link to="/app/settings/scanner" className="mt-8 flex items-center gap-4 border-b border-white/10 py-4"><span className="flex size-10 items-center justify-center bg-[#1A2332]"><ScanLine className="size-5 text-[#38BDF8]" /></span><span className="flex-1 font-semibold text-white">Chart Scanner</span><ChevronRight className="size-4 text-white/40" /></Link></div></AppFrame>;
}
