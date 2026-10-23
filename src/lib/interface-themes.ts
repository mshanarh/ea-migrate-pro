/**
 * THE INTERFACE DEFINITIONS — one real definition per Main Interface.
 *
 * "Select Main Interface" used to be a list of NAMES: picking one wrote a
 * string to storage and nothing on screen changed. Each interface is now a
 * full theme/layout definition — colours, page background, card surface,
 * corner radius, borders, shadows, header treatment, number treatment, page
 * texture and the bottom nav that ships with it — published as CSS custom
 * properties on <html> and applied by `InterfaceThemeSync`.
 *
 * THE TOKENS ARE THE ONLY SOURCE OF COLOUR. Every screen (Home, Metatrader,
 * Quotes, Scanner, Settings, the popups and the bottom nav) reads
 * `--if-*` through the shared `.if-*` classes in styles.css. Nothing keeps a
 * colour of its own, which is what makes switching an interface a whole-app
 * change instead of a label change.
 *
 * The interactive accent stays the user's own Colour choice (`--accent`), so
 * Select Colour, the tap-to-cycle and the background switch keep working on
 * every interface. The interface supplies the signature hue used for the page
 * wash, card tint, borders and rules.
 *
 * The legacy layouts (NOVA CORE, PHANTOM PULSE, TITAN EDGE, …) have no
 * definition here: they keep their bespoke Home layouts and styling untouched
 * (the shared `.if-*` surfaces only activate while a definition is in force).
 */

import type { InterfaceThemeId } from "@/lib/app-customization";
import type { BottomNavStyle } from "@/lib/bottom-nav-style";

export type InterfaceDefinition = {
  id: InterfaceThemeId;
  name: string;
  /** The existing subtitle — the design brief this interface is built to. */
  brief: string;
  /** Signature hue: page wash, card tint, rules. */
  signature: string;
  /** Second hue (dual-accent layouts, centre buttons). */
  signature2: string;
  /** Page background behind every screen (any CSS background value). */
  background: string;
  /** Optional page texture laid over the background. */
  texture?: string;
  /** Card surface — a colour or a full gradient. */
  surface: string;
  /** Secondary/two-tone surface. */
  surfaceAlt: string;
  /** Inset wells: inputs, sub-panels, list rows inside a card. */
  well: string;
  border: string;
  borderWidth: string;
  /** Card radius. */
  radius: string;
  /** Button/control radius (pill buttons, chunky tiles…). */
  controlRadius: string;
  shadow: string;
  /** Frosted cards (glassy surfaces). */
  glass?: boolean;
  /** Primary text colour on the interface's own surfaces. */
  text: string;
  /** Secondary text colour — labels, hints, captions. */
  muted: string;
  header: {
    weight: number;
    tracking: string;
    transform: "none" | "uppercase";
    size: string;
    /** Serif-style headers (small caps, elegant tracking). */
    smallCaps?: boolean;
    /** Thin accent rule under headers. */
    rule?: boolean;
  };
  numbers: {
    /** Font stack for prices/numbers — "inherit" follows the user's font. */
    font: string;
    tabular: boolean;
  };
  /** The Home hero visual this interface is known for. */
  decor: "wave" | "circle" | "serif" | "hairline" | "ice" | "grid" | "split" | "metal";
  /** The bottom nav this interface ships with. */
  navStyle: BottomNavStyle;
  /** Centre button colour for the circle dock. */
  navCentre?: string;
  /** Dock background override (two-tone / red chrome). */
  navBg?: string;
  /** The nav's own border / radius / shadow / blur. */
  navBorder?: string;
  navRadius?: string;
  navShadow?: string;
  navBlur?: string;
};

const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
const INHERIT = "inherit";

