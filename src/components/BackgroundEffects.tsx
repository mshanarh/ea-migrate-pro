import { useMemo, type CSSProperties } from "react";
import type { AppSettings } from "@/lib/app-store";

export const BACKGROUND_EFFECTS = [
  "Falling Dollars", "Matrix Code", "Candle Charts", "Starfield", "Neon Grid", "Ticker Wave", "Particles", "Snow", "Embers", "Pulse Rings", "Bubbles", "Fireflies", "Rain", "Lightning", "Constellations", "Hex Grid", "Binary Rain", "Currency Mix", "Circuit Board", "Glow Orbs", "Lava Lamp", "Smoke", "Confetti", "Trade Arrows", "Heartbeat", "Spiral Vortex", "Fractal Tree", "Ripples", "Static Noise", "Barcode Stream", "Fire", "Pip Drops", "Bulls vs Bears", "Trend Lines", "Order Book", "Volume Histogram", "Fibonacci Arcs", "Ticker Tape", "Profit / Loss", "Zigzag Chart", "P&L Grid",
] as const;

export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

const previews: Record<BackgroundEffect, string> = Object.fromEntries(
  BACKGROUND_EFFECTS.map((effect, index) => [effect, `effect-preview effect-preview-${index % 8}`]),
) as Record<BackgroundEffect, string>;

export function BackgroundEffectCard({ effect, selected, onSelect }: { effect: BackgroundEffect; selected: boolean; onSelect: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect} className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 ${selected ? "border-primary bg-primary/10 shadow-glow" : "border-border/60 bg-card/70 hover:border-primary/50"}`}>
    <span className={`relative block h-20 overflow-hidden rounded-xl border border-white/10 ${previews[effect]}`}><span className="effect-preview-lines" /><span className="effect-preview-particles" /></span>
    <span className={`mt-3 block text-sm font-bold ${selected ? "text-primary" : "text-foreground"}`}>{effect}</span>
    {selected && <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><span className="text-xs font-black">✓</span></span>}
  </button>;
}

function tokenList(effect: BackgroundEffect) {
  const tokens: Record<string, string[]> = {
    "Falling Dollars": ["$", "€", "£", "¥"], "Matrix Code": ["01", "10", "AI", "FX"], "Binary Rain": ["0", "1"], "Currency Mix": ["$", "€", "£", "¥", "₿"], "Trade Arrows": ["↗", "↘", "BUY", "SELL"], "Pip Drops": ["+12", "-4", "+8", "-2"], "Bulls vs Bears": ["▲", "▼"], "Profit / Loss": ["+$", "-$"], "Ticker Tape": ["EURUSD", "XAUUSD", "BTCUSD"], "Barcode Stream": ["|||", "||", "||||"],
  };
  return tokens[effect] || ["·", "+", "×", "•"];
}

export function BackgroundEffectsLayer({ settings, accent }: { settings: AppSettings; accent?: string }) {
  const effect = BACKGROUND_EFFECTS.includes(settings.background as BackgroundEffect) ? settings.background as BackgroundEffect : "Neon Grid";
  const tokens = useMemo(() => tokenList(effect), [effect]);
  if (!settings.backgroundEnabled || settings.background === "None") return null;
  return <div aria-hidden="true" className={`app-background-layer background-${effect.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}>
    <div className="background-vignette" />
    {Array.from({ length: effect === "Starfield" || effect === "Particles" ? 34 : 18 }, (_, index) => <span key={index} className="background-particle" style={{ "--i": index, "--delay": `${index * -0.55}s`, "--token": JSON.stringify(tokens[index % tokens.length]), "--accent": accent || "#1683F7" } as CSSProperties}>{tokens[index % tokens.length]}</span>)}
    <span className="background-orbit background-orbit-one" /><span className="background-orbit background-orbit-two" /><span className="background-chart-line" />
  </div>;
}
