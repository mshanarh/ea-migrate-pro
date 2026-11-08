import { useEffect, useRef, useState, type CSSProperties } from "react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { isColourCycling } from "@/lib/color-cycle";

/**
 * AMBIENT GLOW — THE SELECTED ACCENT AS LIGHT, NOT PAINT.
 *
 * One fixed, pointer-transparent layer sits behind the app and paints three
 * very soft radial washes built from the accent colour the user picked
 * (Settings → Colour). The light is blended into the dark page (each stop is
 * the accent at 12–18% alpha, dissolving to fully transparent), so it reads as
 * ambient lighting rather than a coloured block, and the empty centre keeps
 * text on top readable.
 *
 * IT IS DRIVEN BY ONE VALUE. Nothing here hardcodes a hue: the accent comes
 * from the same `useCustomization()` the buttons, borders, nav and icons read,
 * so green, blue, purple, red, orange or any custom hex all work by changing
 * that one preference — no per-colour branches anywhere.
 *
 * A COLOUR CHANGE CROSSFADES. Gradients cannot be interpolated, so the previous
 * colour is kept on a second layer that fades out over 900 ms underneath the
 * new one: the whole app appears to ease into the new glow instead of snapping.
 *
 * IT NEVER FIGHTS THE USER'S BACKGROUNDS. The layer is mounted under the app
 * content and carries no background of its own, so the Background Picture and
 * the shared robot video paint over it untouched; screens simply stop painting
 * an opaque fill while it is mounted (body.eamp-ambient-theme in styles.css).
 */

/** `#rrggbb` + a two-digit alpha. Non-hex values fall back to a safe colour. */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : `rgba(0, 229, 255, ${Number.parseInt(alpha, 16) / 255})`;
}

type Blob = {
  key: string;
  size: string;
  top: string;
  left: string;
  /** Two-digit hex alpha of the accent at the centre of the wash. */
  alpha: string;
  animation: string;
};

/**
 * Three overlapping washes. The alphas are low on purpose: light near the
 * screen edges, black in the middle where the trading data lives.
 */
const BLOBS: Blob[] = [
  { key: "top-left", size: "85vmax", top: "-34vmax", left: "-28vmax", alpha: "2e", animation: "ambientDriftA 26s ease-in-out infinite" },
  { key: "bottom-right", size: "75vmax", top: "42vmax", left: "34vmax", alpha: "24", animation: "ambientDriftB 32s ease-in-out infinite" },
  { key: "core", size: "62vmax", top: "16vmax", left: "-8vmax", alpha: "14", animation: "ambientPulse 15s ease-in-out infinite" },
];

function AmbientLayer({ accent, outgoing = false }: { accent: string; outgoing?: boolean }) {
  return (
    <div className={outgoing ? "ambient-glow-layer is-outgoing" : "ambient-glow-layer"}>
      {BLOBS.map((blob) => {
        const style: CSSProperties = {
          width: blob.size,
          height: blob.size,
          top: blob.top,
          left: blob.left,
          background: `radial-gradient(circle at center, ${withAlpha(accent, blob.alpha)} 0%, ${withAlpha(accent, "0f")} 40%, transparent 70%)`,
          animation: blob.animation,
        };
        return <span key={blob.key} className="ambient-glow-blob" style={style} />;
      })}
    </div>
  );
}

export function AmbientGlow() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  // The colour that is fading out, if any. Cleared once the fade is over so no
  // extra layer is left painting.
  const [previous, setPrevious] = useState<string | null>(null);
  const lastRef = useRef(accent);

  useEffect(() => {
    if (lastRef.current === accent) return;
    const outgoing = lastRef.current;
    lastRef.current = accent;
    /**
     * A COLOUR CYCLE STEP IS NOT A CROSSFADE.
     *
     * The tap-to-cycle effect changes the accent every 2s, so keeping a fading
     * outgoing layer under the live one stacked three extra full-screen
     * animated gradients for most of every step — enough compositing work to
     * make the background animation and the video hitch. A step simply swaps
     * the one live layer instead; a one-off colour change still crossfades.
     */
    if (isColourCycling()) {
      setPrevious(null);
      return;
    }
    setPrevious(outgoing);
    const timer = window.setTimeout(() => setPrevious(null), 900);
    return () => window.clearTimeout(timer);
  }, [accent]);

  // Screens stop painting an opaque fill while the ambient layer is mounted, so
  // the light is visible on every screen — the flags for the picture/video
  // layers keep working exactly as before.
  useEffect(() => {
    document.body.classList.add("eamp-ambient-theme");
    return () => document.body.classList.remove("eamp-ambient-theme");
  }, []);

  return (
    <div aria-hidden className="ambient-glow" data-ambient-accent={accent}>
      {previous ? <AmbientLayer accent={previous} outgoing /> : null}
      <AmbientLayer accent={accent} />
    </div>
  );
}

export default AmbientGlow;