export const INTERFACE_DEFINITIONS: Record<string, InterfaceDefinition> = {
  "CRIMSON NAVIGATOR": {
    id: "CRIMSON NAVIGATOR",
    name: "Crimson Navigator",
    brief: "Laid-back red console",
    signature: "#E11D2E",
    signature2: "#FF7A85",
    background:
      "radial-gradient(120% 85% at 50% -10%, #33060c 0%, #17040a 45%, #050203 100%)",
    surface: "linear-gradient(180deg, rgba(225,29,46,0.17), rgba(225,29,46,0.05))",
    surfaceAlt: "rgba(225,29,46,0.09)",
    well: "rgba(0,0,0,0.38)",
    border: "rgba(255,122,133,0.26)",
    borderWidth: "1px",
    radius: "24px",
    controlRadius: "999px",
    shadow: "0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,122,133,0.06)",
    text: "#FFF1F3",
    muted: "rgba(255,214,219,0.62)",
    header: { weight: 800, tracking: "0.01em", transform: "none", size: "1.9rem" },
    numbers: { font: INHERIT, tabular: true },
    decor: "wave",
    navStyle: "floating-pill",
    navBg: "linear-gradient(180deg, rgba(62,8,15,0.94), rgba(20,4,8,0.98))",
    navBorder: "rgba(255,122,133,0.26)",
    navRadius: "28px",
    navShadow: "0 16px 40px rgba(0,0,0,0.6)",
    navBlur: "22px",
  },

  "NAVIGATOR PLUS": {
    id: "NAVIGATOR PLUS",
    name: "Navigator Plus",
    brief: "White circle on red",
    signature: "#FF2130",
    signature2: "#FFFFFF",
    background: "linear-gradient(165deg, #4a0208 0%, #220206 45%, #0a0102 100%)",
    surface: "rgba(255,255,255,0.06)",
    surfaceAlt: "rgba(255,255,255,0.10)",
    well: "rgba(0,0,0,0.32)",
    border: "rgba(255,255,255,0.20)",
    borderWidth: "1px",
    radius: "12px",
    controlRadius: "10px",
    shadow: "0 12px 30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.70)",
    header: { weight: 900, tracking: "0.02em", transform: "uppercase", size: "1.7rem", rule: true },
    numbers: { font: INHERIT, tabular: true },
    decor: "circle",
    navStyle: "circle-dock",
    navCentre: "#FFFFFF",
    navBg: "linear-gradient(180deg, rgba(140,8,18,0.95), rgba(34,2,6,0.98))",
    navBorder: "rgba(255,255,255,0.24)",
    navRadius: "999px",
    navShadow: "0 18px 44px rgba(0,0,0,0.65)",
    navBlur: "18px",
  },

  "PABLO CRIMSON": {
    id: "PABLO CRIMSON",
    name: "Pablo Crimson",
    brief: "Mentor favourite",
    signature: "#C1123A",
    signature2: "#D8A24A",
    background: "linear-gradient(180deg, #20050f 0%, #0d0206 100%)",
    surface: "linear-gradient(180deg, rgba(216,162,74,0.15), rgba(193,18,58,0.10))",
    surfaceAlt: "rgba(216,162,74,0.09)",
    well: "rgba(24,3,9,0.55)",
    border: "rgba(216,162,74,0.34)",
    borderWidth: "1px",
    radius: "22px",
    controlRadius: "999px",
    shadow: "0 16px 38px rgba(0,0,0,0.5), 0 0 0 1px rgba(216,162,74,0.10)",
    text: "#FFF6EC",
    muted: "rgba(255,228,196,0.66)",
    header: {
      weight: 600,
      tracking: "0.08em",
      transform: "none",
      size: "1.95rem",
      smallCaps: true,
      rule: true,
    },
    numbers: { font: INHERIT, tabular: true },
    decor: "serif",
    navStyle: "floating-pill",
    navBg: "linear-gradient(180deg, rgba(46,8,22,0.95), rgba(14,2,7,0.98))",
    navBorder: "rgba(216,162,74,0.38)",
    navRadius: "999px",
    navShadow: "0 18px 44px rgba(0,0,0,0.65), 0 0 0 1px rgba(216,162,74,0.12)",
    navBlur: "20px",
  },

  "PABLO ELITE": {
    id: "PABLO ELITE",
    name: "Pablo Elite",
    brief: "Sniper focus mode",
    signature: "#FF3B30",
    signature2: "#7A0F0C",
    background: "#040405",
    surface: "rgba(255,255,255,0.022)",
    surfaceAlt: "rgba(255,255,255,0.04)",
    well: "rgba(255,255,255,0.015)",
    border: "rgba(255,59,48,0.32)",
    borderWidth: "1px",
    radius: "10px",
    controlRadius: "8px",
    shadow: "none",
    text: "#F5F5F7",
    muted: "rgba(245,245,247,0.45)",
    header: { weight: 700, tracking: "0.12em", transform: "uppercase", size: "1.45rem", rule: true },
    numbers: { font: INHERIT, tabular: true },
    decor: "hairline",
    navStyle: "compact-dots",
    navBg: "rgba(3,3,4,0.97)",
    navBorder: "rgba(255,59,48,0.30)",
    navRadius: "6px",
    navShadow: "none",
    navBlur: "10px",
  },

  "QUANTUM BLUE": {
    id: "QUANTUM BLUE",
    name: "Quantum Blue",
    brief: "Ice-blue circle",
    signature: "#22D3EE",
    signature2: "#A5F3FC",
    background:
      "radial-gradient(120% 90% at 50% -10%, #07344a 0%, #041722 55%, #02070c 100%)",
    surface: "linear-gradient(180deg, rgba(34,211,238,0.17), rgba(34,211,238,0.05))",
    surfaceAlt: "rgba(34,211,238,0.10)",
    well: "rgba(2,20,28,0.55)",
    border: "rgba(165,243,252,0.30)",
    borderWidth: "1px",
    radius: "26px",
    controlRadius: "999px",
    shadow: "0 0 34px rgba(34,211,238,0.20), 0 16px 40px rgba(0,0,0,0.5)",
    glass: true,
    text: "#EAFBFF",
    muted: "rgba(201,246,255,0.62)",
    header: { weight: 800, tracking: "0.03em", transform: "none", size: "1.9rem" },
    numbers: { font: INHERIT, tabular: true },
    decor: "ice",
    navStyle: "glass-bar",
    navBg: "linear-gradient(180deg, rgba(9,58,78,0.62), rgba(3,16,24,0.88))",
    navBorder: "rgba(165,243,252,0.32)",
    navRadius: "24px",
    navShadow: "0 0 34px rgba(34,211,238,0.22), 0 18px 44px rgba(0,0,0,0.55)",
    navBlur: "30px",
  },

  "DARKWEB AI": {
    id: "DARKWEB AI",
    name: "Darkweb AI",
    brief: "Black sniper studio",
    signature: "#E9EDF2",
    signature2: "#6B7280",
    background: "#000000",
    texture:
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 28px)",
    surface: "rgba(255,255,255,0.03)",
    surfaceAlt: "rgba(255,255,255,0.055)",
    well: "#050506",
    border: "rgba(255,255,255,0.16)",
    borderWidth: "1px",
    radius: "8px",
    controlRadius: "999px",
    shadow: "none",
    text: "#F2F5F8",
    muted: "rgba(242,245,248,0.42)",
    header: { weight: 700, tracking: "0.18em", transform: "uppercase", size: "1.45rem" },
    numbers: { font: MONO, tabular: true },
    decor: "grid",
    navStyle: "outlined-pill",
    navBg: "rgba(0,0,0,0.96)",
    navBorder: "rgba(255,255,255,0.30)",
    navRadius: "999px",
    navShadow: "0 0 0 1px rgba(255,255,255,0.04)",
    navBlur: "0px",
  },

  "SUPREME EQUINOX": {
    id: "SUPREME EQUINOX",
    name: "Supreme Equinox",
    brief: "Dual accent layout",
    signature: "#E11D48",
    signature2: "#C9D2DE",
    background: "linear-gradient(100deg, #1c0408 0%, #0a0a0c 50%, #0c1118 100%)",
    surface: "linear-gradient(100deg, rgba(225,29,72,0.18), rgba(201,210,222,0.08))",
    surfaceAlt: "linear-gradient(100deg, rgba(201,210,222,0.10), rgba(225,29,72,0.14))",
    well: "rgba(6,8,12,0.60)",
    border: "rgba(255,255,255,0.16)",
    borderWidth: "1px",
    radius: "18px",
    controlRadius: "999px",
    shadow: "0 14px 34px rgba(0,0,0,0.5)",
    text: "#F7FAFF",
    muted: "rgba(226,232,240,0.58)",
    header: { weight: 800, tracking: "0.02em", transform: "none", size: "1.8rem", rule: true },
    numbers: { font: INHERIT, tabular: true },
    decor: "split",
    navStyle: "circle-dock",
    navCentre: "#E2E8F0",
    navBg: "linear-gradient(90deg, rgba(159,18,57,0.92), rgba(148,163,184,0.35))",
    navBorder: "rgba(255,255,255,0.20)",
    navRadius: "999px",
    navShadow: "0 16px 40px rgba(0,0,0,0.6)",
    navBlur: "18px",
  },

  "ULTRON MEGA": {
    id: "ULTRON MEGA",
    name: "Ultron Mega",
    brief: "Heavy metal console",
    signature: "#A8B2BE",
    signature2: "#D6DEE8",
    background: "linear-gradient(180deg, #23272c 0%, #14171b 45%, #0a0c0f 100%)",
    surface: "linear-gradient(180deg, rgba(168,178,190,0.22), rgba(84,92,102,0.14))",
    surfaceAlt: "linear-gradient(180deg, rgba(214,222,232,0.16), rgba(84,92,102,0.10))",
    well: "linear-gradient(180deg, rgba(9,11,14,0.90), rgba(20,24,28,0.90))",
    border: "rgba(198,208,220,0.38)",
    borderWidth: "2px",
    radius: "4px",
    controlRadius: "4px",
    shadow:
      "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -2px 0 rgba(0,0,0,0.6), 0 12px 26px rgba(0,0,0,0.55)",
    text: "#F2F5F9",
    muted: "rgba(214,222,232,0.58)",
    header: { weight: 900, tracking: "0.06em", transform: "uppercase", size: "1.8rem" },
    numbers: { font: INHERIT, tabular: true },
    decor: "metal",
    navStyle: "square-tiles",
    navBg: "linear-gradient(180deg, #3a4048, #1b1f24)",
    navBorder: "rgba(198,208,220,0.45)",
    navRadius: "0px",
    navShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 -6px 18px rgba(0,0,0,0.6)",
    navBlur: "0px",
  },
};

