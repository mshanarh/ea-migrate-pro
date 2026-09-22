import { motion } from "framer-motion";
import { Bot, Info, Pause, Play, Plus, ScanLine, Trash2, Waves } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { RobotMedia } from "@/components/app/RobotMedia";
import { PoweredBadge } from "@/components/app/ThemeContent";

/**
 * The five signature interface styles from the mentor's reference pictures.
 * Each one is a full HOME layout with its own chrome, accent treatment and
 * signature font (the font ships with the style via THEME_FONT).
 *
 * Two black-background styles (DARKWEB AI, ULTRON MEGA) render inside a
 * VideoBackdrop so the EA video plays full-screen behind the content; the
 * others play the video in the media circle where the picture sits.
 */

export type SignatureLayoutProps = {
  robot: Robot | undefined;
  accent: string;
  font: string;
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
};

type ActionDef = { label: string; icon: typeof Play; onClick: () => void };

function useActionDefs({ robot, onStart, onQuotes, onRemove }: Pick<SignatureLayoutProps, "robot" | "onStart" | "onQuotes" | "onRemove">): ActionDef[] {
  const running = robot?.running ?? false;
  return [
    { label: running ? "STOP" : "START", icon: running ? Pause : Play, onClick: onStart },
    { label: "QUOTES", icon: Waves, onClick: onQuotes },
    { label: "REMOVE", icon: Trash2, onClick: onRemove },
  ];
}

function AddRobotRow({ accent, onOpenAdd, font }: { accent: string; onOpenAdd: () => void; font: string }) {
  return (
    <button
      type="button"
      onClick={onOpenAdd}
      className="mx-3 mt-3 flex h-24 w-[calc(100%-1.5rem)] items-center gap-5 rounded-[24px] px-7 text-left transition-transform active:scale-[0.98]"
      style={{ background: `linear-gradient(180deg, ${accent}, ${accent}b3)`, boxShadow: `0 14px 44px ${accent}66` }}
    >
      <Plus className="size-9 shrink-0 text-white" strokeWidth={2.6} />
      <span className="flex flex-col">
        <span className="text-xl font-black tracking-wide text-white" style={{ fontFamily: `'${font}', sans-serif` }}>ADD ROBOT</span>
        <span className="text-xs font-semibold tracking-[0.22em] text-white/80">HOST ROBOT KEY</span>
      </span>
    </button>
  );
}

function ScannerRow({ accent, onOpenScanner }: { accent: string; onOpenScanner: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenScanner}
      className="flex items-center justify-between gap-4 rounded-[28px] border-2 p-5 text-left"
      style={{ borderColor: accent, backgroundColor: `${accent}0d`, boxShadow: `0 0 28px ${accent}26` }}
    >
      <span className="flex items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-black" style={{ border: `2px solid ${accent}` }}>
          <ScanLine className="size-6" style={{ color: accent }} />
        </span>
        <span>
          <span className="block text-base font-black tracking-wide text-white">AI CHART SCANNER</span>
          <span className="block text-sm text-white/55">Upload chart, get AI trade analysis</span>
        </span>
      </span>
      <Info className="size-5 shrink-0" style={{ color: accent }} />
    </button>
  );
}

/** The small "signature" status bar shared by the console styles. */
function ConsoleHeader({ label, accent, font, running }: { label: string; accent: string; font: string; running: boolean }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-[11px] font-bold tracking-[0.3em] uppercase" style={{ color: accent, fontFamily: `'${font}', sans-serif` }}>
        {label}
      </span>
      <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black tracking-[0.2em] text-white/70">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: running ? "#22C55E" : accent, boxShadow: `0 0 8px ${running ? "#22C55E" : accent}` }} />
        {running ? "LIVE" : "IDLE"}
      </span>
    </div>
  );
}

/* ---------------- CRIMSON NAVIGATOR — laid-back red console ---------------- */

