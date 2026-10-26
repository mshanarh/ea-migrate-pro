import { Square, LineChart, BarChart3, DollarSign, Pause, Play, Plus, Trash2 } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { RobotMedia } from "@/components/app/RobotMedia";

type SignatureLayoutProps = {
  robot: Robot | undefined;
  accent: string;
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
  onPlayVideo?: () => void | undefined;
};

function PoweredBadge({ accent }: { accent: string }) {
  return (
    <div
      className="inline-flex min-h-12 items-center justify-center rounded-full border-2 bg-black/80 px-6 text-sm font-black text-white"
      style={{ borderColor: accent, boxShadow: `0 0 24px ${accent}80` }}
    >
      Powered By&nbsp;<span style={{ color: accent }}>EA Migrate</span>
    </div>
  );
}

function RobotPortrait({ robot, accent }: { robot: Robot | undefined; accent: string }) {
  return (
    <div
      className="app-portrait overflow-hidden rounded-full border-[5px] bg-black"
      style={{ borderColor: accent, boxShadow: `0 0 34px ${accent}55` }}
    >
      <RobotMedia
        image={robot?.image || "/logo.png"}
        video={robot?.video}
        variant="avatar"
        preferImage
        className="size-full rounded-full object-cover"
      />
    </div>
  );
}

function RobotHeading({ robot, accent }: { robot: Robot | undefined; accent: string }) {
  return (
    <div className="text-center">
      {/* Contrast lives on the TEXT (shadow), never as a layer over the picture. */}
      <p className="text-xl font-bold text-white/65" style={{ textShadow: "0 2px 10px rgba(0,0,0,.85)" }}>
        You&apos;re Trading With
      </p>
      <h1
        className="mx-auto mt-2 max-w-[22rem] break-words text-3xl font-black uppercase leading-[0.98] text-white sm:text-4xl"
        style={{ textShadow: "0 2px 0 rgba(255,255,255,.18)" }}
      >
        {robot?.name ?? "YOUR ROBOT"}
      </h1>
    </div>
  );
}

function RoundAction({
  label,
  icon: Icon,
  onClick,
  primary = false,
  accent,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  primary?: boolean;
  accent: string;
}) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-white">
      <span
        className={`flex items-center justify-center rounded-full bg-black transition-transform active:scale-95 ${primary ? "size-24" : "size-14"}`}
        style={{ border: `2px solid ${accent}`, boxShadow: `0 0 ${primary ? 28 : 18}px ${accent}80` }}
      >
        <Icon className={primary ? "size-10" : "size-7"} fill={primary && Icon === Play ? "currentColor" : "none"} style={{ color: primary ? accent : "white" }} />
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.12em] sm:text-xs">{label}</span>
    </button>
  );
}

