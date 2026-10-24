import { Check, House, ScanLine, Server } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import {
  BOTTOM_NAV_STYLE_OPTIONS,
  setBottomNavStyle,
  useBottomNavStyle,
  type BottomNavStyle,
} from "@/lib/bottom-nav-style";

export type { BottomNavStyle };

const PREVIEW_TABS = [
  { key: "metatrader", label: "Metatrader", icon: Server },
  { key: "home", label: "Home", icon: House },
  { key: "scanner", label: "Scanner", icon: ScanLine },
] as const;

/**
 * SETTINGS → BOTTOM NAV.
 *
 * One shared, persisted store (`bottom-nav-style.ts`) is written here and read
 * by the real `FixedBottomNav` on Home, Metatrader, Quotes, Scanner and this
 * page — so a tap re-renders every mounted nav immediately, no reload.
 */
export function BottomNavStyles() {
  const { color } = useCustomization();
<<<<<<< HEAD
  const accent = accentColorValue(color);
  const selected = useBottomNavStyle();
=======
  const accent = color;

  const [selectedStyle, setSelectedStyle] = useState<BottomNavStyle>("floating-pill");
  const [applied, setApplied] = useState(false);

  // One shared subscription, read from the same store the real nav and Settings both read.
  const activeStyle = useNavStyle(selectedStyle);

  // Keep the Settings picker in sync with the real nav's live value.
  useEffect(() => {
    if (activeStyle && BOTTOM_NAV_STYLES.some((s) => s.id === activeStyle)) {
      setSelectedStyle(activeStyle);
    }
  }, [activeStyle]);

  // Load saved style from localStorage
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eamp.bottomNavStyle");
      if (saved && BOTTOM_NAV_STYLES.some((s) => s.id === saved)) {
        setSelectedStyle(saved as BottomNavStyle);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSelect = (style: BottomNavStyle) => {
    setSelectedStyle(style);
    try {
      window.localStorage.setItem("eamp.bottomNavStyle", style);
    } catch {
      // ignore
    }
    // Re-read from the shared store so the real nav picks it up.
  };

  const handleApply = () => {
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };
>>>>>>> origin/main

  const isSelected = (style: BottomNavStyle) => activeStyle === style;

  return (
<<<<<<< HEAD
    <div className="space-y-3">
      {BOTTOM_NAV_STYLE_OPTIONS.map((option) => {
        const isSelected = selected === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setBottomNavStyle(option.id)}
            aria-pressed={isSelected}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-transform active:scale-[0.98]"
            style={{
              borderColor: isSelected ? accent : "rgba(255,255,255,0.1)",
              borderWidth: isSelected ? 2 : 1,
              backgroundColor: isSelected ? `${accent}14` : "rgba(255,255,255,0.03)",
              boxShadow: isSelected ? `0 0 22px ${accent}33` : "none",
            }}
          >
            <span className="min-w-0">
              <span className="block text-sm font-black tracking-wide text-white">{option.name}</span>
              <span className="block text-xs text-white/50">{option.description}</span>
            </span>
            {isSelected && <Check className="size-5 shrink-0" style={{ color: accent }} strokeWidth={3} />}
          </button>
        );
      })}
=======
    <div className="space-y-4">
      {/* Style options */}
      <div className="grid grid-cols-1 gap-3">
        {BOTTOM_NAV_STYLES.map((style) => {            const selected = isSelected(style.id);
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => handleSelect(style.id)}
                className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
                  selected
                    ? "border-primary/50 bg-primary/10 shadow-[0_0_20px_rgba(8,168,239,0.3)]"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
                style={selected ? { borderColor: `var(--accent)` } : undefined}
              >
                <span className="text-xl" aria-hidden>
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white">{style.name}</p>
                  <p className="text-xs text-white/50 truncate">{style.description}</p>
                </div>
                {selected && (
                  <Check className="size-5 shrink-0" style={{ color: `var(--accent)` }} strokeWidth={3} />
                )}
              </button>
            );
          })}
      </div>
