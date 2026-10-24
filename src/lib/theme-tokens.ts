/**
 * THE INTERFACE COLOUR TOKENS — one accent in, every themed CSS variable out.
 *
 * Screens derive their colours from `useCustomization()` (inline accent), but a
 * whole layer of the UI is themed through CSS custom properties instead
 * (`bg-primary`, `text-primary`, `--chart-*`, `--glow`, `--gradient-brand`).
 * Writing only the inline accent left those frozen, which is why a colour
 * cycle looked like it changed "just a few colours".
 *
 * `applyAccentTokens` publishes the complete set at the document root, so the
 * root component (`AccentVarSync` in ColourCycleTap.tsx) can drive every
 * themed surface — buttons, highlights, borders, glows, text accents, active
 * nav item, chart accents, progress bars, popup borders — from ONE value that
 * follows both the selected theme and the tap-to-cycle effect.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => char + char)
          .join("")
      : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return [0, 168, 255];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mix a hex towards black — the "deep" companion stop for gradients. */
export function shadeHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel * (1 - amount));
  return `#${((1 << 24) | (mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).slice(1)}`;
}

/** Every colour token the interface is themed with. */
export function applyAccentTokens(accent: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(accent);
  const deep = shadeHex(accent, 0.35);

  // Core shadcn tokens: primary/accent surfaces, focus rings, sidebar.
  root.style.setProperty("--primary", accent);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--ring", accent);
  root.style.setProperty("--sidebar-primary", accent);
  root.style.setProperty("--sidebar-accent-foreground", accent);
  root.style.setProperty("--sidebar-ring", accent);

  // Chart accents and progress bars.
  for (let index = 1; index <= 5; index += 1) {
    root.style.setProperty(`--chart-${index}`, accent);
  }

  // Glows, highlights and brand gradients.
  root.style.setProperty("--glow", `0 0 40px rgb(${r} ${g} ${b} / 0.35)`);
  root.style.setProperty("--glow-soft", `0 0 24px rgb(${r} ${g} ${b} / 0.2)`);
  root.style.setProperty("--gradient-brand", `linear-gradient(100deg, ${accent}, ${deep})`);
  root.style.setProperty("--accent-deep", deep);
  root.style.setProperty("--accent-soft", `${accent}59`);
  document.body.style.setProperty("--eamp-glow", `rgb(${r} ${g} ${b} / 0.3)`);
}

/**
 * UNDO THE APP ACCENT — used when the document becomes the mentor portal.
 *
 * Removing the inline properties (rather than writing defaults over them) lets
 * the stylesheet's own :root values apply again, so the portal is painted by
 * its own tokens and cannot inherit a colour the user picked in the app.
 */
export function clearAccentTokens(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of [
    "--primary",
    "--accent",
    "--ring",
    "--sidebar-primary",
    "--sidebar-accent-foreground",
    "--sidebar-ring",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--glow",
    "--glow-soft",
    "--gradient-brand",
    "--accent-deep",
    "--accent-soft",
  ]) {
    root.style.removeProperty(name);
  }
  document.body.style.removeProperty("--eamp-glow");
}