export function CrimsonNavigator(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-5">
      <ConsoleHeader label="CRIMSON NAVIGATOR" accent={accent} font={font} running={robot?.running ?? false} />
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed relative flex h-[58vh] w-[calc(100%-1.5rem)] flex-col items-center justify-end overflow-hidden rounded-[28px] bg-[#120607] pb-7"
        style={{ boxShadow: `0 0 0 1px ${accent}4d, 0 18px 50px ${accent}33` }}
      >
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-80" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(18,6,7,0.25) 0%, rgba(18,6,7,0.05) 40%, rgba(0,0,0,0.92) 100%)" }} />
        <div className="relative flex flex-col items-center">
          <h1
            className="mx-auto max-w-full break-words px-3 text-center text-2xl font-black uppercase leading-tight text-white sm:text-3xl"
            style={{ fontFamily: `'${font}', sans-serif`, textShadow: "0 2px 18px rgba(0,0,0,0.85)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <p className="mt-1.5 text-[11px] font-bold tracking-[0.34em] uppercase" style={{ color: accent }}>
            {robot?.running ? "RUNNING" : "STANDING BY"}
          </p>
        </div>
      </motion.section>

      <div className="mx-1 flex items-center justify-around rounded-[36px] border py-5" style={{ borderColor: `${accent}59`, background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.75))" }}>
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5 px-3">
            <Icon className="size-7 transition-transform duration-200 group-hover:scale-110" style={{ color: accent }} />
            <span className="text-[11px] font-black tracking-[0.18em] text-white/85">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center"><PoweredBadge accent={accent} /></div>
      <div className="mx-3"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
      <AddRobotRow accent={accent} onOpenAdd={onOpenAdd} font={font} />
    </div>
  );
}

/* ---------------- NAVIGATOR PLUS — white circle on red ---------------- */

export function NavigatorPlus(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="relative flex min-h-[64vh] w-full flex-col items-center justify-center gap-6 overflow-hidden bg-black px-5 py-10">
      <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-30" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 80% 60% at 50% 35%, ${accent}14, transparent 70%)` }} />

      <motion.span
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex size-48 items-center justify-center overflow-hidden rounded-full border-4 bg-white p-2"
        style={{ borderColor: accent, boxShadow: `0 0 40px ${accent}, 0 0 100px ${accent}55` }}
      >
        {/* Circle styles show the picture — video only plays where the picture sits */}
        <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full rounded-full object-cover" />
      </motion.span>

      <h1
        className="relative mx-auto max-w-full break-words px-2 text-center text-3xl font-black uppercase leading-tight text-white sm:text-4xl"
        style={{ fontFamily: `'${font}', sans-serif`, textShadow: `0 0 30px ${accent}66` }}
      >
        {robot?.name ?? "YOUR ROBOT"}
      </h1>

      <div className="relative"><PoweredBadge accent={accent} /></div>

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
              <span className="text-[11px] font-bold tracking-wider" style={{ color: accent }}>{label}</span>
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

/* ---------------- PABLO CRIMSON — tall banner + wide pill buttons ---------------- */

export function PabloCrimson(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-5">
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed relative h-[60vh] w-[calc(100%-1.5rem)] overflow-hidden rounded-[32px] bg-[#160708]"
      >
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.95) 100%)" }} />
        <div className="absolute inset-x-0 top-5 flex justify-center">
          <span className="rounded-full border px-5 py-1.5 text-[10px] font-black tracking-[0.3em] uppercase text-white/85 backdrop-blur-sm" style={{ borderColor: `${accent}88`, backgroundColor: "rgba(0,0,0,0.5)" }}>
            Powered by EA Migrate
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-8">
          <h1
            className="mx-auto max-w-full break-words px-3 text-center text-4xl uppercase leading-none text-white"
            style={{ fontFamily: `'${font}', sans-serif`, letterSpacing: "0.04em", textShadow: "0 3px 24px rgba(0,0,0,0.9)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <p className="mt-2 text-[11px] font-bold tracking-[0.4em] uppercase text-white/60">{robot?.running ? "IN THE MARKET" : "READY"}</p>
        </div>
      </motion.section>

      <div className="space-y-3">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className="flex h-16 w-[calc(100%-1.5rem)] mx-3 items-center justify-between rounded-full px-7 text-left transition-transform active:scale-[0.98]"
            style={{ background: label === "STOP" ? accent : "rgba(255,255,255,0.06)", border: `1px solid ${accent}40` }}
          >
            <span className="text-base font-black uppercase tracking-[0.12em] text-white" style={{ fontFamily: `'${font}', sans-serif` }}>{label}</span>
            <Icon className="size-6" style={{ color: label === "STOP" ? "#fff" : accent }} />
          </button>
        ))}
      </div>

      <div className="mx-3"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
      <AddRobotRow accent={accent} onOpenAdd={onOpenAdd} font={font} />
    </div>
  );
}

