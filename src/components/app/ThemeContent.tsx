import { useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { motion } from "framer-motion";
import { ChartLine, Info, MessageCircle, Pause, Play, Plus, ScanLine, Trash2, Waves } from "lucide-react";
import { accentColorValue, fontStack, useCustomization } from "@/lib/app-customization";
import type { Robot } from "@/lib/app-store";
import { BlueprintEdge } from "@/components/app/BlueprintEdge";
import { RobotMedia, VideoBackdrop } from "@/components/app/RobotMedia";
import { useMediaDim } from "@/lib/use-media-dim";
import { Sniper, Phoenix, Vortex } from "@/components/app/SignatureLayouts";
import { InterfaceConsole } from "@/components/app/InterfaceConsole";
import { interfaceDefinitionFor } from "@/lib/interface-themes";

export type ThemeContentProps = {
  robot: Robot | undefined;
  robots?: Robot[];
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
  onOpenSymbols?: () => void;
  onSelectRobot?: (id: string) => void;
};

export function PoweredBadge({
  accent,
  label = "Powered By EA MIGRATE",
}: {
  accent: string;
  label?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-black/90 px-5 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white"
      style={{
        border: `1.5px solid ${accent}`,
        // A pill's glow stays on its own rim — it never lights the page.
        boxShadow: `0 0 16px color-mix(in srgb, ${accent} 35%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

type ActionDef = { label: string; icon: typeof Play; onClick: () => void };

function useActions({ robot, onStart, onQuotes, onRemove }: Pick<ThemeContentProps, "robot" | "onStart" | "onQuotes" | "onRemove">): ActionDef[] {
  const running = robot?.running ?? false;
  return [
    { label: running ? "STOP" : "START", icon: running ? Pause : Play, onClick: onStart },
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
      className="if-card if-control mx-3 flex min-h-44 w-[calc(100%-1.5rem)] flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center"
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

/**
 * THE HOME CARD — a clean black page with ONE neon-edged card on it.
 *
 * The accent is deliberately kept on the card's rim (and on the icons inside
 * it): no radial wash, no gradient behind the page and no big blurred orb, so
 * the card reads as a sharp neon outline on pure black instead of a coloured
 * haze across the viewport.
 */
function NovaCore({ robot, accent, font, actions, onOpenAdd, onOpenScanner }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenAdd: () => void; onOpenScanner: () => void }) {
  const image = robot?.image || "/logo.png";
  return (
    <div className="flex flex-col gap-4">
      <motion.section
        layout
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-fold relative mx-3 w-[calc(100%-1.5rem)] overflow-hidden rounded-[28px]"
        style={{
          backgroundColor: "#080808",
          border: `2px solid ${accent}`,
          // TIGHT AND CONTAINED: the glow is the card's own edge, nothing else.
          boxShadow: `0 0 24px color-mix(in srgb, ${accent} 45%, transparent), inset 0 0 12px color-mix(in srgb, ${accent} 15%, transparent)`,
        }}
      >
        {/* Robot artwork only when the preference is ON — otherwise the card
            stays the clean #080808 surface with nothing on top of it. */}
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover" />
        <div className="relative flex h-full flex-col items-center justify-end gap-4 px-5 pb-6 pt-4">
          <h1
            className="mx-auto max-w-full break-words px-2 text-center text-2xl font-black tracking-[0.08em] text-white uppercase sm:text-3xl"
            style={{ fontFamily: fontStack(font), textShadow: "0 2px 18px rgba(0,0,0,0.85)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>

          {/* Actions: line icons, uppercase labels, black touch targets. */}
          <div className="grid w-full max-w-xs grid-cols-3 gap-2">
            {actions.map(({ label, icon: Icon, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="group flex flex-col items-center gap-1.5 rounded-2xl bg-black/90 py-3 transition-transform active:scale-95"
                style={{ border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)` }}
              >
                <Icon
                  className="size-6 transition-transform duration-200 group-hover:scale-110"
                  style={{ color: accent }}
                  strokeWidth={1.8}
                />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">{label}</span>
              </button>
            ))}
          </div>

          {/* Pills: black capsules, 1.5px accent rim, crisp text. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <PoweredBadge accent={accent} />
            <button
              type="button"
              onClick={onOpenScanner}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/90 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition-transform active:scale-95"
              style={{
                border: `1.5px solid ${accent}`,
                boxShadow: `0 0 16px color-mix(in srgb, ${accent} 35%, transparent)`,
              }}
            >
              <ScanLine className="size-3.5" style={{ color: accent }} strokeWidth={2.2} />
              AI Scanner
            </button>
          </div>
        </div>
      </motion.section>

      {/* Add robot stays a pill too — black surface, accent rim, no gradient. */}
      <button
        type="button"
        onClick={onOpenAdd}
        className="mx-3 flex items-center justify-center gap-3 rounded-full bg-black/90 py-4 transition-transform active:scale-[0.98]"
        style={{
          border: `1.5px solid ${accent}`,
          boxShadow: `0 0 18px color-mix(in srgb, ${accent} 28%, transparent)`,
        }}
      >
        <Plus className="size-5" style={{ color: accent }} strokeWidth={2.4} />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-white">Add robot</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Host key</span>
      </button>
    </div>
  );
}