/** The ids that carry a real definition (the eight Main Interface styles). */
export const STYLED_INTERFACE_IDS = Object.keys(INTERFACE_DEFINITIONS);

/** The definition for an interface id, or null for a legacy layout. */
export function interfaceDefinitionFor(id: string): InterfaceDefinition | null {
  return INTERFACE_DEFINITIONS[id] ?? null;
}

/**
 * Publish one definition (or the neutral defaults) to the document root.
 * Synchronous and idempotent — the sync component calls it on every change,
 * which is what makes a selection visible immediately, without a reload.
 */
export function applyInterfaceDefinition(definition: InterfaceDefinition | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (!definition) {
    root.removeAttribute("data-if-styled");
    root.removeAttribute("data-interface");
    root.removeAttribute("data-if-accent");
    const neutral: Record<string, string> = {
      "--if-signature": "#ffffff",
      "--if-signature-2": "#ffffff",
      "--if-bg": "#000000",
      "--if-texture": "none",
      "--if-surface": "rgba(255,255,255,0.03)",
      "--if-surface-alt": "rgba(255,255,255,0.06)",
      "--if-well": "rgba(0,0,0,0.35)",
      "--if-text": "#ffffff",
      "--if-muted": "rgba(255,255,255,0.55)",
      "--if-border": "rgba(255,255,255,0.10)",
      "--if-border-width": "1px",
      "--if-radius": "16px",
      "--if-control-radius": "16px",
      "--if-shadow": "none",
      "--if-header-weight": "800",
      "--if-header-tracking": "0em",
      "--if-header-transform": "none",
      "--if-header-size": "1.75rem",
      "--if-header-rule": "transparent",
      "--if-number-font": "inherit",
      "--if-blur": "none",
      "--if-font-variant": "normal",
      "--if-nav-bg": "rgba(16,16,18,0.92)",
      "--if-nav-centre": "var(--accent)",
      "--if-nav-border": "rgba(255,255,255,0.10)",
      "--if-nav-radius": "999px",
      "--if-nav-shadow": "0 16px 40px rgba(0,0,0,0.55)",
      "--if-nav-blur": "18px",
    };
    for (const [name, value] of Object.entries(neutral)) root.style.setProperty(name, value);
    console.debug("[interface] ACTIVE = legacy layout (no definition) | accent = --accent");
    return;
  }

  root.setAttribute("data-if-styled", "true");
  root.setAttribute("data-interface", definition.id);
  // Inspectable proof of what is live — `document.documentElement.dataset.ifAccent`.
  root.setAttribute("data-if-accent", definition.signature);

  const vars: Record<string, string> = {
    "--if-signature": definition.signature,
    "--if-signature-2": definition.signature2,
    "--if-bg": definition.background,
    "--if-texture": definition.texture ?? "none",
    "--if-surface": definition.surface,
    "--if-surface-alt": definition.surfaceAlt,
    "--if-well": definition.well,
    "--if-text": definition.text,
    "--if-muted": definition.muted,
    "--if-border": definition.border,
    "--if-border-width": definition.borderWidth,
    "--if-radius": definition.radius,
    "--if-control-radius": definition.controlRadius,
    "--if-shadow": definition.shadow,
    "--if-header-weight": String(definition.header.weight),
    "--if-header-tracking": definition.header.tracking,
    "--if-header-transform": definition.header.transform,
    "--if-header-size": definition.header.size,
    "--if-header-rule": definition.header.rule ? definition.signature : "transparent",
    "--if-number-font": definition.numbers.font,
    "--if-blur": definition.glass ? "blur(18px) saturate(1.5)" : "none",
    "--if-font-variant": definition.header.smallCaps ? "small-caps" : "normal",
    "--if-nav-bg": definition.navBg ?? "rgba(16,16,18,0.92)",
    "--if-nav-centre": definition.navCentre ?? "var(--accent)",
    "--if-nav-border": definition.navBorder ?? "rgba(255,255,255,0.10)",
    "--if-nav-radius": definition.navRadius ?? "999px",
    "--if-nav-shadow": definition.navShadow ?? "0 16px 40px rgba(0,0,0,0.55)",
    "--if-nav-blur": definition.navBlur ?? "18px",
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);

  // Temporary verification line: which interface is live, and its accent.
  console.debug(
    `[interface] ACTIVE = ${definition.id} | accent = ${definition.signature} | card radius = ${definition.radius} | nav = ${definition.navStyle}`,
  );
}

