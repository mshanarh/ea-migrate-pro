import { motion } from "framer-motion";
import { ChartLine, Info, Play, Plus, ScanFace, ScanLine, Trash2, Waves } from "lucide-react";
import { accentColorValue, fontStack, useCustomization } from "@/lib/app-customization";
import type { InterfaceThemeId } from "@/lib/app-customization";
import type { Robot } from "@/lib/app-store";

export type ThemeContentProps = {
  robot: Robot | undefined;
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
};

function PoweredBadge({ accent }: { accent: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/85 px-6 py-2.5 text-sm font-bold text-white"
      style={{ boxShadow: `0 0 24px ${accent}33` }}
    >
      Powered by <span style={{ color: accent }}>EA MIGRATE</span>
    </span>
  );
}

type ActionDef = { label: string; icon: typeof Play; onClick: () => void };

function useActions({ onStart, onQuotes, onRemove }: Pick<ThemeContentProps, "onStart" | "onQuotes" | "onRemove">): ActionDef[] {
  return [
    { label: "START", icon: Play, onClick: onStart },
    { label: "QUOTES", icon: Waves, onClick: onQuotes },
    { label: "REMOVE", icon: Trash2, onClick: onRemove },
  ];
}

function EmptyRobot({ accent, onOpenAdd }: { accent: string; onOpenAdd: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpenAdd}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-[32px] border-2 border-dashed p-10 text-center"
      style={{ borderColor: `${accent}66`, backgroundColor: `${accent}0d` }}
    >
      <span className="flex size-16 items-center justify-center rounded-3xl" style={{ backgroundColor: `${accent}26` }}>
        <Plus className="size-8" style={{ color: accent }} />
      </span>
      <span className="text-xl font-black tracking-tight text-white">No robot yet</span>
      <span className="text-sm text-white/55">Add your HOST ROBOT KEY to bring your EA onto this device.</span>
    </motion.button>
  );
}

/* ---------------- NOVA CORE ---------------- */

function NovaCore({ robot, accent, font, actions, onOpenAdd, onOpenScanner }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenAdd: () => void; onOpenScanner: () => void }) {
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-6">
      <motion.section
        layout
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full overflow-hidden rounded-[32px] bg-[#0a0a0a]"
        style={{ boxShadow: `0 0 0 1px ${accent}40, 0 18px 50px ${accent}2e` }}
      >
        <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.22)_36%,rgba(0,0,0,0.88)_78%,rgba(0,0,0,0.96)_100%)]" />
        <div className="relative flex min-h-[430px] flex-col items-center justify-end px-4 pb-8 pt-4">
          <h1
            className="text-center text-3xl font-black tracking-[0.08em] text-white uppercase"
            style={{ fontFamily: fontStack(font), textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-2">
            {actions.map(({ label, icon: Icon, onClick }) => (
              <button key={label} type="button" onClick={onClick} className="group flex flex-col items-center gap-2 py-1">
                <Icon className="size-9 transition-transform duration-200 group-hover:scale-110" style={{ color: accent }} strokeWidth={2.2} />
                <span className="text-xs font-bold tracking-[0.14em]" style={{ color: accent }}>{label}</span>
              </button>
            ))}
          </div>
          <p className="mt-7 text-[11px] font-semibold tracking-[0.3em] text-white/45 uppercase">Powered by EA Migrate</p>
        </div>
      </motion.section>

      <button
        type="button"
        onClick={onOpenAdd}
        className="flex h-24 w-full items-center gap-5 rounded-[32px] px-7 text-left transition-transform active:scale-[0.98]"
        style={{ background: `linear-gradient(180deg, ${accent}, ${accent}b3)`, boxShadow: `0 14px 44px ${accent}66` }}
      >
        <Plus className="size-9 shrink-0 text-white" strokeWidth={2.6} />
        <span className="flex flex-col">
          <span className="text-xl font-black tracking-wide text-white">ADD ROBOT</span>
          <span className="text-xs font-semibold tracking-[0.22em] text-white/80">HOST ROBOT KEY</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenScanner}
        className="flex items-center justify-between gap-4 rounded-[28px] border p-5 text-left"
        style={{ borderColor: `${accent}59`, backgroundColor: `${accent}12` }}
      >
        <span className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: accent }}>
            <ScanFace className="size-6 text-black" />
          </span>
          <span>
            <span className="block text-base font-black text-white">AI Scanner</span>
            <span className="block text-sm text-white/55">Snap a chart — get an instant signal</span>
          </span>
        </span>
        <ScanLine className="size-5" style={{ color: accent }} />
      </button>
    </div>
  );
}

/* ---------------- PHANTOM PULSE ---------------- */

