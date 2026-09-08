import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Droplet, LayoutTemplate, ScanLine, Sparkles, Type } from "lucide-react";
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

function SettingsPage() {
  const { settings } = useAppState();

  const rows = [
    { to: "/app/settings/background", icon: Sparkles, label: "Background Effect", value: settings.background },
    { to: "/app/settings/interface", icon: LayoutTemplate, label: "Interface", value: settings.interfaceStyle },
  ] as const;

  return (
    <AppFrame>
      <h1 className="text-2xl font-bold">Settings</h1>

      <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
        Appearance
      </p>
      <div className="panel mt-3 divide-y divide-border/50">
        {rows.map(({ to, icon: Icon, label, value }) => (
          <Link key={to} to={to} className="flex items-center gap-4 p-4">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12">
              <Icon className="size-5 text-primary" />
            </span>
            <span className="flex-1 font-semibold">{label}</span>
            <span className="text-sm text-muted-foreground">{value}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>

      <p className="mt-8 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
        Customize
      </p>
      <Link to="/app/settings/font" className="panel mt-3 flex items-center gap-4 p-4">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12">
          <Type className="size-5 text-primary" />
        </span>
        <span className="flex-1 font-semibold">Font</span>
        <span className="text-sm text-muted-foreground">{settings.font}</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      <Link
        to="/app/settings/scanner"
        className="panel mt-4 flex items-center gap-4 p-4 glow-ring"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ScanLine className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block font-bold">Chart Scanner</span>
          <span className="block text-sm text-muted-foreground">
            Upload a chart — get an instant trade setup
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      <p className="mt-8 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
        Custom accent
      </p>
      <div className="panel mt-3 p-5">
        <p className="font-semibold">Fine tune your perfect colour brightness</p>
        <div className="mt-5 flex items-center gap-4">
          <input
            type="range"
            min={10}
            max={100}
            value={settings.accent}
            onChange={(e) => setSetting("accent", Number(e.target.value))}
            className="h-2 flex-1 accent-primary"
          />
          <span className="flex size-12 items-center justify-center rounded-2xl border border-primary/50">
            <Droplet className="size-5 text-primary" />
          </span>
        </div>
      </div>
    </AppFrame>
  );
}
