import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Film, LayoutGrid, LineChart, Music, Palette, Type, X } from "lucide-react";
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

/**
 * Pill row — the drawer's section header, matching the Settings screenshot:
 * dark rounded-full bar, leading icon, bold label, trailing chevron. Tap it
 * to expand the section. `to` navigates instead of expanding (Chart Scanner).
 */
function PillRow({
  icon,
  label,
  open,
  onToggle,
  children,
  to,
  accent,
}: {
  icon: ReactNode;
  label: string;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
  to?: string;
  accent: string;
}) {
  const navigate = useNavigate();
  const handle = () => {
    if (to) {
      void navigate({ to });
      return;
    }
    onToggle?.();
  };
  return (
    <section className="w-full max-w-full">
      <button
        type="button"
        onClick={handle}
        aria-expanded={to ? undefined : open}
        className="flex w-full items-center justify-between gap-3 rounded-full border px-5 py-4 text-left transition-transform active:scale-[0.98]"
        style={{
          borderColor: `${accent}66`,
          background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
          boxShadow: `0 0 18px ${accent}22, inset 0 0 12px ${accent}14`,
        }}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0" style={{ color: accent }} aria-hidden>
            {icon}
          </span>
          <span className="truncate text-base font-bold text-white">{label}</span>
        </span>
        {to ? (
          <ChevronDown className="size-4 shrink-0 rotate-[-90deg]" style={{ color: accent }} aria-hidden />
        ) : (
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="shrink-0" style={{ color: accent }}>
            <ChevronDown className="size-4" aria-hidden />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!to && open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-1 pt-4 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function CustomizationPanel() {
  const { color, theme, font } = useCustomization();
  const accent = accentColorValue(color);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggle = (key: string) => setOpenSection((current) => (current === key ? null : key));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex-1 space-y-4 px-5 py-6">
        <PillRow
          icon={<LayoutGrid className="size-5" />}
          label="Select Main Interface"
          accent={accent}
          open={openSection === "interface"}
          onToggle={() => toggle("interface")}
        >
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
        </PillRow>

        <PillRow
          icon={<Palette className="size-5" />}
          label="Select Colour"
          accent={accent}
          open={openSection === "colour"}
          onToggle={() => toggle("colour")}
        >
          <div className="grid grid-cols-3 gap-3">
            {ACCENT_COLORS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAccentColor(option.id)}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-transform active:scale-95 ${color === option.id ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03]"}`}
              >
                <span className="relative flex size-10 items-center justify-center rounded-full border border-white/20" style={{ backgroundColor: option.value, boxShadow: `0 0 18px ${option.value}80` }}>
                  {color === option.id && <Check className="size-5 text-black" strokeWidth={3} />}
                </span>
                <span className="text-center text-[10px] font-bold text-white/70">{option.name}</span>
              </button>
            ))}
          </div>
        </PillRow>

        <PillRow
          icon={<Type className="size-5" />}
          label="Select Font"
          accent={accent}
          open={openSection === "font"}
          onToggle={() => toggle("font")}
        >
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
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl font-black text-white" style={{ fontFamily: fontStack(option.id) }}>
                  Aa
                </span>
                <span className="flex-1 text-sm font-bold text-white/85">{option.name}</span>
                {font === option.id && <Check className="size-5 shrink-0" style={{ color: accent }} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </PillRow>

        <PillRow icon={<LineChart className="size-5" />} label="Chart Scanner" accent={accent} to="/app/scanner" />

        <PillRow
          icon={<Film className="size-5" />}
          label="Back Animation"
          accent={accent}
          open={openSection === "bg"}
          onToggle={() => toggle("bg")}
        >
          <p className="px-1 text-xs leading-relaxed text-white/45">
            Background effects live in Settings → Background Effects. Open the full Settings page for the complete effect gallery.
          </p>
        </PillRow>

        <PillRow
          icon={<Music className="size-5" />}
          label="Music"
          accent={accent}
          open={openSection === "music"}
          onToggle={() => toggle("music")}
        >
          <p className="px-1 text-xs leading-relaxed text-white/45">
            Upload your own track or link Spotify in Settings → Music.
          </p>
        </PillRow>
      </div>

      <div className="border-t border-white/10 px-5 py-5 text-center">
        <p className="text-sm font-black tracking-[0.18em] text-white/70 uppercase">
          Powered by <span style={{ color: accent }}>EA MIGRATE</span>
        </p>
        <p className="mt-1 text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase">Version 2.0</p>
      </div>
    </div>
  );
}

type DrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function CustomizationDrawer({ open, onClose }: DrawerProps) {
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close customization drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            role="dialog"
            aria-label="Customize your interface"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-[70] flex w-[85%] max-w-sm flex-col border-r bg-[#0a0a0c]/95 backdrop-blur-xl"
            style={{ borderColor: `${accent}40` }}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
              <div>
                <p className="text-xl font-black tracking-[0.08em] text-white">SETTINGS</p>
                <p className="text-xs text-white/45">Make it yours — applies instantly</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-full bg-white/5 text-white/60">
                <X className="size-5" />
              </button>
            </div>
            <CustomizationPanel />
            <p className="pb-3 text-center text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: accent }}>
              Swipe or tap outside to close
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
