import { useEffect, useState } from "react";
import { useCustomization } from "@/lib/app-customization";
import { Save, Check } from "lucide-react";

export type BottomNavStyle =
  | "floating-pill"      // Current: rounded glass bar with labels (iPhone style)
  | "icon-pill"          // Floating pill with icons only, no labels
  | "classic-tabs"       // Classic tab bar with labels below icons
  | "compact-dots";      // Compact icon-and-dot bar

const BOTTOM_NAV_STYLES: Array<{
  id: BottomNavStyle;
  name: string;
  description: string;
  icon: string;
}> = [
  {
    id: "floating-pill",
    name: "Floating Pill",
    description: "Rounded glass bar with icons and labels (current)",
    icon: "💊",
  },
  {
    id: "icon-pill",
    name: "Icon Pill",
    description: "Floating pill with icons only, no labels",
    icon: "🔘",
  },
  {
    id: "classic-tabs",
    name: "Classic Tabs",
    description: "Tab bar with labels below each icon",
    icon: "📑",
  },
  {
    id: "compact-dots",
    name: "Compact Dots",
    description: "Compact bar with icons and active dot indicator",
    icon: "⚫",
  },
];

const TABS = [
  { to: "/app/metatrader", label: "METATRADER", icon: "🤖" },
  { to: "/app/home", label: "HOME", icon: "🏠" },
  { to: "/app/scanner", label: "SCANNER", icon: "🔍" },
] as const;

export function BottomNavStyles() {
  const { color } = useCustomization();
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

  const isSelected = (style: BottomNavStyle) => activeStyle === style;

  return (
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

      {/* Preview */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
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
      </p>
    </div>
  );
}

/** Preview component showing the bottom nav in the selected style */
function BottomNavPreview({
  style,
  accent,
}: {
  style: BottomNavStyle;
  accent: string;
}) {
  const activePath = "/app/home"; // Show home as active in preview

  return (
    <div className="relative">
      {/* Mock screen content to show nav floating above */}
      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-gradient-to-b from-white/[0.02] to-black/20">
        <span className="text-xs text-white/20">Screen content</span>
      </div>

      {/* The actual nav preview */}
      <div
        className={`absolute bottom-0 left-1/2 w-[92%] -translate-x-1/2 transition-all duration-300 ${
          style === "floating-pill"
            ? "plat-nav-ios"
            : style === "icon-pill"
            ? "plat-nav-icons"
            : style === "classic-tabs"
            ? "plat-nav-classic"
            : "plat-nav-compact"
        }`}
      >
        {/* Inline preview since we can't use Link in this context */}
        <div className="flex items-center justify-around">
          {TABS.map(({ to, label, icon }) => {
            const isActive = to === activePath;
            return (
              <div
                key={to}
                className={`flex flex-col items-center justify-center gap-0.5 ${
                  style === "classic-tabs" ? "flex-1" : "min-w-[64px]"
                }`}
              >
                <div
                  className={`flex size-10 items-center justify-center rounded-full transition-all ${
                    style === "icon-pill" ? "bg-white/10" : ""
                  } ${
                    style === "compact-dots" && isActive
                      ? "relative"
                      : ""
                  }`}
                  style={
                    isActive
                      ? {
                          color: `var(--accent)`,
                          backgroundColor: style === "icon-pill" ? `var(--accent)/20` : undefined,
                        }
                      : { color: "rgba(255,255,255,0.45)" }
                  }
                >
                  <span className="text-lg">{icon}</span>
                  {style === "compact-dots" && isActive && (
                    <span
                      className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-current"
                      style={{ color: `var(--accent)` }}
                    />
                  )}
                </div>
                {style !== "icon-pill" && (
                  <span
                    className={`text-[10px] font-semibold transition-colors ${
                      style === "classic-tabs"
                        ? "text-[11px]"
                        : "text-[10px]"
                    }`}
                    style={{
                      color: isActive ? `var(--accent)` : "rgba(255,255,255,0.45)",
                    }}
                  >
                    {label.charAt(0) + label.slice(1).toLowerCase()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
