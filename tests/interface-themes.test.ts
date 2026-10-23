import { beforeEach, describe, expect, it } from "vitest";
import {
  INTERFACE_DEFINITIONS,
  STYLED_INTERFACE_IDS,
  applyInterfaceDefinition,
  heroDecoration,
  interfaceDefinitionFor,
} from "@/lib/interface-themes";
import { INTERFACE_THEMES, setInterfaceTheme } from "@/lib/app-customization";
import { getBottomNavStyle, setBottomNavStyle } from "@/lib/bottom-nav-style";

/**
 * "SELECT MAIN INTERFACE" — every one of the eight names is a real
 * definition (colours, page background, card surface/radius/border/shadow,
 * header + number treatment, hero decoration and the bottom nav that ships
 * with it), published to <html> so Home, Metatrader, Quotes, Scanner,
 * Settings and the popups repaint together.
 */

const EIGHT = [
  "CRIMSON NAVIGATOR",
  "NAVIGATOR PLUS",
  "PABLO CRIMSON",
  "PABLO ELITE",
  "QUANTUM BLUE",
  "DARKWEB AI",
  "SUPREME EQUINOX",
  "ULTRON MEGA",
] as const;

const root = () => document.documentElement;

describe("interface definitions", () => {
  it("defines all eight Main Interfaces and nothing else", () => {
    expect(STYLED_INTERFACE_IDS.sort()).toEqual([...EIGHT].sort());
    for (const id of EIGHT) {
      const definition = interfaceDefinitionFor(id);
      expect(definition, `${id} must have a real definition`).not.toBeNull();
      // Every id in the picker is offered, with its brief as the design brief.
      const listed = INTERFACE_THEMES.find((theme) => theme.id === id);
      expect(listed, `${id} must stay in Select Main Interface`).toBeDefined();
      expect(definition!.brief).toBe(listed!.description);
    }
  });

  it("gives each interface its own colours, shape, header and nav", () => {
    const signatures = new Set<string>();
    const radii = new Set<string>();
    const backgrounds = new Set<string>();

    for (const id of EIGHT) {
      const definition = interfaceDefinitionFor(id)!;
      signatures.add(definition.signature);
      radii.add(definition.radius);
      backgrounds.add(definition.background);
      // A real theme, not a name: every surface token is populated.
      expect(definition.signature).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(definition.signature2).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(definition.background).toMatch(/^(#[0-9A-Fa-f]{6}|linear-gradient|radial-gradient)/);
      expect(definition.surface.length).toBeGreaterThan(4);
      expect(definition.surfaceAlt.length).toBeGreaterThan(4);
      expect(definition.border).toContain("rgba");
      expect(definition.shadow.length).toBeGreaterThan(0);
      expect(definition.header.weight).toBeGreaterThanOrEqual(600);
      expect(definition.header.size).toMatch(/rem$/);
      expect(["none", "uppercase"]).toContain(definition.header.transform);
      expect(definition.numbers.font.length).toBeGreaterThan(0);
      expect(heroDecoration(definition).wash.length).toBeGreaterThan(10);
    }

    // Clearly distinct, not eight copies of one skin.
    expect(signatures.size).toBe(EIGHT.length);
    expect(radii.size).toBeGreaterThanOrEqual(6);
    expect(backgrounds.size).toBe(EIGHT.length);
  });

  it("ships the nav the briefs ask for", () => {
    expect(interfaceDefinitionFor("CRIMSON NAVIGATOR")!.navStyle).toBe("floating-pill");
    // White circle on red.
    expect(interfaceDefinitionFor("NAVIGATOR PLUS")!.navStyle).toBe("circle-dock");
    expect(interfaceDefinitionFor("NAVIGATOR PLUS")!.navCentre).toBe("#FFFFFF");
    expect(interfaceDefinitionFor("PABLO CRIMSON")!.navStyle).toBe("floating-pill");
    expect(interfaceDefinitionFor("PABLO CRIMSON")!.controlRadius).toBe("999px");
    expect(interfaceDefinitionFor("PABLO ELITE")!.navStyle).toBe("compact-dots");
    expect(interfaceDefinitionFor("QUANTUM BLUE")!.navStyle).toBe("glass-bar");
    expect(interfaceDefinitionFor("QUANTUM BLUE")!.glass).toBe(true);
    expect(interfaceDefinitionFor("DARKWEB AI")!.navStyle).toBe("outlined-pill");
    expect(interfaceDefinitionFor("DARKWEB AI")!.numbers.font).toContain("monospace");
    expect(interfaceDefinitionFor("SUPREME EQUINOX")!.navStyle).toBe("circle-dock");
    expect(interfaceDefinitionFor("ULTRON MEGA")!.navStyle).toBe("square-tiles");
    expect(interfaceDefinitionFor("ULTRON MEGA")!.borderWidth).toBe("2px");
  });
});

describe("applying an interface", () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyInterfaceDefinition(null);
    setBottomNavStyle("floating-pill");
  });

  it("publishes the definition's tokens and marks the document", () => {
    const definition = interfaceDefinitionFor("QUANTUM BLUE")!;
    applyInterfaceDefinition(definition);

    expect(root().getAttribute("data-if-styled")).toBe("true");
    expect(root().getAttribute("data-interface")).toBe("QUANTUM BLUE");
    expect(root().style.getPropertyValue("--if-signature")).toBe(definition.signature);
    expect(root().style.getPropertyValue("--if-bg")).toBe(definition.background);
    expect(root().style.getPropertyValue("--if-radius")).toBe(definition.radius);
    expect(root().style.getPropertyValue("--if-border")).toBe(definition.border);
    expect(root().style.getPropertyValue("--if-nav-centre")).toBe("var(--accent)");
  });

  it("puts the tokens back when a legacy layout is selected", () => {
    applyInterfaceDefinition(interfaceDefinitionFor("ULTRON MEGA")!);
    applyInterfaceDefinition(null);

    expect(root().hasAttribute("data-if-styled")).toBe(false);
    expect(root().hasAttribute("data-interface")).toBe(false);
    expect(root().style.getPropertyValue("--if-bg")).toBe("#000000");
    expect(root().style.getPropertyValue("--if-radius")).toBe("16px");
  });

  it("applies the interface AND its nav when chosen in Settings — instantly and persisted", () => {
    setInterfaceTheme("PABLO ELITE");

    // Persisted like Colour and Font.
    expect(window.localStorage.getItem("ea_migrate_theme")).toBe("PABLO ELITE");
    // The nav that ships with the brief.
    expect(getBottomNavStyle()).toBe("compact-dots");
    expect(window.localStorage.getItem("eamp.bottomNavStyle")).toBe("compact-dots");
    // And the tokens are live on the document.
    expect(root().getAttribute("data-interface")).toBe("PABLO ELITE");
    expect(root().style.getPropertyValue("--if-radius")).toBe("10px");
  });

  it("restores the neutral surface tokens on a legacy layout", () => {
    setInterfaceTheme("CRIMSON NAVIGATOR");
    expect(root().getAttribute("data-interface")).toBe("CRIMSON NAVIGATOR");

    setInterfaceTheme("NOVA CORE");
    expect(window.localStorage.getItem("ea_migrate_theme")).toBe("NOVA CORE");
    expect(root().hasAttribute("data-if-styled")).toBe(false);
    expect(interfaceDefinitionFor("NOVA CORE")).toBeNull();
    // The legacy layout keeps its own nav choice untouched.
    expect(getBottomNavStyle()).toBe("floating-pill");
  });

  it("keeps the user's colour authoritative on every interface", () => {
    // The definitions carry a signature hue for the chrome, but the
    // interactive accent stays `--accent` (Select Colour / colour cycle).
    for (const id of EIGHT) {
      const definition = INTERFACE_DEFINITIONS[id]!;
      expect(definition.signature).not.toBe("var(--accent)");
      expect(definition.navCentre ?? "var(--accent)").not.toBe(definition.signature);
    }
  });
});
