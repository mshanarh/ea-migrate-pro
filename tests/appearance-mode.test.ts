import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_KEY,
  getCustomization,
  setAppearanceMode,
} from "@/lib/app-customization";
import { applyAppearanceMode, interfaceDefinitionFor } from "@/lib/interface-themes";

/**
 * APPEARANCE MODE — the Black/White switch.
 *
 * Settings writes the mode once (`setAppearanceMode`); `InterfaceThemeSync`
 * then publishes it to <html>. These tests pin the parts that decide what is
 * actually painted:
 *   • the preference is remembered under its own key and defaults to black;
 *   • WHITE sets `data-appearance="white"` and the light surface/text tokens;
 *   • BLACK writes the obsidian attribute and leaves the interface's own
 *     tokens alone, so switching back is a true restore, not a third theme.
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

  it("defaults to black and remembers a white choice under eamp.appearanceMode", () => {
    expect(getCustomization().appearanceMode).toBe("black");

    setAppearanceMode("white");
    expect(getCustomization().appearanceMode).toBe("white");
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("white");

    setAppearanceMode("black");
    expect(getCustomization().appearanceMode).toBe("black");
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("black");
  });

  it("publishes the light tokens and the white attribute, then restores black", () => {
    setAppearanceMode("white");

    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe("white");
    expect(root.style.colorScheme).toBe("light");
    expect(root.style.getPropertyValue("--if-surface")).toBe("#FFFFFF");
    expect(root.style.getPropertyValue("--if-surface-alt")).toBe("#F1F5F9");
    expect(root.style.getPropertyValue("--if-well")).toBe("#F8FAFC");
    expect(root.style.getPropertyValue("--if-border")).toBe("rgba(0, 0, 0, 0.08)");
    expect(root.style.getPropertyValue("--if-text")).toBe("#0F172A");
    expect(root.style.getPropertyValue("--if-muted")).toBe("#64748B");
    expect(root.style.getPropertyValue("--if-shadow")).toContain("rgba(0, 0, 0, 0.06)");
    expect(root.style.getPropertyValue("--if-bg")).toContain("#FFFFFF");

    setAppearanceMode("black");
    expect(root.getAttribute("data-appearance")).toBe("black");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("keeps a styled interface's dark tokens when the mode is black", () => {
    const definition = interfaceDefinitionFor("CRIMSON NAVIGATOR");
    expect(definition).not.toBeNull();

    // Black writes NOTHING: the definition published by InterfaceThemeSync is
    // the obsidian palette, so the classic console is preserved.
    applyAppearanceMode("black");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("black");
    expect(document.documentElement.style.getPropertyValue("--if-surface")).toBe("");
  });

  it("uses a white surface with dark ink — no white-on-white card", () => {
    setAppearanceMode("white");
    const root = document.documentElement;
    const surface = root.style.getPropertyValue("--if-surface").toUpperCase();
    const ink = root.style.getPropertyValue("--if-text").toUpperCase();
    expect(surface).toBe("#FFFFFF");
    expect(ink).toBe("#0F172A");
    expect(surface).not.toBe(ink);
  });
});
