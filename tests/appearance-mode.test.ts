import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_KEY,
  getCustomization,
  setAppearanceMode,
} from "@/lib/app-customization";
import { applyAppearanceMode, interfaceDefinitionFor } from "@/lib/interface-themes";

/**
 * APPEARANCE MODE — BLACK (obsidian) or WHITE (light, home-screen-only).
 *
 * BLACK: deep obsidian surfaces, pure white ink and the user's accent across
 * every screen.
 *
 * WHITE: the HOME SCREEN background switches to a light/white surface while
 * the interface (cards, controls, text, nav) stays black — the white theme
 * only affects the home screen background, not the whole UI.
 * These tests pin the parts that decide what is painted:
 *   • the preference loads as black by default;
 *   • the setter accepts "black" or "white" and stamps the document accordingly;
 *   • the document is stamped `data-appearance="black"` or `data-appearance="white"`
 *     with the matching color-scheme.
 */
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
    // A launch is a fresh module: reload the store and read storage again.
    vi.resetModules();
    const fresh = await import("@/lib/app-customization");
    expect(fresh.getCustomization().appearanceMode).toBe("white");
    // …and the value is preserved, so the device respects the choice.
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("white");
  });

  it("sets white mode and keeps the document light", () => {
    setAppearanceMode("white");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("white");
    expect(root.style.colorScheme).toBe("light");
    // No interface surface tokens are published by the appearance mode.
    expect(root.style.getPropertyValue("--if-surface")).toBe("");
    expect(root.style.getPropertyValue("--if-text")).toBe("");
    expect(root.style.getPropertyValue("--if-bg")).toBe("");
  });

  it("sets black mode and keeps the document dark", () => {
    setAppearanceMode("black");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.colorScheme).toBe("dark");
    // No interface surface tokens are published by the appearance mode.
    expect(root.style.getPropertyValue("--if-surface")).toBe("");
    expect(root.style.getPropertyValue("--if-text")).toBe("");
    expect(root.style.getPropertyValue("--if-bg")).toBe("");
  });

  it("leaves a styled interface's obsidian tokens in place", () => {
    const definition = interfaceDefinitionFor("CRIMSON NAVIGATOR");
    expect(definition).not.toBeNull();

    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    expect(document.documentElement.style.getPropertyValue("--if-surface")).toBe("");
  });

  it("is idempotent — repeated calls keep the chosen appearance", () => {
    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    applyAppearanceMode("white");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("white");
    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    expect(document.documentElement.style.getPropertyValue("--if-surface")).toBe("");
  });
});