function WideRobotCard({ robot, accent, image, crop = "50% 35%" }: { robot: Robot | undefined; accent: string; image?: string; crop?: string }) {
  return (
    <div
      className="relative h-20 overflow-hidden rounded-full border-2 bg-black"
      style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}66` }}
    >
      <img
        src={image ?? robot?.image ?? "/logo.png"}
        alt=""
        className="absolute inset-0 size-full object-cover opacity-85"
        style={{ objectPosition: crop }}
      />
      <div className="absolute inset-0 bg-black/25" />
      <span className="absolute inset-0 flex items-center justify-center px-10 text-center text-lg font-black uppercase tracking-wide" style={{ color: accent, textShadow: "0 2px 8px black" }}>
        {robot?.name ?? "YOUR ROBOT"}
      </span>
    </div>
  );
}

/** Sniper matches the connected-robot dashboard reference. */
export function Sniper({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd, onPlayVideo }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const image = robot?.image || "/logo.png";
  const showVideoButton = Boolean(robot?.video);
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] overflow-hidden px-4 pb-6 pt-4 text-white sm:px-5 sm:pt-6">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-4 sm:gap-6">
        <RobotPortrait robot={robot} accent={accent} />
        <RobotHeading robot={robot} accent={accent} />
        <PoweredBadge accent={accent} />

        <div
          className="grid w-full items-center rounded-[48px] border-2 bg-black/90 px-3 py-4"
          style={{
            gridTemplateColumns: showVideoButton ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
            borderColor: accent,
            boxShadow: `0 0 30px ${accent}70`,
          }}
        >
          <RoundAction label="Delete" icon={Trash2} onClick={onRemove} accent={accent} />
          {showVideoButton && (
            <RoundAction label="Video" icon={Play} onClick={onPlayVideo ?? (() => {})} accent={accent} />
          )}
          <RoundAction label={running ? "Stop" : "Start"} icon={running ? Pause : Play} onClick={onStart} primary accent={accent} />
          <RoundAction label="Symbols" icon={BarChart3} onClick={onQuotes} accent={accent} />
        </div>

        <section className="w-full pt-1">
          <h2 className="mb-4 text-xl font-bold text-white/65" style={{ textShadow: "0 2px 10px rgba(0,0,0,.85)" }}>Connected Robots:</h2>
          <div
            className="flex min-h-20 items-center gap-4 rounded-full border-2 bg-black px-6"
            style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}66` }}
          >
            <div className="size-14 shrink-0 overflow-hidden rounded-full border-2" style={{ borderColor: accent }}>
              <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full object-cover" />
            </div>
            <span className="min-w-0 break-words text-lg font-black uppercase">{robot?.name ?? "YOUR ROBOT"}</span>
          </div>
          <button
            type="button"
            onClick={onOpenAdd}
            className="mt-4 flex min-h-20 w-full items-center justify-center gap-5 rounded-full border-2 bg-black text-lg font-black text-white transition-transform active:scale-[0.98]"
            style={{ borderColor: accent, boxShadow: `0 0 24px ${accent}70` }}
          >
            <span className="flex size-12 items-center justify-center rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 22px ${accent}` }}>
              <Plus className="size-7 text-black" strokeWidth={3} />
            </span>
            Add License Key
          </button>
        </section>
      </div>
    </div>
  );
}

