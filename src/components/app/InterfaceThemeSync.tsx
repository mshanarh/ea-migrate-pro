import { useEffect } from "react";
import { applyFontStack, useCustomization } from "@/lib/app-customization";
import {
  applyAppearanceMode,
  applyInterfaceDefinition,
  interfaceDefinitionFor,
} from "@/lib/interface-themes";

/**
 * Publishes the selected Main Interface definition to <html> — colours,
 * surfaces, radii, borders, shadows, header + number treatment, texture and
 * the nav chrome. It subscribes to the same store Settings writes, so a
 * selection repaints the whole app in the next frame (no reload), and the
 * persisted choice is re-applied on every mount.
 *
 * Legacy layouts (NOVA CORE, SNIPPER, PHOENIX, …) resolve to null, which puts
 * the tokens back to neutral and leaves their bespoke styling alone.
 *
 * The APPEARANCE MODE is published after the definition and is always the
 * OBSIDIAN palette: the definition (or the neutral defaults) supplies the
 * deep black surfaces and white ink, and `applyAppearanceMode` only stamps
 * `data-appearance="black"` + `color-scheme: dark`. Light surfaces are
 * retired, so no screen can be repainted pale behind white text.
 *
 * It renders NOTHING. The temporary debug badge that used to sit at the bottom
 * left ("NOVA CORE · #…") is gone: it was a testing aid, it floated over the
 * public landing page as well, and it is not part of the design.
 */
export function InterfaceThemeSync() {
  const { theme, font, appearanceMode } = useCustomization();
  const definition = interfaceDefinitionFor(theme);

  // THE INTERFACE GOES ON FIRST, THEN THE APPEARANCE, THEN THE FONT — ALWAYS.
  //
  // One effect, in this order, so the user's face is applied ON TOP of whatever
  // tokens the style publishes: switching CRIMSON NAVIGATOR → ULTRON MEGA can
  // repaint colours, radii and nav, but cannot reset the font. `font` is a
  // separate preference (ea_migrate_font) written only by the font picker, so
  // this effect re-publishes the SAME face when only the style changed.
  //
  // Appearance sits in the middle because a styled definition publishes DARK
  // surfaces: light mode has to overwrite them after they land, and a mode
  // switch has to re-apply the definition's tokens before the light ones.
  useEffect(() => {
    applyInterfaceDefinition(definition);
    applyAppearanceMode(appearanceMode);
    applyFontStack(font);
  }, [definition, appearanceMode, font]);

  return null;
}
