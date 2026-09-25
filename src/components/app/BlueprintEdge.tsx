import { motion } from "framer-motion";
import { Bot, Pause, Play, Plus, Trash2, DollarSign } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { ACCENT_COLORS, useCustomization } from "@/lib/app-customization";
import { RobotMedia } from "@/components/app/RobotMedia";

/**
 * BLUEPRINT EDGE — robot console theme, built exactly like the reference
 * screenshot: white circle hero, "Your Trading With" headline, Powered By pill,
 * white control bar (Remove / Start / Quotes) and a "Robots List:" section of
 * full-width picture banner rows — the uploaded EA picture is shown across the
 * whole pill, never squeezed into a tiny cropped thumbnail.
 *
 * Colors stay default (the signature blue / user accent) and the badge stays
 * "Powered By EA MIGRATE" regardless of what the old mockups said.
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
  onQuotes: () => void;
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
      <span className="font-sans text-[12px] font-bold tracking-[0.02em] text-black/80">{label}</span>
    </button>
  );
}

export function BlueprintEdge({ robot, robots, onStart, onQuotes, onRemove, onOpenAdd, onSelectRobot }: BlueprintEdgeProps) {
  const { color } = useCustomization();
  const accent = resolveBlueprintAccent(color);
  const eaName = robot?.name ?? "YOUR ROBOT";
  const eaImage = robot?.image || "/logo.png";

  return (
    <div className="flex flex-col gap-5">
      {/* TOP — circle hero, picture shown big and round like the mockup */}
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center rounded-[28px] px-4 pb-2 pt-1"
      >
        <h2 className="max-w-full truncate px-2 text-center text-sm font-bold" style={{ color: accent, fontFamily: "'Montserrat', sans-serif" }}>
          {eaName}
        </h2>

        <span
          className="mt-4 flex size-52 items-center justify-center overflow-hidden rounded-full border-[5px] bg-white p-2"
          style={{ borderColor: accent, boxShadow: `0 0 42px ${accent}, 0 0 90px ${accent}66` }}
        >
          <RobotMedia image={eaImage} video={robot?.video} variant="avatar" preferImage className="size-full rounded-full object-cover" />
        </span>

        <p className="mt-5 font-sans text-base font-medium text-white">Your Trading With</p>
        <h1
          className="mx-auto mt-1 max-w-full break-words px-2 text-center text-[34px] font-black leading-tight tracking-wide text-white uppercase"
          style={{ fontFamily: "'Montserrat', sans-serif", textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
        >
          {eaName}
        </h1>

        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border bg-black/85 px-7 py-2.5 text-sm font-bold text-white" style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}40` }}>
          Powered By <span style={{ color: accent }}>EA MIGRATE</span>
        </span>
      </motion.section>

      {/* MIDDLE CONTROL BAR — white pill: Remove / Start / Quotes */}
      <div className="mx-auto flex w-[95%] items-center justify-around rounded-[40px] bg-white px-3 py-4" style={{ boxShadow: `0 10px 34px ${accent}40` }}>
        <ControlButton label="Remove" icon={Trash2} onClick={onRemove} accent={accent} />
        <ControlButton label={robot?.running ? "Stop" : "Start"} icon={robot?.running ? Pause : Play} onClick={onStart} accent={accent} />
        <ControlButton label="Quotes" icon={DollarSign} onClick={onQuotes} accent={accent} />
      </div>

      {/* ROBOTS LIST — full-width picture banners, the picture is never cut down */}
      <section>
        <p className="font-sans text-lg font-bold text-white">Robots List:</p>

        <div className="mt-3 space-y-3">
          {robots.map((candidate) => {
            const selected = candidate.id === robot?.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelectRobot(candidate.id)}
                className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-full transition-transform active:scale-[0.99]"
                style={{
                  border: `2px solid ${accent}`,
                  boxShadow: selected ? `0 0 30px ${accent}99` : `0 0 14px ${accent}33`,
                }}
              >
                {candidate.image ? (
                  <img src={candidate.image} alt="" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <span className="absolute inset-0" style={{ backgroundColor: accent }} />
                )}
                {/* Dark scrim so the name overlay reads on any picture */}
                <span className="absolute inset-0 bg-black/35" />
                {selected && (
                  <span
                    className="relative px-4 text-center text-base font-black uppercase tracking-wide"
                    style={{ color: accent, textShadow: `0 0 14px ${accent}, 0 2px 10px rgba(0,0,0,0.9)`, fontFamily: "'Montserrat', sans-serif" }}
                  >
                    {candidate.name}
                  </span>
                )}
              </button>
            );
          })}

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

          {/* Fallback when the list is empty apart from the add button */}
          {robots.length === 0 && (
            <p className="px-2 text-center font-sans text-xs text-white/40">
              <Bot className="mr-1 inline size-4" /> Activate a license key to see your robots here.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
