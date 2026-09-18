import { useEffect, useState } from "react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { isBotVoiceEnabled, setBotVoiceEnabled, warmBotVoice } from "@/lib/bot-voice";
import { isRobotVideoAuto, requestVideoPlayback, setRobotVideoAuto } from "@/lib/video-playback";

type RowKind = "canvas" | "matrix" | "robotVideo" | "botVoice";

type EffectRow = {
  id: string;
  emoji: string;
  name: string;
  subtitle: string;
  kind: RowKind;
  /** Canvas effect id from BG_EFFECTS this row drives. */
  canvasId?: string;
};

/**
 * The Back Animation rows, exactly as designed: stacked pill rows with an
 * emoji, a bold name, a short subtitle and an instant-apply toggle.
 *
 * Canvas rows drive the full-screen background engine (mutually exclusive —
 * one animation plays at a time). Colour Matrix, Robot Video and Bot Voice
 * are independent features layered on top.
 */
const ROWS: EffectRow[] = [
  { id: "profit-rain", emoji: "💰", name: "Profit Rain", subtitle: "Raining symbols", kind: "canvas", canvasId: "dollars" },
  { id: "lightning", emoji: "⚡", name: "Lightning", subtitle: "Electric storm effect", kind: "canvas", canvasId: "lightning" },
  { id: "colour-matrix", emoji: "🎨", name: "Colour Matrix", subtitle: "Pulses image, button & name glows on & off", kind: "matrix" },
  { id: "hackers", emoji: "🧑‍💻", name: "Hackers", subtitle: "Binary streams flowing behind the UI", kind: "canvas", canvasId: "binary" },
  { id: "candle-chart", emoji: "📈", name: "Candle Chart", subtitle: "Animated candlestick chart backdrop in accent color", kind: "canvas", canvasId: "candles" },
  { id: "robot-video", emoji: "🎞️", name: "Robot Video", subtitle: "Ask your mentor to upload a video on their EA to unlock this", kind: "robotVideo" },
  { id: "bot-voice", emoji: "🎙️", name: "Bot Voice", subtitle: "Smooth male voice announces start/stop and reads live trade logs", kind: "botVoice" },
];

const MATRIX_KEY = "eamp-colour-matrix";

function readCanvasConfig() {
  if (typeof window === "undefined") return { enabled: true, type: "dollars" };
  return {
    enabled: localStorage.getItem("bgEffectsEnabled") !== "false",
    type: localStorage.getItem("bgEffectType") || "dollars",
  };
}

function writeCanvasConfig(enabled: boolean, type: string) {
  localStorage.setItem("bgEffectsEnabled", enabled ? "true" : "false");
  localStorage.setItem("bgEffectType", type);
  window.dispatchEvent(new Event("eamp:bg-effects"));
}

function readMatrix(): boolean {
  if (typeof window === "undefined") return false;
  return document.body.classList.contains(MATRIX_KEY);
}

function writeMatrix(on: boolean) {
  document.body.classList.toggle(MATRIX_KEY, on);
  try {
    localStorage.setItem(MATRIX_KEY, on ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/** Re-applies the persisted Colour Matrix class (called on app screens). */
export function applyColourMatrixFromStorage() {
  if (typeof window === "undefined") return;
  let on = false;
  try {
    on = localStorage.getItem(MATRIX_KEY) === "true";
  } catch {
    /* ignore */
  }
  document.body.classList.toggle(MATRIX_KEY, on);
  const glow = getComputedStyle(document.body).getPropertyValue("--eamp-glow").trim();
  if (!glow) document.body.style.setProperty("--eamp-glow", "#ff2d78");
}

function Toggle({ on, accent, onToggle, disabled }: { on: boolean; accent: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="relative h-8 w-[60px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ backgroundColor: on ? accent : "rgba(255,255,255,0.14)" }}
    >
      <span
        className="absolute top-1 size-6 rounded-full bg-white shadow transition-all duration-200"
        style={{ left: on ? "30px" : "4px" }}
      />
    </button>
  );
}

export function BackAnimationSection() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);

  const [canvas, setCanvas] = useState({ enabled: true, type: "dollars" });
  const [matrix, setMatrix] = useState(false);
  const [voice, setVoice] = useState(true);
  const [robotVideoAuto, setRobotVideoAutoState] = useState(false);
  const [hasRobotVideo, setHasRobotVideo] = useState(false);

  useEffect(() => {
    setCanvas(readCanvasConfig());
    setMatrix(readMatrix());
    setVoice(isBotVoiceEnabled());
    setRobotVideoAutoState(isRobotVideoAuto());
    warmBotVoice();
    try {
      const raw = localStorage.getItem("eamp.app.v3");
      const state = raw ? (JSON.parse(raw) as { robots?: { video?: string }[] }) : null;
      setHasRobotVideo((state?.robots ?? []).some((robot) => typeof robot.video === "string" && robot.video.length > 0));
    } catch {
      setHasRobotVideo(false);
    }
  }, []);

  const toggleRow = (row: EffectRow) => {
    if (row.kind === "canvas" && row.canvasId) {
      const isOn = canvas.enabled && canvas.type === row.canvasId;
      // Canvas animations are mutually exclusive — switching one on switches the rest off.
      const next = isOn ? { enabled: false, type: canvas.type } : { enabled: true, type: row.canvasId };
      setCanvas(next);
      writeCanvasConfig(next.enabled, next.type);
      return;
    }
    if (row.kind === "matrix") {
      const next = !matrix;
      setMatrix(next);
      writeMatrix(next);
      return;
    }
    if (row.kind === "botVoice") {
      const next = !voice;
      setVoice(next);
      setBotVoiceEnabled(next);
      return;
    }
    if (row.kind === "robotVideo") {
      if (!hasRobotVideo) return; // locked until the mentor uploads a video
      const next = !robotVideoAuto;
      setRobotVideoAutoState(next);
      // The flag setter notifies every mounted RobotMedia: on → swap to video
      // and play, off → pause and return the picture slot to the image.
      setRobotVideoAuto(next);
      if (next) requestVideoPlayback();
    }
  };

  return (
    <div className="space-y-3">
      {ROWS.map((row) => {
        const isOn =
          row.kind === "canvas" && row.canvasId
            ? canvas.enabled && canvas.type === row.canvasId
            : row.kind === "matrix"
              ? matrix
              : row.kind === "botVoice"
                ? voice
                : robotVideoAuto;
        const locked = row.kind === "robotVideo" && !hasRobotVideo;
        return (
          <div
            key={row.id}
            className={`flex items-center justify-between gap-3 rounded-[22px] border border-white/[0.06] bg-[#121212] px-5 py-4 ${locked ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="text-[22px] leading-none" aria-hidden>
                {row.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-black text-white">{row.name}</p>
                <p className="mt-0.5 text-xs leading-snug text-white/45">{row.subtitle}</p>
              </div>
            </div>
            <Toggle on={isOn} accent={accent} onToggle={() => toggleRow(row)} disabled={locked} />
          </div>
        );
      })}
      <p className="pt-1 text-center text-[11px] text-white/35">Toggles apply instantly across the app.</p>
    </div>
  );
}
