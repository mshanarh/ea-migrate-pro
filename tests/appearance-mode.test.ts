import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_KEY,
  getCustomization,
  setAppearanceMode,
} from "@/lib/app-customization";
import {
  applyAppearanceMode,
  applyInterfaceDefinition,
  interfaceDefinitionFor,
} from "@/lib/interface-themes";

/** Black/White selects the Home background without changing its interface. */
describe("appearance mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute("data-appearance");
    for (const name of [
      "--if-bg",
      "--if-surface",
      "--if-surface-alt",
      "--if-well",
      "--if-border",
      "--if-text",
      "--if-muted",
      "--if-shadow",
      "--if-nav-bg",
    ]) {
      root.style.removeProperty(name);
    }
  });

  it("defaults to black", () => {
    expect(getCustomization().appearanceMode).toBe("black");
  });

  it("accepts stored white preference and keeps it", async () => {
    window.localStorage.setItem(APPEARANCE_KEY, "white");
    vi.resetModules();
    const fresh = await import("@/lib/app-customization");
    expect(fresh.getCustomization().appearanceMode).toBe("white");
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("white");
  });

  it("paints light surfaces for white mode and lets native controls go light", () => {
    setAppearanceMode("white");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("white");
    // White mode means light native controls too: scrollbars, date pickers and
    // autofill were still dark because color-scheme was pinned to "dark".
    expect(root.style.colorScheme).toBe("light");
    // SURFACES FOLLOW THE MODE. Leaving the interface's obsidian surface tokens
    // in place while forcing dark ink on every paragraph is what made cards and
    // Settings unreadable: dark text on a dark card.
    expect(root.style.getPropertyValue("--if-surface")).toBe("rgba(255,255,255,0.94)");
    expect(root.style.getPropertyValue("--if-text")).toBe("#0f172a");
    expect(root.style.getPropertyValue("--if-border")).toBe("rgba(15,23,42,0.12)");
  });

  it("sets black mode and puts the dark surfaces back", () => {
    setAppearanceMode("white");
    setAppearanceMode("black");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.colorScheme).toBe("dark");
    // No styled interface was published here, so the neutral obsidian tokens
    // are what must be live again — never the light ones white mode left.
    expect(root.style.getPropertyValue("--if-surface")).toBe("rgba(255,255,255,0.03)");
    expect(root.style.getPropertyValue("--if-text")).toBe("#ffffff");
  });

  it("keeps the interface's layout and accent, flipping only the surface palette", () => {
    const definition = interfaceDefinitionFor("CRIMSON NAVIGATOR");
    if (!definition) throw new Error("Crimson Navigator interface definition is missing");
    applyInterfaceDefinition(definition);

    const root = document.documentElement;
    const original = {
      surface: root.style.getPropertyValue("--if-surface"),
      text: root.style.getPropertyValue("--if-text"),
      background: root.style.getPropertyValue("--if-bg"),
      accent: root.style.getPropertyValue("--if-signature"),
      radius: root.style.getPropertyValue("--if-radius"),
    };

    // White: light surfaces + dark ink, while the interface's own canvas
    // colour, accent and geometry stay exactly as the trader chose them.
    setAppearanceMode("white");
    expect(root.style.getPropertyValue("--if-surface")).toBe("rgba(255,255,255,0.94)");
    expect(root.style.getPropertyValue("--if-text")).toBe("#0f172a");
    expect(root.style.getPropertyValue("--if-bg")).toBe(original.background);
    expect(root.style.getPropertyValue("--if-signature")).toBe(original.accent);
    expect(root.style.getPropertyValue("--if-radius")).toBe(original.radius);

    // Black: the definition's own tokens come back, not a leftover light card.
    setAppearanceMode("black");
    expect(root.style.getPropertyValue("--if-surface")).toBe(original.surface);
    expect(root.style.getPropertyValue("--if-text")).toBe(original.text);
    expect(root.style.getPropertyValue("--if-bg")).toBe(original.background);
  });

  it("is idempotent — repeated calls keep the chosen appearance", () => {
    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    applyAppearanceMode("white");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("white");
    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
