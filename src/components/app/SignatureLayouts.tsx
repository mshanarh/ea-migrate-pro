import { BarChart3, DollarSign, Pause, Play, Plus, Trash2 } from "lucide-react";
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
};

function PoweredBadge({ accent }: { accent: string }) {
  return (
    <div
      className="inline-flex min-h-14 items-center justify-center rounded-full border-2 bg-black/80 px-8 text-base font-black text-white"
      style={{ borderColor: accent, boxShadow: `0 0 24px ${accent}80` }}
    >
      Powered By&nbsp;<span style={{ color: accent }}>EA Migrate</span>
    </div>
  );
}

function RobotPortrait({ robot, accent }: { robot: Robot | undefined; accent: string }) {
  return (
    <div
      className="size-44 overflow-hidden rounded-full border-[5px] bg-black sm:size-48"
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

function RobotHeading({ robot }: { robot: Robot | undefined }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold text-white/65">You&apos;re Trading With</p>
      <h1
        className="mx-auto mt-3 max-w-[22rem] break-words text-4xl font-black uppercase leading-[0.98] text-white sm:text-5xl"
        style={{ fontFamily: "'Teko', 'Arial Black', sans-serif", textShadow: "0 2px 0 rgba(255,255,255,.18)" }}
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

function WideRobotCard({ robot, accent, crop = "50% 35%" }: { robot: Robot | undefined; accent: string; crop?: string }) {
  return (
    <div
      className="relative h-24 overflow-hidden rounded-full border-2 bg-black"
      style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}66` }}
    >
      <img
        src={robot?.image || "/logo.png"}
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
export function Sniper({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd }: SignatureLayoutProps) {
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] overflow-hidden bg-black/70 px-4 pb-10 pt-6 text-white backdrop-blur-[1px] sm:px-5 sm:pt-7">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[38rem]"
        style={{ background: `radial-gradient(ellipse at 50% 20%, ${accent}38 0%, ${accent}13 38%, transparent 72%)` }}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-5 sm:gap-7">
        <RobotPortrait robot={robot} accent={accent} />
        <RobotHeading robot={robot} />
        <PoweredBadge accent={accent} />

        <div
          className="grid w-full grid-cols-3 items-center rounded-[48px] border-2 bg-black/90 px-3 py-4"
          style={{ borderColor: accent, boxShadow: `0 0 30px ${accent}70` }}
        >
          <RoundAction label="Delete" icon={Trash2} onClick={onRemove} accent={accent} />
          <RoundAction label={robot?.running ? "Stop" : "Start"} icon={robot?.running ? Pause : Play} onClick={onStart} primary accent={accent} />
          <RoundAction label="Symbols" icon={BarChart3} onClick={onQuotes} accent={accent} />
        </div>

        <section className="w-full pt-1">
          <h2 className="mb-4 text-xl font-bold text-white/65">Connected Robots:</h2>
          <div
            className="flex min-h-24 items-center gap-4 rounded-full border-2 bg-black px-7"
            style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}66` }}
          >
            <div className="size-14 shrink-0 overflow-hidden rounded-full border-2" style={{ borderColor: accent }}>
              <RobotMedia image={robot?.image || "/logo.png"} video={robot?.video} variant="avatar" preferImage className="size-full object-cover" />
            </div>
            <span className="min-w-0 break-words text-lg font-black uppercase">{robot?.name ?? "YOUR ROBOT"}</span>
          </div>
          <button
            type="button"
            onClick={onOpenAdd}
            className="mt-5 flex min-h-24 w-full items-center justify-center gap-5 rounded-full border-2 bg-black text-xl font-black text-white transition-transform active:scale-[0.98]"
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
export function Phoenix({ robot, accent, onStart, onQuotes, onRemove }: SignatureLayoutProps) {
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] overflow-hidden bg-black/60 px-4 pb-10 pt-6 text-white backdrop-blur-[1px] sm:pt-7">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[43rem]"
        style={{ background: `radial-gradient(ellipse at 50% 24%, ${accent}42 0%, ${accent}12 44%, transparent 75%)` }}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-5 sm:gap-7">
        <RobotPortrait robot={robot} accent={accent} />
        <RobotHeading robot={robot} />
        <PoweredBadge accent={accent} />

        <div
          className="relative flex min-h-28 w-full items-center justify-between rounded-full border-2 bg-black/80 px-5 sm:px-8"
          style={{ borderColor: accent, boxShadow: `0 0 30px ${accent}70` }}
        >
          <button type="button" onClick={onRemove} className="flex w-16 flex-col items-center gap-1 text-xs font-black sm:w-auto sm:flex-row sm:gap-2 sm:text-base" style={{ color: accent }}>
            <Trash2 className="size-6" fill="currentColor" /> Remove
          </button>
          <button type="button" onClick={onQuotes} className="flex w-16 flex-col items-center gap-1 text-xs font-black sm:w-auto sm:flex-row sm:gap-2 sm:text-base" style={{ color: accent }}>
            <DollarSign className="size-6" strokeWidth={3} /> Quotes
          </button>
          <button
            type="button"
            onClick={onStart}
            aria-label={robot?.running ? "Stop robot" : "Start robot"}
            className="absolute left-1/2 top-1/2 flex size-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border-[5px] bg-black transition-transform active:scale-95"
            style={{ borderColor: accent, boxShadow: `0 0 28px ${accent}` }}
          >
            {robot?.running ? <Pause className="size-11" fill="currentColor" style={{ color: accent }} /> : <Play className="size-11" fill="currentColor" style={{ color: accent }} />}
            <span className="text-xs font-black" style={{ color: accent }}>{robot?.running ? "Stop" : "Start"}</span>
          </button>
        </div>

        <section className="w-full pt-3">
          <h2 className="mb-5 text-2xl font-black">Robots List:</h2>
          <div className="space-y-4">
            <WideRobotCard robot={robot} accent={accent} crop="50% 18%" />
            <WideRobotCard robot={robot} accent={accent} crop="50% 46%" />
            <WideRobotCard robot={robot} accent={accent} crop="50% 78%" />
          </div>
        </section>
      </div>
    </div>
  );
}