/* ---------------- PHANTOM PULSE ---------------- */

function PhantomPulse({ robot, accent, font, actions, onOpenAdd }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenAdd: () => void }) {
  const image = robot?.image || "/logo.png";
  return (
    <div className="relative flex app-hero-fold-min w-full flex-col items-center justify-center gap-5 overflow-hidden bg-black px-5 py-7">
      {/* The picture at FULL strength — no dim layer over it. Text contrast
          comes from the shadows on the text itself. */}
      <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover" />

      <div className="relative flex flex-col items-center">
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex app-hero-orb items-center justify-center rounded-full border-4 bg-white/10 p-2"
          style={{ borderColor: accent, boxShadow: `0 0 46px ${accent}, 0 0 110px ${accent}59` }}
        >
          <RobotMedia image={image} video={robot?.video} variant="avatar" preferImage className="size-full rounded-full object-cover" />
        </motion.span>

        <p className="mt-5 text-sm font-bold tracking-[0.34em] text-white/60 uppercase" style={{ textShadow: "0 2px 10px rgba(0,0,0,.85)" }}>You're trading with</p>
        <h1
          className="mx-auto mt-2 max-w-full break-words px-2 text-center text-2xl font-black leading-tight tracking-wide text-white uppercase sm:text-3xl"
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
              className="group flex size-20 flex-col items-center justify-center gap-1.5 rounded-full border-2 bg-black/90 transition-transform active:scale-95"
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
  const image = robot?.image || "/logo.png";
  return (
    <div className="flex flex-col gap-4">
      <motion.section
        layout
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed app-hero-fold relative w-full overflow-hidden bg-black"
      >
        {/* Background picture only when the preference is ON — otherwise the
            hero stays a clean solid black with nothing on top of it. */}
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover" />
        <div className="relative flex h-full flex-col items-center justify-end pb-7">
          <h1
            className="mx-auto max-w-full break-words px-2 text-center text-2xl font-black leading-tight text-white sm:text-3xl"
            style={{ fontFamily: fontStack(font), textShadow: "0 2px 20px rgba(0,0,0,0.85)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>
          <p className="mt-2 text-sm font-bold tracking-[0.34em] text-white/70 uppercase" style={{ color: accent, textShadow: "0 2px 10px rgba(0,0,0,.85)" }}>
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

/* ---------------- PRIME FORGE (key-activation classic) ---------------- */

function PrimeForge({ robot, accent, font, actions, onOpenAdd }: ThemeContentProps & { accent: string; font: string; actions: ActionDef[]; onOpenAdd: () => void }) {
  const image = robot?.image || "/logo.png";
  return (
    <div className="flex flex-col gap-4">
      <motion.section
        layout
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="app-hero-bleed app-hero-fold relative w-full overflow-hidden bg-black"
        style={{ boxShadow: `0 0 0 1px ${accent}40, 0 18px 50px ${accent}2e` }}
      >
        {/* Background picture only when the preference is ON — otherwise the
            hero stays a clean solid black with nothing on top of it. */}
        {/* Background picture at full strength — no dim/gradient over it.
            The shared player (src/lib/shared-video.ts) makes every hero play
            automatically, so no per-theme autoplay flag is needed. */}
        <RobotMedia image={image} video={robot?.video} variant="hero" className="absolute inset-0 size-full object-cover" />
        <div className="relative flex h-full flex-col items-center justify-end px-4 pb-6 pt-4">
          <div className="absolute top-4 left-4 flex flex-col items-center gap-3">
            <button
              type="button"
              aria-label="Chat with support"
              className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <MessageCircle className="size-5" />
            </button>
            <span className="relative flex size-11 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-sm">
              <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
              <span className="absolute -bottom-0.5 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-black bg-[#22C55E]" />
            </span>
          </div>

          <h1
            className="mx-auto max-w-full break-words px-2 text-center text-2xl font-black tracking-[0.08em] text-white uppercase sm:text-3xl"
            style={{ fontFamily: fontStack(font), textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}
          >
            {robot?.name ?? "YOUR ROBOT"}
          </h1>

          <div className="mt-5 grid w-full max-w-xs grid-cols-3 gap-2">
            {actions.map(({ label, icon: Icon, onClick }) => (
              <button key={label} type="button" onClick={onClick} className="group flex flex-col items-center gap-2 py-1">
                <Icon className="size-9 transition-transform duration-200 group-hover:scale-110" style={{ color: accent }} strokeWidth={2.2} />
                <span className="text-xs font-bold tracking-[0.14em]" style={{ color: accent }}>{label}</span>
              </button>
            ))}
          </div>

          <p className="mt-5 text-[11px] font-semibold tracking-[0.3em] text-white/45 uppercase" style={{ textShadow: "0 2px 8px rgba(0,0,0,.85)" }}>Powered by Ea migrate</p>
        </div>
      </motion.section>

      <button
        type="button"
        onClick={onOpenAdd}
        className="mx-3 mt-3 flex h-24 w-[calc(100%-1.5rem)] items-center gap-5 rounded-[24px] px-7 text-left transition-transform active:scale-[0.98]"
        style={{ background: `linear-gradient(180deg, ${accent}, ${accent}b3)`, boxShadow: `0 14px 44px ${accent}66` }}
      >
        <Plus className="size-9 shrink-0 text-white" strokeWidth={2.6} />
        <span className="flex flex-col">
          <span className="text-xl font-black tracking-wide text-white">ADD ROBOT</span>
          <span className="text-xs font-semibold tracking-[0.22em] text-white/80">HOST ROBOT KEY</span>
        </span>
      </button>
    </div>
  );
}

/* ---------------- SWITCH ---------------- */

export function ThemeContent(props: ThemeContentProps) {
  const { theme, color } = useCustomization();
  const accent = accentColorValue(color);
  // Home's themed backdrop follows the SAME persisted Background Picture
  // switch as every other screen: OFF → no image, no video, clean black.
  const mediaDim = useMediaDim();

  // The HOME double-press video — ONE universal backdrop for every interface
  // style. When stopped this renders nothing (the slots keep the picture);
  // when playing, the video runs edge-to-edge behind the theme's content.
  return (
    <>
      <VideoBackdrop
        image={props.robot?.image || "/logo.png"}
        video={props.robot?.video}
        accent={accentColorValue(color)}
        mediaDim={mediaDim}
        showImageWhenInactive={theme === "SNIFFER" || theme === "PHOENIX" || theme === "VORTEX 1"}
        // Signature layouts use their robot media as the full background.
        // The other big-screen themes play video inside their hero card.
        videoWhenActive
      />
      <ThemeContentInner {...props} />
    </>
  );
}

function ThemeContentInner(props: ThemeContentProps) {
  const { theme, color, font } = useCustomization();
  const accent = accentColorValue(color);
  const actions = useActions(props);

  // The eight real Main Interfaces (Crimson Navigator … Ultron Mega) render
  // the definition-driven console: same live robot/broker data, the
  // interface's own colours, surfaces, header and hero decoration. It renders
  // with or without a robot, so the interface is visible immediately.
  const definition = interfaceDefinitionFor(theme);
  if (definition) {
    return (
      <InterfaceConsole
        definition={definition}
        robot={props.robot}
        accent={accent}
        actions={actions}
        onOpenAdd={props.onOpenAdd}
      />
    );
  }

  if (!props.robot) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyRobot accent={accent} onOpenAdd={props.onOpenAdd} />
        {(theme === "NOVA CORE" || theme === "PRIME FORGE") && (
          <button
            type="button"
            onClick={props.onOpenAdd}
            className="mx-3 flex h-24 w-[calc(100%-1.5rem)] items-center gap-5 rounded-[24px] px-7 text-left transition-transform active:scale-[0.98]"
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
  if (theme === "PRIME FORGE") {
    return <PrimeForge {...props} accent={accent} font={font} actions={actions} onOpenAdd={props.onOpenAdd} />;
  }
  if (theme === "SNIFFER") {
    return <Sniper robot={props.robot} accent={accent} onStart={props.onStart} onQuotes={props.onQuotes} onRemove={props.onRemove} onOpenScanner={props.onOpenScanner} onOpenAdd={props.onOpenAdd} />;
  }
  if (theme === "VORTEX 1") {
    return <Vortex robot={props.robot} accent={accent} onStart={props.onStart} onQuotes={props.onQuotes} onRemove={props.onRemove} onOpenScanner={props.onOpenScanner} onOpenAdd={props.onOpenAdd} />;
  }
  if (theme === "PHOENIX") {
    return <Phoenix robot={props.robot} accent={accent} onStart={props.onStart} onQuotes={props.onQuotes} onRemove={props.onRemove} onOpenScanner={props.onOpenScanner} onOpenAdd={props.onOpenAdd} />;
  }
  if (theme === "BLUEPRINT EDGE") {
    return (
      <BlueprintEdge
        robot={props.robot}
        robots={props.robots ?? (props.robot ? [props.robot] : [])}
        onStart={props.onStart}
        onQuotes={props.onQuotes}
        onRemove={props.onRemove}
        onOpenSymbols={props.onOpenSymbols ?? props.onOpenScanner}
        onOpenAdd={props.onOpenAdd}
        onSelectRobot={props.onSelectRobot ?? (() => {})}
      />
    );
  }
  return (
    <NovaCore
      {...props}
      accent={accent}
      font={font}
      actions={actions}
      onOpenAdd={props.onOpenAdd}
      onOpenScanner={props.onOpenScanner}
    />
  );
}
