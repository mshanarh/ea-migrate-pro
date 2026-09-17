import { useEffect, useRef, useState } from "react";

const AUTO_HIDE_MS = 6000; // popup disappears after 6s

declare global {
  interface Window {
    /** Show the draggable bot popup. Call from any theme: window.showBotStarted(eaName, "started"|"stopped"). */
    showBotStarted?: (name?: string, status?: "started" | "stopped") => void;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Resolve the robot name: explicit argument → stored active robot → stored name → generic. */
function resolveEaName(name?: string): string {
  if (name && name.trim()) return name.trim();
  try {
    const active = JSON.parse(localStorage.getItem("activeRobot") || "{}") as { name?: string };
    if (active.name) return active.name;
    return localStorage.getItem("robotName") || localStorage.getItem("eaName") || "EA";
  } catch {
    return "EA";
  }
}

/** Resolve the active robot's avatar image (uploaded from the mentor dashboard), else the built-in mascot. */
function resolveEaImage(): string {
  try {
    const raw = localStorage.getItem("eamp.app.v3");
    if (raw) {
      const state = JSON.parse(raw) as { activeRobotId?: string | null; robots?: { id?: string; image?: string }[] };
      const active = state.robots?.find((robot) => robot.id === state.activeRobotId) ?? state.robots?.[0];
      if (active?.image) return active.image;
    }
    const active = JSON.parse(localStorage.getItem("activeRobot") || "{}") as { image?: string };
    if (active.image) return active.image;
  } catch {
    /* ignore */
  }
  return "/botlogic-mascot.png";
}

/**
 * Draggable bot popup shown when a robot starts. Mount it once per app page;
 * any theme triggers it with window.showBotStarted(eaName).
 * Blue-glow avatar with live dot, EA name, "It Started 🚀", close button,
 * auto-hides after 6s and can be dragged anywhere (mouse + touch).
 */
export default function DraggableBotPopup() {
  const [visible, setVisible] = useState(false);
  const [eaName, setEaName] = useState("EA");
  const [eaImage, setEaImage] = useState("/botlogic-mascot.png");
  const [running, setRunning] = useState(true);
  const [pos, setPos] = useState({ x: 16, y: 150 });
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });
  const popupRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register the global trigger once — any theme can call window.showBotStarted(eaName, status).
  useEffect(() => {
    window.showBotStarted = (name?: string, status?: "started" | "stopped") => {
      setEaName(resolveEaName(name));
      setEaImage(resolveEaImage());
      setRunning(status !== "stopped");
      setVisible(true);
    };
    return () => {
      delete window.showBotStarted;
    };
  }, []);

  // Auto-hide 6s after each show (timer resets when re-triggered).
  useEffect(() => {
    if (!visible) return;
    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Let the close button behave as a click instead of starting a drag.
    if ((event.target as HTMLElement).closest("button")) return;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    offset.current = { x: event.clientX - pos.x, y: event.clientY - pos.y };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const rect = popupRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 220;
    const height = rect?.height ?? 72;
    setPos({
      x: clamp(event.clientX - offset.current.x, 0, window.innerWidth - width),
      y: clamp(event.clientY - offset.current.y, 0, window.innerHeight - height),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!visible) return null;

  return (
    <div
      ref={popupRef}
      role="status"
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ left: pos.x, top: pos.y, touchAction: "none" }}
      className={`fixed z-[99999] flex select-none items-center gap-3 rounded-full border border-[#2A2A2A] bg-[#0D0D0D] py-1 pl-1 pr-4 shadow-2xl transition-transform ${
        dragging ? "scale-105 cursor-grabbing" : "cursor-grab"
      }`}
    >
      {/* Robot avatar with status-colored glow ring and live dot */}
      <div
        className="relative size-14 shrink-0 overflow-hidden rounded-full border-2"
        style={{
          borderColor: running ? "#3A3AFF" : "#2A2A2A",
          boxShadow: running ? "0 0 15px rgba(58,58,255,0.6)" : "0 0 10px rgba(255,255,255,0.15)",
        }}
      >
        <img src={eaImage} alt="" className={`size-full object-cover ${running ? "" : "opacity-60 grayscale"}`} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-5 rounded-full border-[3px] border-[#0D0D0D] ${running ? "animate-pulse bg-[#22C55E]" : "bg-[#666]"}`}
        />
      </div>

      <div className="flex min-w-0 flex-col">
        <p className="truncate text-[13px] font-bold leading-none text-white">{eaName}</p>
        <p
          className="mt-1.5 flex items-center gap-1 text-[12px]"
          style={{ color: running ? "#22C55E" : "rgba(255,255,255,0.55)" }}
        >
          <span className="leading-none">●</span> {running ? "It Started 🚀" : "It Stopped ⏹"}
        </p>
      </div>

      <button
        type="button"
        aria-label="Dismiss bot popup"
        onClick={() => setVisible(false)}
        className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-xs font-bold text-white transition-transform hover:scale-105 active:scale-95"
      >
        ✕
      </button>
    </div>
  );
}
