import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_KEY,
  getCustomization,
  setAppearanceMode,
} from "@/lib/app-customization";
import { applyAppearanceMode, interfaceDefinitionFor } from "@/lib/interface-themes";

/**
 * APPEARANCE MODE — OBSIDIAN ONLY.
 *
 * The app is a black console on every screen and every Main Interface. Light
 * surfaces were retired because they rendered white plates behind white text
 * (and dark ink on dark glass) on the layouts that hardcode their colours.
 * These tests pin the parts that decide what is painted:
 *   • the preference loads as black, and a stored legacy "white" is REWRITTEN
 *     to black so no device stays washed out after the update;
 *   • the setter clamps to black — nothing can publish light tokens again;
 *   • the document is always stamped `data-appearance="black"` with the dark
 *     color-scheme, and the interface's own obsidian tokens are untouched.
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

  it("migrates a stored legacy white preference to black on launch", async () => {
    window.localStorage.setItem(APPEARANCE_KEY, "white");
    // A launch is a fresh module: reload the store and read storage again.
    vi.resetModules();
    const fresh = await import("@/lib/app-customization");
    expect(fresh.getCustomization().appearanceMode).toBe("black");
    // …and the stale value is rewritten, so the device stays black.
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("black");
  });

  it("clamps any mode to black and keeps the document dark", () => {
    setAppearanceMode("white");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.colorScheme).toBe("dark");
    // No light surface tokens may be published.
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

  it("is idempotent — repeated calls never introduce a white surface", () => {
    applyAppearanceMode("black");
    applyAppearanceMode("white");
    applyAppearanceMode("black");
    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.getPropertyValue("--if-surface")).toBe("");
  });
});