/* ---------------- PABLO ELITE — sniper focus ---------------- */

export function PabloElite(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const running = robot?.running ?? false;
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="relative flex min-h-[68vh] w-full flex-col items-center gap-6 overflow-hidden bg-black px-4 pb-8 pt-4">
      {/* Full-screen black backdrop — video playback happens here, never inside the circle */}
      <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-35" />
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(ellipse 85% 60% at 50% 30%, transparent 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.88) 100%)" }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mt-2 flex size-64 items-center justify-center"
      >
        {/* Sniper reticle rings */}
        <span className="absolute inset-0 rounded-full border border-white/10" />
        <span className="absolute inset-4 rounded-full border border-dashed" style={{ borderColor: `${accent}66` }} />
        <span className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 60px ${accent}22, 0 0 60px ${accent}33` }} />
        <span className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2" style={{ backgroundColor: `${accent}aa` }} />
        <span className="absolute bottom-0 left-1/2 h-6 w-px -translate-x-1/2" style={{ backgroundColor: `${accent}aa` }} />
        <span className="absolute left-0 top-1/2 h-px w-6 -translate-y-1/2" style={{ backgroundColor: `${accent}aa` }} />
        <span className="absolute right-0 top-1/2 h-px w-6 -translate-y-1/2" style={{ backgroundColor: `${accent}aa` }} />
        <span className="flex size-44 items-center justify-center overflow-hidden rounded-full border-2 bg-black p-1" style={{ borderColor: accent }}>
          <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full rounded-full object-cover" />
        </span>
        {running && <span className="absolute -right-1 top-6 rounded-full px-3 py-1 text-[9px] font-black tracking-[0.2em] text-black" style={{ backgroundColor: accent }}>LIVE</span>}
      </motion.div>

      <h1
        className="mx-auto max-w-full break-words text-center text-4xl uppercase leading-none text-white"
        style={{ fontFamily: `'${font}', sans-serif`, letterSpacing: "0.05em", textShadow: `0 0 26px ${accent}55` }}
      >
        {robot?.name ?? "YOUR ROBOT"}
      </h1>

      <div className="flex w-full max-w-sm items-center justify-around rounded-[32px] border bg-white/[0.04] py-4" style={{ borderColor: `${accent}33` }}>
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 px-3">
            <Icon className="size-6" style={{ color: accent }} />
            <span className="text-[10px] font-black tracking-[0.22em] text-white/80">{label}</span>
          </button>
        ))}
      </div>

      <div className="w-full max-w-sm"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
      <AddRobotRow accent={accent} onOpenAdd={onOpenAdd} font={font} />
    </div>
  );
}

/* ---------------- QUANTUM BLUE — circle hero + READY media card ---------------- */

export function QuantumBlue(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="relative flex min-h-[74vh] w-full flex-col items-center gap-6 overflow-hidden bg-black px-5 pb-8 pt-6">
      {/* Full-bleed media wash behind everything, tinted by the accent */}
      <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-45" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 90% 55% at 50% 30%, ${accent}26, transparent 65%), linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.88) 75%)` }} />

      {/* Hero circle — picture shown big and round, never cropped by a card */}
      <motion.span
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex size-56 items-center justify-center rounded-full border-4 bg-black p-1.5"
        style={{ borderColor: accent, boxShadow: `0 0 50px ${accent}, 0 0 120px ${accent}55` }}
      >
        <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full rounded-full object-cover" />
      </motion.span>

      <div className="relative flex flex-col items-center">
        <p className="text-sm font-bold tracking-[0.3em] text-white/70 uppercase">You're trading with</p>
        <h1
          className="mx-auto mt-2 max-w-full break-words px-2 text-center text-4xl font-black uppercase leading-tight text-white sm:text-5xl"
          style={{ fontFamily: `'${font}', sans-serif`, textShadow: `0 0 34px ${accent}80, 0 3px 20px rgba(0,0,0,0.9)` }}
        >
          {robot?.name ?? "YOUR ROBOT"}
        </h1>
      </div>

      <div className="relative"><PoweredBadge accent={accent} /></div>

      {robot ? (
        <div className="relative grid w-full max-w-sm grid-cols-3 gap-4">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="group flex size-28 flex-col items-center justify-center gap-2 rounded-full border-2 bg-black/90 transition-transform active:scale-95"
              style={{ borderColor: accent, boxShadow: `0 0 26px ${accent}55` }}
            >
              <Icon className="size-8" style={{ color: accent }} />
              <span className="text-sm font-bold capitalize" style={{ color: accent }}>{label.toLowerCase()}</span>
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

      {/* Bottom media card — the picture again, full width, with the READY badge */}
      {robot && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative h-56 w-full overflow-hidden rounded-[32px] border-[3px]"
          style={{ borderColor: accent, boxShadow: `0 0 40px ${accent}66` }}
        >
          <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full object-cover" />
          <span className="absolute bottom-4 left-5 flex items-center gap-2 text-sm font-black tracking-[0.2em] text-white">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}` }} />
            {robot.running ? "RUNNING" : "READY"}
          </span>
        </motion.div>
      )}
    </div>
  );
}

/* ---------------- DARKWEB AI + ULTRON MEGA — black studio, full-screen video ---------------- */

export function BlackStudioLayout({ label, ...props }: SignatureLayoutProps & { label: string }) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="relative flex min-h-[70vh] w-full flex-col items-center justify-center gap-7 px-5 pb-10 pt-8">
      {/* Full-screen video backdrop — the small rounded screen is NOT used here */}
      <RobotMedia image={image} video={robot?.video} variant="hero" className="fixed inset-0 -z-10 size-full object-cover opacity-55" />
      <div aria-hidden className="fixed inset-0 -z-10" style={{ background: "radial-gradient(ellipse 90% 55% at 50% 28%, transparent 0%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.95) 100%)" }} />
      <div aria-hidden className="fixed inset-x-0 bottom-0 -z-10 h-48" style={{ background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.9))" }} />

      <ConsoleHeader label={label} accent={accent} font={font} running={robot?.running ?? false} />

      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex size-40 items-center justify-center overflow-hidden rounded-[36px] border bg-black/60 p-1 backdrop-blur-sm"
        style={{ borderColor: `${accent}88`, boxShadow: `0 0 44px ${accent}33` }}
      >
        <RobotMedia image={image} variant="avatar" preferImage className="size-full rounded-[32px] object-cover" />
      </motion.span>

      <div className="relative flex flex-col items-center">
        <Bot className="size-5" style={{ color: accent }} />
        <h1
          className="mt-2 mx-auto max-w-full break-words text-center text-3xl font-black uppercase leading-tight text-white sm:text-4xl"
          style={{ fontFamily: `'${font}', sans-serif`, textShadow: `0 0 30px ${accent}66` }}
        >
          {robot?.name ?? "YOUR ROBOT"}
        </h1>
      </div>

      <div className="relative"><PoweredBadge accent={accent} /></div>

      {robot ? (
        <div className="relative grid w-full max-w-sm grid-cols-3 gap-3">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-[24px] border bg-black/70 backdrop-blur-sm transition-transform active:scale-95"
              style={{ borderColor: `${accent}66` }}
            >
              <Icon className="size-6" style={{ color: accent }} />
              <span className="text-[10px] font-black tracking-[0.2em] text-white/85">{label}</span>
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

      <div className="relative w-full max-w-sm"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
    </div>
  );
}

/* ---------------- SUPREME EQUINOX — dual accent ---------------- */

export function SupremeEquinox(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-5">
      <ConsoleHeader label="SUPREME EQUINOX" accent={accent} font={font} running={robot?.running ?? false} />
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed relative h-[56vh] w-[calc(100%-1.5rem)] overflow-hidden rounded-[28px] bg-[#0b0d12]"
      >
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-85" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(115deg, rgba(255,45,45,0.22) 0%, transparent 45%, rgba(0,110,255,0.22) 100%)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.9) 100%)" }} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-7">
          <h1
            className="mx-auto max-w-full break-words px-3 text-center text-3xl font-black uppercase leading-tight text-white"
            style={{ fontFamily: `'${font}', sans-serif`, textShadow: "0 2px 20px rgba(0,0,0,0.9)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
        </div>
      </motion.section>

      <div className="mx-1 grid grid-cols-2 gap-3">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className="flex h-16 items-center justify-center gap-3 rounded-[22px] border transition-transform active:scale-[0.97]"
            style={{ borderColor: `${accent}55`, background: `${accent}14` }}
          >
            <Icon className="size-5" style={{ color: accent }} />
            <span className="text-[12px] font-black tracking-[0.2em] text-white">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center"><PoweredBadge accent={accent} /></div>
      <div className="mx-3"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
      <AddRobotRow accent={accent} onOpenAdd={onOpenAdd} font={font} />
    </div>
  );
}

/* ---------------- EA CLOUD — green ladder classic ---------------- */

export function EaCloud(props: SignatureLayoutProps) {
  const { robot, accent, font, onOpenAdd, onOpenScanner } = props;
  const actions = useActionDefs(props);
  const image = robot?.image || "/ea-migrate-platform-robot.jpg";
  return (
    <div className="flex flex-col gap-5">
      <ConsoleHeader label="EA CLOUD" accent={accent} font={font} running={robot?.running ?? false} />
      <motion.section
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed relative h-[56vh] w-[calc(100%-1.5rem)] overflow-hidden rounded-[28px] bg-[#04120a]"
      >
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover opacity-80" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(4,18,10,0.3) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.93) 100%)" }} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-7">
          <h1
            className="mx-auto max-w-full break-words px-3 text-center text-3xl font-black uppercase leading-tight text-white"
            style={{ fontFamily: `'${font}', sans-serif`, textShadow: `0 0 26px ${accent}88` }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <p className="mt-1.5 text-[11px] font-bold tracking-[0.34em] uppercase" style={{ color: accent }}>
            {robot?.running ? "CLIMBING" : "CLOUD READY"}
          </p>
        </div>
      </motion.section>

      <div className="mx-1 flex items-center justify-around rounded-[36px] border py-5" style={{ borderColor: `${accent}59`, background: "linear-gradient(180deg, rgba(0,255,136,0.08), rgba(0,0,0,0.75))" }}>
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5 px-3">
            <Icon className="size-7 transition-transform duration-200 group-hover:scale-110" style={{ color: accent }} />
            <span className="text-[11px] font-black tracking-[0.18em] text-white/85">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center"><PoweredBadge accent={accent} /></div>
      <div className="mx-3"><ScannerRow accent={accent} onOpenScanner={onOpenScanner} /></div>
      <AddRobotRow accent={accent} onOpenAdd={onOpenAdd} font={font} />
    </div>
  );
}