/** Phoenix matches the split-control robot-list dashboard reference. */
export function Phoenix({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd, onPlayVideo }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const image = robot?.image || "/logo.png";
  const showVideoButton = Boolean(robot?.video);
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] overflow-hidden px-4 pb-6 pt-4 text-white sm:pt-6">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-4 sm:gap-6">
        <RobotPortrait robot={robot} accent={accent} />
        <RobotHeading robot={robot} accent={accent} />
        <PoweredBadge accent={accent} />

        <div
          className="relative flex min-h-24 w-full items-center justify-between rounded-full border-2 bg-black/80 px-5 sm:px-8"
          style={{ borderColor: accent, boxShadow: `0 0 30px ${accent}70` }}
        >
          <button type="button" onClick={onRemove} className="flex w-16 flex-col items-center gap-1 text-xs font-black sm:w-auto sm:flex-row sm:gap-2 sm:text-base" style={{ color: accent }}>
            <Trash2 className="size-6" fill="currentColor" /> Remove
          </button>
          {showVideoButton && (
            <button type="button" onClick={onPlayVideo ?? (() => {})} className="flex w-16 flex-col items-center gap-1 text-xs font-black sm:w-auto sm:flex-row sm:gap-2 sm:text-base" style={{ color: accent }}>
              <Play className="size-6" fill="currentColor" /> Video
            </button>
          )}
          <button type="button" onClick={onQuotes} className="flex w-16 flex-col items-center gap-1 text-xs font-black sm:w-auto sm:flex-row sm:gap-2 sm:text-base" style={{ color: accent }}>
            <DollarSign className="size-6" strokeWidth={3} /> Quotes
          </button>
          <button
            type="button"
            onClick={onStart}
            aria-label={running ? "Stop robot" : "Start robot"}
            className="absolute left-1/2 top-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border-[5px] bg-black transition-transform active:scale-95"
            style={{ borderColor: accent, boxShadow: `0 0 28px ${accent}` }}
          >
            {running ? <Pause className="size-11" fill="currentColor" style={{ color: accent }} /> : <Play className="size-11" fill="currentColor" style={{ color: accent }} />}
            <span className="text-xs font-black" style={{ color: accent }}>{running ? "Stop" : "Start"}</span>
          </button>
        </div>

        <section className="w-full pt-2">
          <h2 className="mb-3 text-xl font-black" style={{ textShadow: "0 2px 12px rgba(0,0,0,.85)" }}>Robots List:</h2>
          <div className="space-y-3">
            <WideRobotCard robot={robot} accent={accent} image={image} crop="50% 18%" />
            <WideRobotCard robot={robot} accent={accent} image={image} crop="50% 46%" />
            <WideRobotCard robot={robot} accent={accent} image={image} crop="50% 78%" />
          </div>
        </section>
      </div>
    </div>
  );
}
/** Vortex 1 — glowing accent card with the live robot portrait, name and controls. */
export function Vortex({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd, onPlayVideo }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const showVideoButton = Boolean(robot?.video);
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] px-4 pb-6 pt-4 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <div
          className="relative flex flex-col items-center rounded-[40px] px-5 pb-7 pt-7"
          style={{ background: `linear-gradient(160deg, ${accent}e6 0%, ${accent}99 45%, rgba(0,0,0,0.75) 100%)`, boxShadow: `0 0 40px ${accent}aa` }}
        >
          <span className="absolute right-6 top-6 size-3.5 rounded-full" style={{ backgroundColor: running ? "#22C55E" : "#FF1744", boxShadow: `0 0 10px ${running ? "#22C55E" : "#FF1744"}` }} />
          <div className="size-32 overflow-hidden rounded-full border-4 border-white/85 bg-black shadow-2xl sm:size-36">
            <RobotMedia image={robot?.image || "/logo.png"} video={robot?.video} variant="avatar" preferImage className="size-full object-cover" />
          </div>
          <h1 className="mt-6 max-w-full break-words text-center text-2xl font-black uppercase leading-none sm:text-3xl" style={{ textShadow: "0 2px 6px rgba(0,0,0,.6)" }}>
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <div className="mt-6 grid w-full" style={{ gridTemplateColumns: showVideoButton ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)' }}>
            {showVideoButton && (
              <button key="video" type="button" onClick={onPlayVideo ?? (() => {})} className="flex flex-col items-center gap-2 transition-transform active:scale-95">
                <Play className="size-8" fill="currentColor" />
                <span className="text-sm font-black uppercase tracking-[0.14em]">Video</span>
              </button>
            )}
            {[
              { label: running ? "Stop" : "Start", icon: running ? Pause : Square, onClick: onStart },
              { label: "Quotes", icon: LineChart, onClick: onQuotes },
              { label: "Remove", icon: Trash2, onClick: onRemove },
            ].map(({ label, icon: Icon, onClick }) => (
              <button key={label} type="button" onClick={onClick} className="flex flex-col items-center gap-2 transition-transform active:scale-95">
                <Icon className="size-8" fill={Icon === Pause || Icon === Trash2 ? "currentColor" : "none"} />
                <span className="text-sm font-black uppercase tracking-[0.14em]">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenAdd}
          className="flex min-h-20 items-center gap-5 rounded-full px-7 text-left transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55)`, boxShadow: `0 0 30px ${accent}88` }}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-white/25"><Plus className="size-6" strokeWidth={3} /></span>
          <span className="flex flex-col">
            <span className="text-2xl font-black uppercase">Add Robot</span>
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/85">Host Robot Key</span>
          </span>
        </button>
      </div>
    </div>
  );
}
