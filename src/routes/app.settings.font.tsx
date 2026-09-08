import { createFileRoute } from "@tanstack/react-router";
import { OptionScreen } from "@/components/SettingsOptions";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/font")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "App Font — EA Migrate Pro" },
      { name: "description", content: "Choose the typeface used across your EA app." },
      { property: "og:title", content: "App Font — EA Migrate Pro" },
      { property: "og:description", content: "Choose the typeface used across your EA app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FontPage,
});

const OPTIONS = [
  { label: "Normal", description: "Default" },
  { label: "Fugaz One", description: "Italic" },
  { label: "Inter", description: "Clean" },
  { label: "Rajdhani", description: "Tech" },
  { label: "Black Ops One", description: "Military" },
  { label: "Audiowide", description: "Cyber" },
  { label: "Rubik Glitch", description: "Glitch" },
];

function FontPage() {
  const { settings } = useAppState();
  return (
    <OptionScreen
      title="Font"
      options={OPTIONS}
      value={settings.font}
      onSelect={(v) => setSetting("font", v)}
    />
  );
}
