/**
 * probe-accent-contrast.ts — the licence screen's label-colour rule, checked
 * against every accent the app offers.
 *
 * WHY
 * ───
 * The activation screen fills its button with the user's accent and has to
 * choose a label colour that stays readable on it. The accent list runs from
 * near-black blues to pure white, so a constant label colour cannot work, and a
 * naive "is this accent light?" threshold gets the mid-tones wrong (copper and
 * algohost amber both read as light but are far more legible with a near-black
 * label). This evaluates the SAME maths the component uses — copied verbatim
 * from `readableOn` in src/routes/app.login.tsx — over the real palette parsed
 * out of src/lib/app-customization.ts, and asserts WCAG contrast of at least
 * 3:1 (the floor for large bold text, which is what the button label is).
 *
 * If the palette gains a new accent, this is the check that says whether the
 * button label is still legible on it.
 *
 *   bun scripts/probe-accent-contrast.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "lib", "app-customization.ts"), "utf8");
const palette = [...source.matchAll(/\{ id: "([^"]+)", name: "[^"]+", value: "(#[0-9A-Fa-f]{3,6})" \}/g)].map(
  (match) => ({ id: match[1] ?? "", value: match[2] ?? "" }),
);

/** The component's rule (src/routes/app.login.tsx → `readableOn`). */
function readableOn(accent: string): string {
  const hex = accent.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  const linear = (slice: string): number | null => {
    const value = Number.parseInt(slice, 16);
    if (!Number.isFinite(value)) return null;
    const ratio = value / 255;
    // The sRGB → linear curve WCAG contrast is defined on.
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(full.slice(0, 2));
  const green = linear(full.slice(2, 4));
  const blue = linear(full.slice(4, 6));
  if (red === null || green === null || blue === null) return "#ffffff";
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const againstBlack = (luminance + 0.05) / 0.05;
  const againstWhite = 1.05 / (luminance + 0.05);
  return againstBlack > againstWhite ? "#05070a" : "#ffffff";
}

function luminance(hex: string): number {
  const full = hex.replace(/^#/, "");
  const linear = (slice: string) => {
    const value = Number.parseInt(slice, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(full.slice(0, 2)) + 0.7152 * linear(full.slice(2, 4)) + 0.0722 * linear(full.slice(4, 6));
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

let failures = 0;
let worst = { ratio: Number.POSITIVE_INFINITY, id: "", label: "" };
console.log(`accents found: ${palette.length}`);
for (const accent of palette) {
  const label = readableOn(accent.value);
  const ratio = contrast(accent.value, label);
  const line = `${accent.id.padEnd(18)} ${accent.value} → ${label}  ${ratio.toFixed(2)}:1`;
  if (ratio < 3) {
    failures++;
    console.log(`FAIL  ${line}`);
  } else if (ratio < 4.5) {
    console.log(`ok*   ${line} (above the 3:1 large-text floor)`);
  }
  if (ratio < worst.ratio) worst = { ratio, id: accent.id, label };
}
console.log(`worst case: ${worst.id} → ${worst.label} at ${worst.ratio.toFixed(2)}:1`);
console.log(failures === 0 ? "\nRESULT: OK" : `\nRESULT: ${failures} accent(s) below 3:1`);
process.exit(failures === 0 ? 0 : 1);
