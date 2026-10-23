import { useEffect } from "react";
import { useCustomization } from "@/lib/app-customization";
import { applyInterfaceDefinition, interfaceDefinitionFor } from "@/lib/interface-themes";

/**
 * Publishes the selected Main Interface definition to <html> — colours,
 * surfaces, radii, borders, shadows, header + number treatment, texture and
 * the nav chrome. It subscribes to the same store Settings writes, so a
 * selection repaints the whole app in the next frame (no reload), and the
 * persisted choice is re-applied on every mount.
 *
 * Legacy layouts (NOVA CORE, SNIPPER, PHOENIX, …) resolve to null, which puts
 * the tokens back to neutral and leaves their bespoke styling alone.
 */
export function InterfaceThemeSync() {
  const { theme } = useCustomization();

  useEffect(() => {
    applyInterfaceDefinition(interfaceDefinitionFor(theme));
  }, [theme]);

  return null;
}
