import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Droplet, Palette } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/color")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Theme Color — EA Migrate Pro" },
      { name: "description", content: "Choose the accent color used across your EA app." },
      { property: "og:title", content: "Theme Color — EA Migrate Pro" },
      { property: "og:description", content: "Choose the accent color used across your EA app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ColorPage,
});

const PRESETS = [
  ["Red", "#FF453A"], ["Blue", "#1683F7"], ["Green", "#22C55E"], ["Purple", "#B14CFF"],
  ["Orange", "#FF9500"], ["Pink", "#FF2D55"], ["Teal", "#55C7E8"], ["Yellow", "#FFD60A"],
] as const;

function ColorPage() {
  const { settings } = useAppState();
  const currentName = PRESETS.find(([, value]) => value.toLowerCase() === settings.accentColor.toLowerCase())?.[0] || "Custom";
  return <AppFrame>
    <div className="flex items-center gap-4"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><h1 className="text-2xl font-bold">Theme color</h1></div>
    <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Current accent</p>
    <div className="panel mt-3 flex items-center gap-4 p-5 glow-ring"><span className="flex size-14 items-center justify-center rounded-full border-2 border-primary text-primary shadow-glow"><Palette className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-xl font-black">{currentName}</p><p className="mt-1 text-sm text-muted-foreground">Applied across the interface and controls</p></div><span className="font-mono text-sm font-bold text-primary">{settings.accentColor.toUpperCase()}</span></div>
    <p className="mt-8 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Preset colors</p>
    <div className="mt-3 grid grid-cols-4 gap-3">{PRESETS.map(([name, value]) => { const active = settings.accentColor.toLowerCase() === value.toLowerCase(); return <button key={name} type="button" onClick={() => setSetting("accentColor", value)} className={active ? "rounded-2xl border-2 border-primary bg-primary/10 p-3 text-center" : "rounded-2xl border border-border/60 bg-card/60 p-3 text-center"}><span className="mx-auto flex size-10 items-center justify-center rounded-full" style={{ backgroundColor: value, boxShadow: active ? "0 0 18px " + value : undefined }}>{active && <Check className="size-5 text-white" />}</span><span className="mt-2 block text-[11px] font-bold text-muted-foreground">{name}</span></button>; })}</div>
    <p className="mt-8 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Your color</p>
    <div className="panel mt-3 flex items-center gap-4 p-5"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow"><Droplet className="size-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Custom color</span><span className="block text-sm text-muted-foreground">Open the system color picker</span></span><span className="font-mono text-xs font-bold text-primary">{settings.accentColor.toUpperCase()}</span><input type="color" value={settings.accentColor} onChange={(event) => setSetting("accentColor", event.target.value)} aria-label="Choose custom theme color" className="size-10 cursor-pointer rounded-xl border-0 bg-transparent p-0" /></div>
  </AppFrame>;
}
