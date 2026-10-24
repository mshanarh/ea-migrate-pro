import { Check, House, ScanLine, Server, Save } from "lucide-react";
import { useCustomization } from "@/lib/app-customization";
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
  const accent = color;
  const activeStyle = useBottomNavStyle();

  return (
    <div className="space-y-3">
      {BOTTOM_NAV_STYLE_OPTIONS.map((option) => {
        const isSelected = activeStyle === option.id;
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

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-white/40">Preview</p>
        <div className="flex justify-center">
          <NavPreview style={activeStyle} accent={accent} />
        </div>
      </div>

      {/* The switch is live — nothing to apply. */}
      <button
        type="button"
        disabled
        className="flex h-14 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-white/5 text-sm font-semibold text-white/30"
      >
        <Save className="size-5" />
        Applied automatically
      </button>

      <p className="text-center text-xs text-white/40">
        Changes apply instantly across all screens and are saved on this device.
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
          <span className="text-[8px] font-semibold tracking-wide" style={{ color: active ? accent : "rgba(255,255,255,0.45)" }}>
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
          if (index === 1) {
            return (
              <span
                key={tab.key}
                className="-mt-5 flex size-9 items-center justify-center rounded-full"
                style={{ backgroundColor: accent, color: "#08080a", boxShadow: "0 0 0 4px rgba(10,10,12,0.95)" }}
              >
                <Icon className="size-4" strokeWidth={2.6} />
              </span>
            );
          }
          return item(tab, false);
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
              {active && <span className="absolute bottom-0 h-px w-6 rounded-full" style={{ backgroundColor: accent }} />}
            </span>
          );
        }
        return item(tab, active);
      })}
    </div>
  );
}
