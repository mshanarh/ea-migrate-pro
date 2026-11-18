import { Square, LineChart, BarChart3, DollarSign, Pause, Play, Plus, Settings, Trash2 } from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { RobotMedia } from "@/components/app/RobotMedia";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

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
      {/* The name is the point of this card, so it wraps to two lines and the
          accent stays readable over whatever picture is behind it. */}
      <span
        className="absolute inset-0 line-clamp-2 flex items-center justify-center break-words px-8 text-center text-base font-black uppercase leading-tight tracking-wide"
        style={{ color: accent, textShadow: "0 2px 8px black, 0 0 14px rgba(0,0,0,.65)" }}
      >
        {robot?.name ?? "YOUR ROBOT"}
      </span>
    </div>
  );
}

/** Sniper matches the connected-robot dashboard reference. */
export function Sniper({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const image = robot?.image || "/logo.png";
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] overflow-hidden px-4 pb-6 pt-4 text-white sm:px-5 sm:pt-6">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-4 sm:gap-6">
        <RobotPortrait robot={robot} accent={accent} />
        <RobotHeading robot={robot} accent={accent} />
        <PoweredBadge accent={accent} />

        <div
          className="grid w-full items-center rounded-[48px] border-2 bg-black/90 px-3 py-4"
          style={{
            gridTemplateColumns: 'repeat(3, 1fr)',
            borderColor: accent,
            boxShadow: `0 0 30px ${accent}70`,
          }}
        >
          <RoundAction label="Delete" icon={Trash2} onClick={onRemove} accent={accent} />
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
export function Phoenix({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const image = robot?.image || "/logo.png";
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
export function Vortex({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  return (
    <div className="relative z-10 min-h-[calc(100dvh-var(--plat-nav-h))] px-4 pb-6 pt-4 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        {/* Obsidian glass card with the accent as AMBIENT LIGHT: the surface
            stays dark, the light blooms around it in the halo behind. */}
        <div className="relative">
        <span aria-hidden className="ambient-glow-halo rounded-[40px]" />
        <div className="ambient-glow-dynamic relative flex flex-col items-center rounded-[40px] px-5 pb-7 pt-7">
          <span className="absolute right-6 top-6 size-3.5 rounded-full" style={{ backgroundColor: running ? "#22C55E" : "#FF1744", boxShadow: `0 0 10px ${running ? "#22C55E" : "#FF1744"}` }} />
          <div className="size-32 overflow-hidden rounded-full border-4 border-white/85 bg-black shadow-2xl sm:size-36">
            <RobotMedia image={robot?.image || "/logo.png"} video={robot?.video} variant="avatar" preferImage className="size-full object-cover" />
          </div>
          <h1 className="mt-6 max-w-full break-words text-center text-2xl font-black uppercase leading-none sm:text-3xl" style={{ textShadow: "0 2px 6px rgba(0,0,0,.6)" }}>
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <div className="mt-6 grid w-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
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
        </div>
        <button
          type="button"
          onClick={onOpenAdd}
          className="ambient-glow-dynamic flex min-h-20 items-center gap-5 rounded-full px-7 text-left transition-transform active:scale-[0.98]"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-black/60" style={{ border: `1px solid ${accent}` }}><Plus className="size-6" strokeWidth={3} style={{ color: accent }} /></span>
          <span className="flex flex-col">
            <span className="text-2xl font-black uppercase">Add Robot</span>
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/85">Host Robot Key</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * APEX SNIPER — the avatar breaks the top edge of an obsidian glass card.
 *
 * The circle is deliberately NOT inside the card's clip: it is anchored
 * top-centre and lifted above it, so the robot's face sits on the card's
 * border instead of inside a box. The three controls are squircle glass tiles
 * (start/stop, quotes, remove) and the Host Robot capsule is the same glass.
 *
 * Background: nothing is drawn here. The robot's own picture/video arrives as
 * `robot.image` / `robot.video` through RobotMedia — no static asset is
 * hardcoded, so any EA the trader hosts gets its own face on this screen.
 */
export function ApexSniper({ robot, accent, onStart, onQuotes, onRemove, onOpenAdd }: SignatureLayoutProps) {
  const running = Boolean(robot?.running);
  const image = robot?.image || "/logo.png";

  return (
    /* TOP-ANCHORED, like every other interface style. Centring the column put
       the card in the middle of the viewport, which on a phone reads as "pushed
       down into the bottom dock" — the content now starts under the header and
       the extra bottom padding keeps it clear of the nav. */
    <div className="relative z-10 flex min-h-[calc(100dvh-var(--plat-nav-h))] flex-col items-center justify-start px-4 pb-24 pt-6 text-white sm:pt-8">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5">
        {/* Main card with the top-overlapping avatar */}
        <div className="relative mt-12 w-full">
          {/* The avatar is a sibling of the card, so its border is not clipped
              by the card's rounded glass and its shadow falls on the card. */}
          <div
            className="absolute -top-12 left-1/2 z-20 size-24 -translate-x-1/2 overflow-hidden rounded-full border-[3px] border-white/80 bg-black/90 shadow-[0_12px_28px_rgba(0,0,0,0.8)] sm:size-28"
            style={{ borderColor: accent }}
          >
            <RobotMedia
              image={image}
              video={robot?.video}
              variant="avatar"
              preferImage
              className="size-full object-cover"
            />
          </div>

          {/* Dark glass card body */}
          <div className="relative rounded-[32px] border border-white/15 bg-black/75 px-5 pb-6 pt-16 text-center shadow-[0_20px_50px_rgba(0,0,0,0.65)] backdrop-blur-xl">
            <h1
              className="max-w-full break-words text-2xl font-black uppercase tracking-tight text-white sm:text-3xl"
              style={{ textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}
            >
              {robot?.name ?? "YOUR ROBOT"}
            </h1>

            {/* Three squircle glass tiles */}
            <div className="mt-6 grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={onStart}
                className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.06] p-3.5 transition-all hover:bg-white/10 active:scale-95"
              >
                {running ? (
                  <Square className="size-6 text-white" fill="currentColor" />
                ) : (
                  <Play className="size-6 text-white" fill="currentColor" />
                )}
                <span className="text-[11px] font-black uppercase tracking-wider text-white">
                  {running ? "STOP" : "START"}
                </span>
              </button>

              <button
                type="button"
                onClick={onQuotes}
                className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.06] p-3.5 transition-all hover:bg-white/10 active:scale-95"
              >
                <LineChart className="size-6 text-white" />
                <span className="text-[11px] font-black uppercase tracking-wider text-white">
                  QUOTES
                </span>
              </button>

              <button
                type="button"
                onClick={onRemove}
                className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.06] p-3.5 transition-all hover:bg-white/10 active:scale-95"
              >
                <Trash2 className="size-6 text-white" />
                <span className="text-[11px] font-black uppercase tracking-wider text-white">
                  REMOVE
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Host Robot capsule — the label says what it opens, the row says
            where it leads. */}
        <button
          type="button"
          onClick={onOpenAdd}
          className="flex w-full items-center justify-between rounded-[28px] border border-white/15 bg-black/75 px-6 py-4 shadow-lg backdrop-blur-xl transition-all hover:bg-white/10 active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <span
              className="flex size-9 items-center justify-center rounded-full border border-white/20 bg-white/10"
              style={{ borderColor: accent }}
            >
              <Plus className="size-5 text-white" strokeWidth={2.8} />
            </span>
            <div className="flex flex-col text-left">
              <span className="text-sm font-black uppercase tracking-wider text-white">ADD ROBOT</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                HOST ROBOT KEY
              </span>
            </div>
          </div>
          <span className="text-lg font-bold text-white/40" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * UNLIMITED BULL — a portrait led dashboard with a bull-market swagger.
 *
 * The robot's own picture is the hero (a rounded squircle, never a bundled
 * asset), the face repeats as a floating badge on its bottom edge, and the
 * face repeats once more on the connected-EA capsule. Everything that is
 * colour in this layout comes from the trader's accent and the current
 * appearance mode — there is no gold/brown literal in the file, so the same
 * screen works in dark and white mode with any accent the trader picks.
 */
export function UnlimitedBull({
  robot,
  accent: accentProp,
  onStart,
  onQuotes,
  onRemove,
  onOpenAdd,
  onOpenScanner,
}: SignatureLayoutProps) {
  const { color, appearanceMode } = useCustomization();
  // The prop is the theme's own accent; the setting is the trader's. Read the
  // live one first so a colour change repaints this screen immediately.
  const accent = accentProp || accentColorValue(color);
  const isDark = appearanceMode !== "white";
  const name = robot?.name ?? "UNLIMITED BULL";
  const image = robot?.image || "/logo.png";
  const running = Boolean(robot?.running);

  /** Text/surface colours flip with the mode — nothing is pinned to black. */
  const title = isDark ? "#FFFFFF" : "#0B0B0C";
  const muted = isDark ? "rgba(255,255,255,0.55)" : "rgba(11,11,12,0.55)";
  const glass = isDark ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.85)";
  const glassBorder = isDark ? "rgba(255,255,255,0.15)" : "rgba(11,11,12,0.12)";

  /** One round control: ring, icon and caption each own their colour, so
   *  DELETE can be red while STOP/SYMBOLS follow the accent — all of it from
   *  the mode, never a fixed literal on the component. */
  const arcButton = (
    label: string,
    Icon: typeof Play,
    onClick: () => void,
    options: { color?: string; ring?: string; glow?: string; fill?: boolean } = {},
  ) => {
    const iconColor = options.color ?? title;
    const ring = options.ring ?? `${accent}70`;
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-center gap-2 transition-transform active:scale-95"
      >
        <span
          className="flex size-16 items-center justify-center rounded-full"
          style={{
            border: `1.5px solid ${ring}`,
            boxShadow: `0 0 18px ${options.glow ?? `${accent}33`}`,
            background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.75)",
          }}
        >
          <Icon
            className="size-6"
            style={{ color: iconColor }}
            fill={options.fill ? "currentColor" : "none"}
          />
        </span>
        <span
          className="text-[11px] font-black uppercase tracking-[0.14em]"
          style={{ color: options.color ?? title }}
        >
          {label}
        </span>
      </button>
    );
  };

  return (
    <div className="relative z-10 flex min-h-[calc(100dvh-var(--plat-nav-h))] flex-col items-center justify-start px-4 pb-28 pt-4 text-white sm:pt-6">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4">
        {/* THE NOTE — the layout's own voice, in the trader's accent. */}
        <p
          className="text-center text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: accent }}
        >
          its time for a change
        </p>

        {/* HERO CARD — the robot's own media in a tall squircle with a halo. */}
        <div className="relative w-full">
          <div
                          className="pointer-events-none absolute -inset-3 rounded-[42px] blur-2xl"
            style={{ background: `radial-gradient(ellipse at 50% 40%, ${accent}55, transparent 70%)` }}
            aria-hidden="true"
          />
          {/* The portrait fills the frame edge-to-edge — the floating badge is
              gone, so the picture is the whole card. */}
          <div
            className="relative aspect-[4/5] w-full overflow-hidden rounded-[32px]"
            style={{
              border: `1.5px solid ${accent}66`,
              boxShadow: `0 24px 60px rgba(0,0,0,${isDark ? "0.65" : "0.25"}), inset 0 0 0 1px ${accent}22`,
              background: isDark ? "#0B0B0C" : "#F4F4F5",
            }}
          >
            <RobotMedia
              image={image}
              video={robot?.video}
              variant="avatar"
              preferImage
              className="size-full object-cover"
            />
          </div>
        </div>

        {/* HEADING */}
        {/* The configured name, verbatim — long names wrap on word boundaries
            instead of being clipped, and there is no shadow in white mode (a
            light page would only smear the glyphs). */}
        <h1
          className="max-w-full whitespace-normal break-words text-center text-2xl font-black uppercase leading-tight sm:text-3xl"
          style={{ color: title, textShadow: isDark ? "0 2px 10px rgba(0,0,0,0.8)" : "none" }}
        >
          {name}
        </h1>

        {/* ACTION BAR — one stadium pill holding the three controls. */}
        <div
          className="flex w-full items-center justify-between gap-2 rounded-full px-6 py-4 shadow-xl backdrop-blur-xl"
          style={{ background: glass, border: `1px solid ${glassBorder}` }}
        >
          {arcButton("DELETE", Trash2, onRemove, {
            color: isDark ? "#F87171" : "#DC2626",
            ring: isDark ? "rgba(248,113,113,0.55)" : "rgba(220,38,38,0.45)",
            glow: isDark ? "rgba(248,113,113,0.18)" : "rgba(220,38,38,0.12)",
          })}
          {arcButton(
            running ? "STOP" : "START",
            running ? Pause : Play,
            onStart,
            { fill: true, color: accent },
          )}
          {/* SYMBOLS — a symbol picker and the scanner are the same intent:
              the window opens when one is wired, otherwise the scanner. */}
          {arcButton("SYMBOLS", BarChart3, onQuotes ?? onOpenScanner, { color: accent })}
        </div>

        {/* CONNECTED EA — the face and the name of the running robot. */}
        <div
          className="flex w-full items-center gap-4 rounded-full px-5 py-3.5 backdrop-blur-xl"
          style={{ background: glass, border: `1px solid ${glassBorder}` }}
        >
          <span
            className="size-11 shrink-0 overflow-hidden rounded-full"
            style={{ border: `2px solid ${accent}`, background: isDark ? "#0B0B0C" : "#FFFFFF" }}
          >
            <RobotMedia
              image={image}
              video={robot?.video}
              variant="avatar"
              preferImage
              className="size-full object-cover"
            />
          </span>
          {/* A long EA name wraps onto a second line instead of being
              truncated — the configured name is never shortened here. */}
          <span
            className="line-clamp-2 min-w-0 flex-1 break-words text-left text-[15px] font-black uppercase leading-tight tracking-wide"
            style={{ color: title }}
          >
            {name}
          </span>
        </div>

        {/* CONNECT EA — plus in an accent ring, the label, and the settings
            gear on the right. */}
        <button
          type="button"
          onClick={onOpenAdd}
          className="flex w-full items-center gap-4 rounded-full px-5 py-4 backdrop-blur-xl transition-transform active:scale-[0.98]"
          style={{ background: glass, border: `1px solid ${glassBorder}` }}
        >
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full"
            style={{ border: `2px solid ${accent}`, boxShadow: `0 0 16px ${accent}44` }}
          >
            <Plus className="size-5" style={{ color: title }} strokeWidth={2.6} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col text-left">
            <span className="text-[15px] font-black uppercase tracking-wide" style={{ color: title }}>
              Connect EA
            </span>
            <span className="text-[11px] font-semibold" style={{ color: muted }}>
              Connect New License Key
            </span>
          </div>
          <Settings className="size-5 shrink-0" style={{ color: muted }} />
        </button>
      </div>
    </div>
  );
}
