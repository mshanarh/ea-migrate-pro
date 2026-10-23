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
 *
 * While testing, the small badge below (and the `[interface] ACTIVE = …`
 * console line) shows exactly which definition the real UI is reading.
 */
export function InterfaceThemeSync() {
  const { theme } = useCustomization();
  const definition = interfaceDefinitionFor(theme);

  useEffect(() => {
    applyInterfaceDefinition(definition);
  }, [definition]);

  if (!definition) return null;

  return (
    <div
      data-testid="interface-debug-badge"
      aria-hidden
      className="pointer-events-none fixed left-2 z-[60] rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase"
      style={{
        bottom: "calc(var(--sa-bottom) + 96px)",
        borderColor: `${definition.signature}66`,
        color: definition.signature,
        background: "rgba(0,0,0,0.62)",
      }}
    >
      {definition.name} · {definition.signature}
    </div>
  );
}
