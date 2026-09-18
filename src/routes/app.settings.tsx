import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { BackAnimationSection } from "@/components/app/BackAnimationSection";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { MusicSettingsSection } from "@/components/app/MusicSettings";
import {
  ACCENT_COLORS,
  FONT_OPTIONS,
  INTERFACE_THEMES,
  accentColorValue,
  fontStack,
  setAccentColor,
  setFontOption,
  setInterfaceTheme,
  useCustomization,
} from "@/lib/app-customization";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Settings — EA Migrate Pro" },
      { name: "description", content: "Customize colors, interface style, fonts, background effects and music." },
    ],
  }),
  component: AppSettings,
});

const CYAN = "#00e5ff";

/** Pill section header — tap the pill (or the >) to expand, like the screenshots. */
function PillSection({
  icon,
  label,
  open,
  onToggle,
  children,
  switchOn,
  onSwitch,
}: {
  icon: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  switchOn?: boolean;
  onSwitch?: () => void;
}) {
  return (
    <section className="w-full max-w-full">
      <div className="flex items-center justify-between gap-3 rounded-full border border-white/10 bg-[#0f1a1a] px-5 py-3.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="text-xl" aria-hidden>
            {icon}
          </span>
          <span className="truncate text-sm font-black tracking-wide text-white">{label}</span>
        </button>
        {onSwitch && (
          <button
            type="button"
            role="switch"
            aria-checked={switchOn ?? false}
            aria-label={`Toggle ${label}`}
            onClick={onSwitch}
            className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
            style={{ backgroundColor: switchOn ? CYAN : "rgba(255,255,255,0.15)" }}
          >
            <span
              className="absolute top-1 size-5 rounded-full bg-white shadow transition-all"
              style={{ left: switchOn ? "26px" : "4px" }}
            />
          </button>
        )}
        <motion.button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
        >
          <ChevronRight className="size-4" strokeWidth={2.6} />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function AccentSection({ accent }: { accent: string }) {
  const { color } = useCustomization();
  return (
    <div className="grid grid-cols-3 gap-3">
      {ACCENT_COLORS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setAccentColor(option.id)}
          className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-transform active:scale-95 ${
            color === option.id ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <span
            className="relative flex size-10 items-center justify-center rounded-full border border-white/20"
            style={{ backgroundColor: option.value, boxShadow: `0 0 18px ${option.value}80` }}
          >
            {color === option.id && <Check className="size-5 text-black" strokeWidth={3} />}
          </span>
          <span className="text-center text-[10px] font-bold text-white/70">{option.name}</span>
        </button>
      ))}
      <span className="sr-only" style={{ color: accent }}>
        accent
      </span>
    </div>
  );
}

function InterfaceSection({ accent }: { accent: string }) {
  const { theme } = useCustomization();
  return (
    <div className="space-y-3">
      {INTERFACE_THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setInterfaceTheme(option.id)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-transform active:scale-[0.98]"
          style={{
            borderColor: theme === option.id ? accent : "rgba(255,255,255,0.1)",
            backgroundColor: theme === option.id ? `${accent}14` : "rgba(255,255,255,0.03)",
            boxShadow: theme === option.id ? `0 0 22px ${accent}33` : "none",
          }}
        >
          <span>
            <span className="block text-sm font-black tracking-wide text-white">{option.name}</span>
            <span className="block text-xs text-white/50">{option.description}</span>
          </span>
          {theme === option.id && <Check className="size-5 shrink-0" style={{ color: accent }} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

function FontSection({ accent }: { accent: string }) {
  const { font } = useCustomization();
  return (
    <div className="space-y-3">
      {FONT_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setFontOption(option.id)}
          className="flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-transform active:scale-[0.98]"
          style={{
            borderColor: font === option.id ? accent : "rgba(255,255,255,0.1)",
            backgroundColor: font === option.id ? `${accent}14` : "rgba(255,255,255,0.03)",
          }}
        >
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl font-black text-white"
            style={{ fontFamily: fontStack(option.id) }}
          >
            Aa
          </span>
          <span className="flex-1 text-sm font-bold text-white/85">{option.name}</span>
          {font === option.id && <Check className="size-5 shrink-0" style={{ color: accent }} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

function AppSettings() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
        <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pt-10 pb-40">
          <div className="pb-5">
            <h1 className="text-3xl font-black tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-white/55">Tap any section to open it. Changes apply instantly and are saved on this device.</p>
          </div>

          <div className="w-full max-w-full space-y-4">
            <PillSection icon="🎨" label="Accent Colors" open={!!openSections["accent"]} onToggle={() => toggleSection("accent")}>
              <AccentSection accent={accent} />
            </PillSection>

            <PillSection icon="🖼️" label="Interface Styles" open={!!openSections["interface"]} onToggle={() => toggleSection("interface")}>
              <InterfaceSection accent={accent} />
            </PillSection>

            <PillSection icon="🔤" label="Font Styles" open={!!openSections["font"]} onToggle={() => toggleSection("font")}>
              <FontSection accent={accent} />
            </PillSection>

            <PillSection
              icon="🎞️"
              label="Back Animation"
              open={!!openSections["bg"]}
              onToggle={() => toggleSection("bg")}
            >
              <BackAnimationSection />
            </PillSection>

            <PillSection icon="🎵" label="Music" open={!!openSections["music"]} onToggle={() => toggleSection("music")}>
              <MusicSettingsSection />
            </PillSection>
          </div>
        </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
    </div>
  );
}