>>>>>>> origin/main

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
<<<<<<< HEAD
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">Preview</p>
        <NavPreview style={selected} accent={accent} />
      </div>

      <p className="text-center text-xs text-white/40">
        Applies instantly on every screen and is saved on this device.
=======
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/40 mb-3">Preview</p>
        <div className="flex justify-center">
          <BottomNavPreview style={activeStyle ?? selectedStyle} accent={accent} />
        </div>
      </div>

      {/* Apply button — no longer does anything; the switch is live. */}
      <button
        type="button"
        disabled
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white/5 text-sm font-semibold text-white/30 cursor-not-allowed"
      >
        <Save className="size-5" />
        Applied automatically
      </button>

      <p className="text-xs text-white/40 text-center">
        Changes apply instantly across all screens and are saved on this device.
>>>>>>> origin/main
      </p>
    </div>
  );
}

/** A miniature of the chosen style — the shapes the real nav will use. */
function NavPreview({ style, accent }: { style: BottomNavStyle; accent: string }) {
  const labels = style !== "icon-pill" && style !== "compact-dots";
  const item = (tab: (typeof PREVIEW_TABS)[number], active: boolean) => {
    const Icon = tab.icon;
    return (
      <span key={tab.key} className="flex flex-col items-center justify-center gap-0.5">
        <Icon className="size-4" style={{ color: active ? accent : "rgba(255,255,255,0.45)" }} strokeWidth={2.2} />
        {labels && (
          <span
            className="text-[8px] font-semibold tracking-wide"
            style={{ color: active ? accent : "rgba(255,255,255,0.45)" }}
          >
            {tab.label}
          </span>
        )}
      </span>
    );
  };

  if (style === "circle-dock") {
    return (
      <div
        className="flex items-end justify-around rounded-full px-4 py-1.5"
        style={{ backgroundColor: "rgba(16,16,18,0.95)", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        {PREVIEW_TABS.map((tab, index) => {
          const Icon = tab.icon;
          const active = index === 1;
          if (index === 1) {
            return (
              <span
                key={tab.key}
                className="-mt-5 flex size-9 items-center justify-center rounded-full"
                style={{ backgroundColor: accent, color: "#08080a", boxShadow: `0 0 0 4px rgba(10,10,12,0.95)` }}
              >
                <Icon className="size-4" strokeWidth={2.6} />
              </span>
            );
          }
          return item(tab, active);
        })}
      </div>
    );
  }

  const tiles = style === "square-tiles";
  const underline = style === "underline-tabs";
  const outlined = style === "outlined-pill";
  const docked = style === "icon-pill" || style === "compact-dots";

  return (
    <div
      className={`flex w-full items-center justify-around ${tiles ? "gap-1 p-1" : "px-2 py-1.5"} ${
        tiles || underline ? "rounded-none" : "rounded-full"
      }`}
      style={{
        backgroundColor: tiles || underline ? "rgba(12,12,14,0.95)" : outlined ? "transparent" : "rgba(18,18,20,0.9)",
        border: outlined ? "1.5px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
        ...(docked ? { padding: "6px 12px" } : {}),
      }}
    >
      {PREVIEW_TABS.map((tab, index) => {
        const active = index === 1;
        if (tiles) {
          const Icon = tab.icon;
          return (
            <span
              key={tab.key}
              className="flex h-8 flex-1 flex-col items-center justify-center border"
              style={
                active
                  ? { backgroundColor: accent, color: "#08080a", borderColor: accent }
                  : { borderColor: "rgba(255,255,255,0.14)" }
              }
            >
              <Icon className="size-3.5" strokeWidth={2.4} />
            </span>
          );
        }
        if (underline) {
          return (
            <span key={tab.key} className="relative flex flex-1 flex-col items-center py-1">
              {item(tab, active)}
              {active && (
                <span className="absolute bottom-0 h-px w-6 rounded-full" style={{ backgroundColor: accent }} />
              )}
            </span>
          );
        }
        return item(tab, active);
      })}
    </div>
  );
}
