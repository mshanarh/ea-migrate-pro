import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_FONT_VAR,
  FONT_OPTIONS,
  applyFontStack,
  fontStack,
  getCustomization,
  setFontOption,
  setInterfaceTheme,
} from "../src/lib/app-customization";
import { INTERFACE_DEFINITIONS, applyInterfaceDefinition } from "../src/lib/interface-themes";
import { vi } from "vitest";

/**
 * THE FONT CONTRACT.
 *
 * Two bugs are pinned here:
 *   1. "Rubik Glitch" was listed as a choice nowhere and its files were never
 *      downloaded — a name in a list is not a font.
 *   2. Interface styles applied their own typeface, so the Settings choice
 *      visibly changed only some screens. The app now has ONE font variable,
 *      published from the selected option, that every element reads.
 */

const root = path.resolve(__dirname, "..");
const css = readFileSync(path.join(root, "src/styles.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("Rubik Glitch", () => {
  it("is a selectable font under its exact name", () => {
    const option = FONT_OPTIONS.find((entry) => entry.id === "Rubik Glitch");
    expect(option, "Rubik Glitch must be in the Settings font list").toBeDefined();
    expect(option?.name).toBe("Rubik Glitch");
  });

  it("is actually downloaded, with font-display: swap so text never flashes", () => {
    const importLine = css.split("\n").find((line) => line.includes("fonts.googleapis.com"));
    expect(importLine).toBeDefined();
    expect(importLine).toContain("family=Rubik+Glitch");
    expect(importLine).toContain("display=swap");
  });

  it("has a stack that names the family first", () => {
    expect(fontStack("Rubik Glitch").startsWith("'Rubik Glitch'")).toBe(true);
  });
});

describe("one app font, every interface style", () => {
  it("declares the token and applies it to every element", () => {
    expect(css).toContain("--app-font:");
    // The unlayered, !important rule is what beats a Tailwind font utility, an
    // interface rule and an inline style.
    expect(css).toMatch(/body,\s*\nbody \*\s*\{[^}]*font-family: var\(--app-font\) !important/);
  });

  it("keeps exactly one documented exception: the picker's own samples", () => {
    expect(css).toContain("[data-font-sample]");
    expect(css).toContain("font-family: var(--font-sample, var(--app-font)) !important");
  });

  it("publishes the chosen font to <html> immediately", () => {
    applyFontStack("Rubik Glitch");
    expect(document.documentElement.style.getPropertyValue(APP_FONT_VAR)).toContain("'Rubik Glitch'");
    expect(document.documentElement.getAttribute("data-app-font")).toBe("Rubik Glitch");
  });

  it("no interface definition brings a typeface of its own", () => {
    for (const [id, definition] of Object.entries(INTERFACE_DEFINITIONS)) {
      expect(definition.numbers.font, `${id} must follow the user's font`).toBe("inherit");
    }
  });

  it("switching interface styles never touches the chosen font", () => {
    window.localStorage.clear();
    setFontOption("Rubik Glitch");

    for (const id of Object.keys(INTERFACE_DEFINITIONS)) {
      setInterfaceTheme(id as Parameters<typeof setInterfaceTheme>[0]);
      // The style is persisted…
      expect(window.localStorage.getItem("ea_migrate_theme")).toBe(id);
      // …and the font preference is exactly as the user left it.
      expect(window.localStorage.getItem("ea_migrate_font")).toBe("Rubik Glitch");
      expect(getCustomization().font).toBe("Rubik Glitch");
    }

    // Back to a legacy layout: still untouched.
    setInterfaceTheme("NOVA CORE");
    expect(getCustomization().font).toBe("Rubik Glitch");
  });

  it("applies the font on top of every interface definition's tokens", () => {
    for (const definition of Object.values(INTERFACE_DEFINITIONS)) {
      applyFontStack("Rubik Glitch");
      applyInterfaceDefinition(definition);
      expect(document.documentElement.style.getPropertyValue(APP_FONT_VAR)).toContain("'Rubik Glitch'");
      // No definition publishes a typeface token either.
      expect(document.documentElement.style.getPropertyValue("--if-number-font")).toBe("inherit");
    }
  });

  it("survives a restart (the preference is re-read from storage)", async () => {
    window.localStorage.clear();
    setFontOption("Rubik Glitch");
    setInterfaceTheme("DARKWEB AI");

    // A fresh module graph is what a relaunched app gets.
    vi.resetModules();
    const fresh = await import("../src/lib/app-customization");
    expect(fresh.getCustomization().font).toBe("Rubik Glitch");
    expect(fresh.getCustomization().theme).toBe("DARKWEB AI");
  });

  it("no theme definition declares a font family at all", () => {
    const themes = readFileSync(path.join(root, "src/lib/interface-themes.ts"), "utf8");
    expect(themes).not.toMatch(/fontFamily|font-family/);
    // No `html[data-interface=…]` block in the stylesheet sets a typeface.
    for (const block of css.split("html[data-interface=").slice(1)) {
      const body = block.slice(0, block.indexOf("}"));
      expect(body).not.toContain("font-family");
    }
  });

  it("no component hardcodes a font family", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/fontFamily:\s*([^,\n}]+)/g)) {
        const value = match[1]!.trim();
        // The user's own stack (fontStack) or the CSS token are the only
        // acceptable sources of a font family.
        if (value.startsWith("fontStack(") || value.includes("var(--app-font")) continue;
        offenders.push(`${path.relative(root, file)} → ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
