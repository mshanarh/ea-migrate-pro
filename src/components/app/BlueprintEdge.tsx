import { motion } from "framer-motion";
import { Bot, Play, Plus, Trash2 } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { ACCENT_COLORS, useCustomization } from "@/lib/app-customization";
import { RobotMedia } from "@/components/app/RobotMedia";

/**
 * BLUEPRINT EDGE — robot console theme. Originally blueprint blue, now it fully
 * follows the user's accent color from the swipe drawer like every other theme.
 */

const DEFAULT_BLUE = "#0066FF";

function resolveBlueprintAccent(color: string): string {
  // Any color picked in the drawer applies; unknown/legacy values fall back to the signature blue.
  return ACCENT_COLORS.find((option) => option.id === color)?.value ?? DEFAULT_BLUE;
}

export type BlueprintEdgeProps = {
  robot: Robot | undefined;
  robots: Robot[];
  onStart: () => void;
  onRemove: () => void;
  onOpenSymbols: () => void;
  onOpenAdd: () => void;
  onSelectRobot: (id: string) => void;
};

function ControlButton({ label, icon: Icon, onClick, accent }: { label: string; icon: typeof Play; onClick: () => void; accent: string }) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5">
      <span
        className="flex size-14 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105 group-active:scale-95"
        style={{ backgroundColor: accent, boxShadow: `0 6px 22px ${accent}80` }}
      >
        <Icon className="size-6 text-white" strokeWidth={2.4} />
      </span>
      <span className="font-sans text-[11px] font-bold tracking-[0.08em] text-white">{label}</span>
    </button>
  );
}

export function BlueprintEdge({ robot, robots, onStart, onRemove, onOpenSymbols, onOpenAdd, onSelectRobot }: BlueprintEdgeProps) {
  const { color } = useCustomization();
  const accent = resolveBlueprintAccent(color);
  const eaName = robot?.name ?? "YOUR ROBOT";
  const eaImage = robot?.image || "/botlogic-mascot.png";

  return (
    <div className="flex flex-col gap-5">
      {/* TOP */}
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center rounded-[28px] px-4 pb-2 pt-1"
      >
        <h2 className="text-center text-lg font-bold" style={{ color: accent, fontFamily: "'Montserrat', sans-serif" }}>
          {eaName}
        </h2>

        <span
          className="mt-4 flex size-44 items-center justify-center overflow-hidden rounded-full border-[5px] bg-white p-2"
          style={{ borderColor: accent, boxShadow: `0 0 42px ${accent}, 0 0 90px ${accent}66` }}
        >
          <RobotMedia image={eaImage} video={robot?.video} variant="avatar" className="size-full rounded-full object-cover" />
        </span>

        <p className="mt-4 font-sans text-sm font-medium text-white">Your Trading With</p>
        <h1
          className="mt-1 text-center text-4xl font-black leading-tight tracking-wide text-white uppercase"
          style={{ fontFamily: "'Montserrat', sans-serif", textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
        >
          {eaName}
        </h1>

        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border bg-black/85 px-6 py-2 text-sm font-bold text-white" style={{ borderColor: accent }}>
          Powered By <span style={{ color: accent }}>EA MIGRATE</span>
        </span>
      </motion.section>

      {/* MIDDLE CONTROL BAR */}
      <div className="mx-auto flex w-[95%] items-center justify-around rounded-[40px] bg-white px-3 py-4" style={{ boxShadow: `0 10px 34px ${accent}40` }}>
        <ControlButton label="DELETE" icon={Trash2} onClick={onRemove} accent={accent} />
        <ControlButton label="START" icon={Play} onClick={onStart} accent={accent} />
        <ControlButton label="SYMBOLS" icon={Bot} onClick={onOpenSymbols} accent={accent} />
      </div>

      {/* CONNECTED ROBOTS */}
      <section>
        <p className="font-sans text-lg font-bold text-white">Connected Robots:</p>

        <div className="mt-3 space-y-3">
          {robots.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onSelectRobot(candidate.id)}
              className="flex w-full items-center gap-4 rounded-[50px] px-3 py-2.5 text-left transition-transform active:scale-[0.98]"
              style={{ backgroundColor: accent, boxShadow: candidate.id === robot?.id ? `0 0 26px ${accent}80` : "none" }}
            >
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
                {candidate.image ? (
                  <img src={candidate.image} alt="" className="size-full object-cover" />
                ) : (
                  <Bot className="size-7 text-black" />
                )}
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="size-2 shrink-0 rounded-full bg-white" />
                <span className="truncate font-sans text-base font-bold text-white uppercase">{candidate.name}</span>
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={onOpenAdd}
            className="flex w-full items-center gap-4 rounded-[50px] px-3 py-2.5 text-left transition-transform active:scale-[0.98]"
            style={{ backgroundColor: accent, boxShadow: `0 8px 26px ${accent}59` }}
          >
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white">
              <Plus className="size-8" style={{ color: accent }} strokeWidth={2.6} />
            </span>
            <span className="min-w-0">
              <span className="block font-sans text-sm font-bold tracking-wide text-white">CONNECT YOUR EDGE EA</span>
              <span className="block font-sans text-[11px] font-semibold text-white/85">USE LICENSE KEY</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
