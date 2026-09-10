import { createFileRoute } from "@tanstack/react-router";
import { OptionScreen } from "@/components/SettingsOptions";
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

const OPTIONS = [
  { label: "None", description: "No background animation" },
  { label: "Neon Grid", description: "Synthwave perspective" },
  { label: "Pip Drops", description: "Floating +/- pip values" },
  { label: "Ticker Tape", description: "Scrolling price quotes" },
  { label: "Profit / Loss", description: "Floating +$ and -$" },
  { label: "Zigzag Chart", description: "Live price line drawing" },
  { label: "Pip Grid", description: "Dot grid with sparks" },
];

function BackgroundEffect() {
  const { settings } = useAppState();
  return (
    <OptionScreen
      title="Background Effect"
      options={OPTIONS}
      value={settings.background}
      onSelect={(v) => setSetting("background", v)}
      columns={2}
    />
  );
}