function PhantomPulse({ robot, accent, font, actions, onOpenAdd }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenAdd: () => void }) {
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="relative flex min-h-[62vh] flex-col items-center justify-center gap-7 overflow-hidden rounded-[32px] bg-black px-5 py-10">
      <img src={image} alt="" className="absolute inset-0 size-full object-cover opacity-45" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.72)_58%,rgba(0,0,0,0.94)_100%)]" />

      <div className="relative flex flex-col items-center">
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex size-52 items-center justify-center rounded-full border-4 bg-black p-1.5"
          style={{ borderColor: accent, boxShadow: `0 0 46px ${accent}, 0 0 110px ${accent}59` }}
        >
          <img src={image} alt="" className="size-full rounded-full object-cover" />
        </motion.span>

        <p className="mt-7 text-sm font-bold tracking-[0.34em] text-white/60 uppercase">You're trading with</p>
        <h1
          className="mt-2 text-center text-4xl font-black leading-tight tracking-wide text-white uppercase"
          style={{ fontFamily: fontStack(font), textShadow: `0 0 34px ${accent}80` }}
        >
          {robot?.name ?? "YOUR ROBOT"}
        </h1>
      </div>

      <div className="relative mt-1"><PoweredBadge accent={accent} /></div>

      {robot ? (
        <div className="relative grid w-full max-w-sm grid-cols-3 gap-3">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="group flex size-24 flex-col items-center justify-center gap-1.5 rounded-full border-2 bg-black/90 transition-transform active:scale-95"
              style={{ borderColor: accent, boxShadow: `0 0 22px ${accent}40` }}
            >
              <Icon className="size-7" style={{ color: accent }} />
              <span className="text-xs font-bold capitalize" style={{ color: accent }}>{label.toLowerCase()}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenAdd}
          className="relative flex h-16 w-full max-w-sm items-center justify-center gap-3 rounded-full text-base font-black text-white transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(180deg, ${accent}, ${accent}b3)`, boxShadow: `0 12px 40px ${accent}59` }}
        >
          <Plus className="size-6" /> ADD ROBOT
        </button>
      )}
    </div>
  );
}

/* ---------------- TITAN EDGE ---------------- */

function TitanEdge({ robot, accent, font, actions, onOpenScanner }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenScanner: () => void }) {
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-6">
      <motion.section
        layout
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full overflow-hidden rounded-b-[36px] bg-[#0a0a0a]"
      >
        <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.1)_40%,rgba(0,0,0,0.9)_92%)]" />
        <div className="relative flex min-h-[420px] flex-col items-center justify-end pb-9">
          <h1
            className="text-center text-3xl font-black text-white"
            style={{ fontFamily: fontStack(font), textShadow: "0 2px 20px rgba(0,0,0,0.85)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <p className="mt-2 text-sm font-bold tracking-[0.34em] text-white/70 uppercase" style={{ color: accent }}>
            {robot?.running ? "RUNNING" : "AGGRESSIVE"}
          </p>
        </div>
      </motion.section>

      <div
        className="mx-1 flex items-center justify-around rounded-[40px] border py-5"
        style={{ borderColor: `${accent}59`, background: `linear-gradient(180deg, ${accent}14, rgba(0,0,0,0.7))` }}
      >
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5 px-3">
            <Icon className="size-7 transition-transform duration-200 group-hover:scale-110" style={{ color: accent }} />
            <span className="text-[11px] font-black tracking-[0.18em] text-white/85">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center"><PoweredBadge accent={accent} /></div>

      <button
        type="button"
        onClick={onOpenScanner}
        className="flex items-center justify-between gap-4 rounded-[28px] border-2 p-5 text-left"
        style={{ borderColor: accent, backgroundColor: `${accent}0d`, boxShadow: `0 0 28px ${accent}26` }}
      >
        <span className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-black" style={{ border: `2px solid ${accent}` }}>
            <ChartLine className="size-6" style={{ color: accent }} />
          </span>
          <span>
            <span className="block text-base font-black tracking-wide text-white">AI CHART SCANNER</span>
            <span className="block text-sm text-white/55">Upload chart, get AI trade analysis</span>
          </span>
        </span>
        <Info className="size-5 shrink-0" style={{ color: accent }} />
      </button>
    </div>
  );
}

/* ---------------- SWITCH ---------------- */

export function ThemeContent(props: ThemeContentProps) {
  const { theme, color, font } = useCustomization();
  const accent = accentColorValue(color);
  const actions = useActions(props);

  if (!props.robot) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyRobot accent={accent} onOpenAdd={props.onOpenAdd} />
        {theme === "NOVA CORE" && (
          <button
            type="button"
            onClick={props.onOpenAdd}
            className="flex h-24 w-full items-center gap-5 rounded-[32px] px-7 text-left transition-transform active:scale-[0.98]"
            style={{ background: `linear-gradient(180deg, ${accent}, ${accent}b3)`, boxShadow: `0 14px 44px ${accent}66` }}
          >
            <Plus className="size-9 shrink-0 text-white" strokeWidth={2.6} />
            <span className="flex flex-col">
              <span className="text-xl font-black tracking-wide text-white">ADD ROBOT</span>
              <span className="text-xs font-semibold tracking-[0.22em] text-white/80">HOST ROBOT KEY</span>
            </span>
          </button>
        )}
      </div>
    );
  }

  if (theme === "PHANTOM PULSE") {
    return <PhantomPulse {...props} accent={accent} font={font} actions={actions} onOpenAdd={props.onOpenAdd} />;
  }
  if (theme === "TITAN EDGE") {
    return <TitanEdge {...props} accent={accent} font={font} actions={actions} onOpenScanner={props.onOpenScanner} />;
  }
  return <NovaCore {...props} accent={accent} font={font} actions={actions} onOpenAdd={props.onOpenAdd} onOpenScanner={props.onOpenScanner} />;
}
