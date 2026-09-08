import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronRight, Droplet, LayoutTemplate, Palette, ScanLine, Sparkles, Type } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "App Settings — EA Migrate Pro" },
      { name: "description", content: "Change the look, font and background effect of your EA app." },
      { property: "og:title", content: "App Settings — EA Migrate Pro" },
      { property: "og:description", content: "Change the look, font and background effect of your EA app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const PRESETS = [
  ["Red", "#FF453A"], ["Blue", "#1683F7"], ["Green", "#22C55E"], ["Purple", "#B14CFF"],
  ["Orange", "#FF9500"], ["Pink", "#FF2D55"], ["Teal", "#55C7E8"], ["Yellow", "#FFD60A"],
] as const;

function SettingsPage() {
  const { settings } = useAppState();
  const [themeOpen, setThemeOpen] = useState(true);
  const selectedName = PRESETS.find(([, value]) => value.toLowerCase() === settings.accentColor.toLowerCase())?.[0] || "Custom";
  return <AppFrame>
    <h1 className="text-3xl font-black">Settings</h1>
    <p className="mt-3 text-sm text-muted-foreground">Keep it simple. Open a section only when you want to change it.</p>
    <div className="mt-8 space-y-3">
      <Link to="/app/settings/interface" className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card/70 p-5"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><LayoutTemplate className="size-5 text-primary" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Interface</span><span className="block truncate text-sm text-muted-foreground">Choose your complete home experience</span></span><span className="text-sm font-semibold text-muted-foreground">{settings.interfaceStyle}</span><ChevronRight className="size-5 text-muted-foreground" /></Link>
      <div className="overflow-hidden rounded-3xl border border-primary/30 bg-card/70 shadow-glow">
        <button type="button" onClick={() => setThemeOpen((open) => !open)} className="flex w-full items-center gap-4 p-5 text-left"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><Palette className="size-5 text-primary" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Theme color</span><span className="block truncate text-sm text-muted-foreground">Accent used across the interface and controls</span></span><span className="text-sm font-semibold text-muted-foreground">{selectedName}</span><span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">{themeOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span></button>
        {themeOpen && <div className="border-t border-border/50 p-4"><div className="rounded-3xl bg-background/80 p-5 shadow-inner"><div className="flex items-center gap-4"><span className="flex size-14 items-center justify-center rounded-full border-2 border-primary text-primary shadow-glow"><Palette className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Current accent</p><p className="mt-1 text-xl font-black">{selectedName}</p></div><span className="font-mono text-sm font-bold text-primary">{settings.accentColor.toUpperCase()}</span></div></div><p className="mt-6 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Preset colors</p><div className="mt-3 grid grid-cols-4 gap-3">{PRESETS.map(([name, value]) => { const active = settings.accentColor.toLowerCase() === value.toLowerCase(); return <button key={name} type="button" onClick={() => setSetting("accentColor", value)} className={active ? "rounded-2xl border-2 border-primary bg-primary/10 p-3 text-center" : "rounded-2xl border border-border/60 bg-card/60 p-3 text-center"}><span className="mx-auto flex size-9 items-center justify-center rounded-full" style={{ backgroundColor: value, boxShadow: active ? "0 0 18px " + value : undefined }}>{active && <Check className="size-5 text-white" />}</span><span className="mt-2 block text-[11px] font-bold text-muted-foreground">{name}</span></button>; })}</div><div className="mt-5 flex items-center gap-4 rounded-2xl border border-border/60 bg-card/60 p-4"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow"><Droplet className="size-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Custom color</span><span className="block text-sm text-muted-foreground">Open the system color picker</span></span><input type="color" value={settings.accentColor} onChange={(event) => setSetting("accentColor", event.target.value)} aria-label="Choose custom theme color" className="size-10 cursor-pointer rounded-xl border-0 bg-transparent p-0" /></div></div>}
      </div>
      <Link to="/app/settings/font" className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card/70 p-5"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><Type className="size-5 text-primary" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Typography</span><span className="block truncate text-sm text-muted-foreground">Choose the font used across the app</span></span><span className="text-sm font-semibold text-muted-foreground">{settings.font}</span><ChevronRight className="size-5 text-muted-foreground" /></Link>
      <Link to="/app/settings/background" className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card/70 p-5"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><Sparkles className="size-5 text-primary" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Background Effect</span><span className="block text-sm text-muted-foreground">{settings.background}</span></span><ChevronRight className="size-5 text-muted-foreground" /></Link>
      <Link to="/app/settings/scanner" className="flex items-center gap-4 rounded-3xl border border-primary/30 bg-primary/10 p-5 shadow-glow"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><ScanLine className="size-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Chart Scanner</span><span className="block text-sm text-muted-foreground">Upload a chart — get an instant trade setup</span></span><ChevronRight className="size-5 text-primary" /></Link>
    </div>
  </AppFrame>;
}
