import { createFileRoute } from "@tanstack/react-router";
import { OptionScreen } from "@/components/SettingsOptions";
import { setSetting, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/settings/interface")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Interface Style — EA Migrate Pro" },
      { name: "description", content: "Pick the layout style for your EA app home screen." },
      { property: "og:title", content: "Interface Style — EA Migrate Pro" },
      { property: "og:description", content: "Pick the layout style for your EA app home screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InterfaceStyle,
});

const OPTIONS = [
  { label: "Interface 1", description: "3D core console" },
  { label: "Interface 2", description: "Full-bleed poster" },
  { label: "Interface 3", description: "Half-screen halo" },
  { label: "Interface 4", description: "White-to-blue poster" },
];

function InterfaceStyle() {
  const { settings } = useAppState();
  return (
    <OptionScreen
      title="Interface Style"
      options={OPTIONS}
      value={settings.interfaceStyle}
      onSelect={(v) => setSetting("interfaceStyle", v)}
      numbered
    />
  );
}
