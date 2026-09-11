import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BackgroundEffectCard, BACKGROUND_EFFECTS, type BackgroundEffect } from "@/components/BackgroundEffects";
import { AppFrame } from "@/components/AppFrame";
import { Switch } from "@/components/ui/switch";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/background")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Background Effect — EA Migrate Pro" },
      { name: "description", content: "Choose the animated background effect for your EA app." },
      { property: "og:title", content: "Background Effect — EA Migrate Pro" },
      { property: "og:description", content: "Choose the animated background effect for your EA app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BackgroundEffect,
});

const AVAILABLE_EFFECTS = BACKGROUND_EFFECTS.slice(0, 8);

function BackgroundEffect() {
  const { settings } = useAppState();
  const selected = AVAILABLE_EFFECTS.includes(settings.background as BackgroundEffect) ? settings.background as BackgroundEffect : AVAILABLE_EFFECTS[0];
  return <AppFrame><div className="max-h-[calc(100vh-8rem)] overflow-y-auto pb-8 pr-1">
    <div className="flex items-center gap-3"><Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Settings</p><h1 className="truncate text-2xl font-black">Background Effects</h1></div></div>
    <p className="mt-3 text-sm text-muted-foreground">Choose an animated background for your app</p>
    <div className="panel mt-5 flex items-center gap-4 p-4"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12"><span className="relative size-3 rounded-full bg-primary shadow-glow" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Background effects</span><span className="block text-xs text-muted-foreground">Keep the interface in motion</span></span><Switch checked={settings.backgroundEnabled} onCheckedChange={(checked) => setSetting("backgroundEnabled", checked)} aria-label="Toggle background effects" /></div>
    <div className="mt-6 grid grid-cols-2 gap-3">{AVAILABLE_EFFECTS.map((effect) => <BackgroundEffectCard key={effect} effect={effect} selected={selected === effect} onSelect={() => setSetting("background", effect)} />)}</div>
    {!settings.backgroundEnabled && <p className="mt-4 text-center text-xs text-muted-foreground">Background effects are currently off.</p>}
  </div></AppFrame>;
}
