import { motion } from "framer-motion";
import { Play, Plus, ScanLine } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import type { InterfaceDefinition } from "@/lib/interface-themes";
import { heroDecoration } from "@/lib/interface-themes";
import { RobotMedia } from "@/components/app/RobotMedia";

type ActionDef = { label: string; icon: typeof Play; onClick: () => void };
type VideoActionDef = { label: string; icon: typeof Play; onClick: () => void; primary?: boolean; accent?: string };

/**
 * THE STYLED INTERFACE CONSOLE — the Home screen for the eight real Main
 * Interfaces (Crimson Navigator, Navigator Plus, Pablo Crimson, Pablo Elite,
 * Quantum Blue, Darkweb AI, Supreme Equinox, Ultron Mega).
 *
 * The LAYOUT is shared; everything that makes each interface recognisable
 * comes from its definition: the page wash, the card surface/radius/border/
 * shadow, the header and number treatment, the hero decoration (red wave,
 * white circle, gold serif rule, single red hairline, ice glow, studio grid,
 * split accent, steel bevel) and its bottom nav. Content is always the real
 * robot + broker state — no sample data anywhere.
 */
export function InterfaceConsole({
  definition,
  robot,
  accent,
  actions,
  onOpenAdd,
  onPlayVideo,
}: {
  definition: InterfaceDefinition;
  robot: Robot | undefined;
  accent: string;
  actions: ActionDef[];
  onOpenAdd: () => void;
  onPlayVideo?: () => void | undefined;
}) {
  const decoration = heroDecoration(definition);
  const running = robot?.running ?? false;
  const symbols = robot?.symbols ?? [];
  const pairs = robot?.pairs ?? [];

  return (
    <div className="flex flex-col gap-4 px-3 pb-4">
      <motion.section
        layout
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="if-card relative overflow-hidden p-5"
      >
        {/* The interface's own hero decoration. */}
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: decoration.wash }} />
        {definition.decor === "circle" && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: `${definition.signature2}22`, boxShadow: `0 0 60px ${definition.signature2}55` }}
          />
        )}
        {definition.decor === "ice" && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-12 size-44 rounded-full"
            style={{ backgroundColor: `${definition.signature}1f`, boxShadow: `0 0 60px ${definition.signature}55` }}
          />
        )}
        {definition.decor === "split" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1"
            style={{ background: `linear-gradient(180deg, ${definition.signature}, ${definition.signature2})` }}
          />
        )}
        {(definition.decor === "hairline" || definition.decor === "serif") && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-5 top-0 h-px"
            style={{ backgroundColor: definition.decor === "serif" ? definition.signature2 : definition.signature }}
          />
        )}
        {definition.decor === "grid" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 22px)",
            }}
          />
        )}
        {definition.decor === "metal" && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ backgroundColor: "rgba(255,255,255,0.35)" }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
              style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
            />
          </>
        )}

        <div className="relative flex items-center gap-4">
          <span
            className="flex size-20 shrink-0 items-center justify-center overflow-hidden"
            style={{
              borderRadius: definition.decor === "metal" ? "4px" : "999px",
              border: `1px solid ${definition.signature}55`,
              boxShadow:
                definition.decor === "ice" || definition.decor === "circle"
                  ? `0 0 28px ${definition.signature}55`
                  : "none",
            }}
          >
            <RobotMedia
              image={robot?.image || "/logo.png"}
              video={robot?.video}
              variant="avatar"
              className="size-full object-cover"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="if-header if-muted text-[10px] tracking-[0.28em] uppercase">
              {definition.brief}
            </p>
            <h1 className="if-header if-text mt-1 truncate" style={{ fontSize: definition.header.size }}>
              {robot?.name ?? "No robot yet"}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span
                className="if-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-black tracking-[0.12em] uppercase"
                style={{
                  borderColor: running ? `${definition.signature}88` : "rgba(255,255,255,0.18)",
                  color: running ? definition.signature : "rgba(255,255,255,0.55)",
                }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: running ? definition.signature : "rgba(255,255,255,0.35)" }}
                />
                {running ? "Running" : "Idle"}
              </span>
              <span className="if-num if-muted">
                {symbols.length} {symbols.length === 1 ? "symbol" : "symbols"}
              </span>
              <span className="if-num if-muted">·</span>
              <span className="if-num if-muted">
                {pairs.length} {pairs.length === 1 ? "pair" : "pairs"} configured
              </span>
            </p>
          </div>
        </div>

        {robot?.video && onPlayVideo && (
        <button
          type="button"
          onClick={onPlayVideo}
          className="if-control if-card-alt if-text plat-pressable flex flex-col items-center gap-1.5 border py-3"
          style={{ borderColor: `${definition.signature}44` }}
        >
          <Play className="size-5" style={{ color: definition.signature }} strokeWidth={2.3} />
          <span className="if-header text-[10px] tracking-[0.14em]">Play Video</span>
        </button>
      )}
      <div className="relative mt-5 grid grid-cols-3 gap-2">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="if-control if-card-alt if-text plat-pressable flex flex-col items-center gap-1.5 border py-3"
              style={{ borderColor: `${definition.signature}44` }}
            >
              <Icon className="size-5" style={{ color: definition.signature }} strokeWidth={2.3} />
              <span className="if-header text-[10px] tracking-[0.14em]">{label}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <button
        type="button"
        onClick={onOpenAdd}
        className="if-control plat-pressable flex items-center gap-4 border p-4 text-left"
        style={{
          borderColor: `${accent}55`,
          background: `linear-gradient(180deg, ${accent}2e, ${accent}12)`,
        }}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accent}26` }}
        >
          <Plus className="size-6" style={{ color: accent }} strokeWidth={2.6} />
        </span>
        <span className="min-w-0">
          <span className="if-header if-text block text-base">ADD ROBOT</span>
          <span className="if-muted block text-xs">HOST ROBOT KEY</span>
        </span>
        <ScanLine className="ml-auto size-5" style={{ color: `${accent}99` }} />
      </button>

      {!robot && (
        <p className="if-muted px-2 text-center text-xs leading-relaxed">
          No robot is active on this device yet. Add your host robot key to bring your EA here.
        </p>
      )}

      <p className="px-2 text-center text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: `${definition.signature}99` }}>
        Powered by EA Migrate
      </p>
    </div>
  );
}
