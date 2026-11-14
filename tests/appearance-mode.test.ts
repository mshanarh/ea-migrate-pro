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

  it("sets white mode without changing interface styling or native control colors", () => {
    setAppearanceMode("white");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("white");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--if-surface")).toBe("");
    expect(root.style.getPropertyValue("--if-text")).toBe("");
    expect(root.style.getPropertyValue("--if-bg")).toBe("");
  });

  it("sets black mode and keeps native controls dark", () => {
    setAppearanceMode("black");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--if-surface")).toBe("");
    expect(root.style.getPropertyValue("--if-text")).toBe("");
    expect(root.style.getPropertyValue("--if-bg")).toBe("");
  });

  it("keeps the selected interface unchanged in both background modes", () => {
    const definition = interfaceDefinitionFor("CRIMSON NAVIGATOR");
    if (!definition) throw new Error("Crimson Navigator interface definition is missing");
    applyInterfaceDefinition(definition);

    const root = document.documentElement;
    const original = {
      surface: root.style.getPropertyValue("--if-surface"),
      text: root.style.getPropertyValue("--if-text"),
      background: root.style.getPropertyValue("--if-bg"),
    };

    setAppearanceMode("white");
    expect(root.style.getPropertyValue("--if-surface")).toBe(original.surface);
    expect(root.style.getPropertyValue("--if-text")).toBe(original.text);
    expect(root.style.getPropertyValue("--if-bg")).toBe(original.background);

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