/** The Home hero decoration values for one definition. */
export function heroDecoration(definition: InterfaceDefinition): {
  /** Full-bleed wash inside the hero card. */
  wash: string;
  /** Optional glow ring colour. */
  ring?: string;
} {
  const { signature, signature2 } = definition;
  switch (definition.decor) {
    case "circle":
      return { wash: `radial-gradient(circle at 50% 45%, ${signature2}1f, transparent 60%)`, ring: signature2 };
    case "ice":
      return { wash: `radial-gradient(circle at 50% 40%, ${signature}33, transparent 62%)`, ring: signature };
    case "split":
      return {
        wash: `linear-gradient(100deg, ${signature}33 0%, ${signature}0a 45%, ${signature2}1f 100%)`,
        ring: signature2,
      };
    case "metal":
      return {
        wash: `linear-gradient(180deg, ${signature}2e 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.55) 100%)`,
        ring: signature2,
      };
    case "grid":
      return { wash: `linear-gradient(180deg, ${signature}12, transparent 70%)` };
    case "hairline":
      return { wash: `linear-gradient(180deg, ${signature}14, transparent 55%)`, ring: signature };
    case "serif":
      return { wash: `linear-gradient(160deg, ${signature2}22 0%, ${signature}1f 55%, transparent 100%)` };
    default:
      return { wash: `linear-gradient(180deg, ${signature}2b 0%, transparent 70%)` };
  }
}
