import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/app-store";

/** Clamp a coordinate so the button can never be dragged off-screen. */
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Floating bot companion — visible ONLY while the robot is running.
 *
 * - START pressed  → button appears (bot picture, blue glow ring, green dot,
 *   exactly like the reference image) and the popup opens in "ready" state.
 * - STOP pressed   → popup closes and the floating button disappears.
 * - Tapping the button toggles the popup manually while running.
 * - Scanner Execute streams trade logs into the popup via
 *   window.triggerExecutionToast(…) even when the robot is idle.
 */

type LogLine = { text: string; kind: "cmd" | "info" | "ok" | "last" };

const READY_LINES: LogLine[] = [
  { text: "is ready to execute trades", kind: "info" },
  { text: "Select pair and press Scan", kind: "cmd" },
];

declare global {
  interface Window {
    /** Kept for compatibility: no-op — popup state is driven by the app store. */
    showBotStarted?: (name?: string, status?: "started" | "stopped") => void;
    /** Open the popup and stream execution logs for a scanned pair. */
    triggerExecutionToast?: (name?: string, image?: string, pairData?: { symbol: string; lot_size: string | number; max_trades: number }) => void;
    closeExecutionToast?: () => void;
  }
}

export default function DraggableBotPopup() {
  const app = useAppState();
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];
  const running = robot?.running ?? false;
  const eaName = robot?.name ?? "My EA";
  const eaImage = robot?.image || "/botlogic-mascot.png";

  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [state, setState] = useState<"ready" | "executed">("ready");
  const prevRunning = useRef(running);

  // Draggable position — fixed coordinates from the viewport, default bottom-right.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const btnRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const SIZE = 64;

  const defaultPos = () => ({
    x: (typeof window !== "undefined" ? window.innerWidth : 400) - SIZE - 16,
    y: (typeof window !== "undefined" ? window.innerHeight : 800) - SIZE - 96,
  });

  // START (false→true while mounted): reset to ready and pop the popup open.
  // STOP (true→false): close it. Navigating while running does NOT auto-open.
  useEffect(() => {
    if (running && !prevRunning.current) {
      setState("ready");
      setLogs([]);
      setOpen(true);
    }
    if (!running && prevRunning.current) {
      setOpen(false);
    }
    prevRunning.current = running;
  }, [running]);

  // Scanner Execute → stream the trade logs into the popup.
  useEffect(() => {
    window.triggerExecutionToast = (name?: string, _image?: string, pairData?: { symbol: string; lot_size: string | number; max_trades: number }) => {
      const p = pairData ?? { symbol: "XAUUSD", lot_size: 0.01, max_trades: 5 };
      const stream: LogLine[] = [
        { text: `NEW SIGNAL: ${p.symbol} BUY`, kind: "cmd" },
        { text: `OPEN BUY: ${p.symbol} ${p.lot_size}`, kind: "cmd" },
        { text: "TP: 4330.36 | SL: 4260.01", kind: "info" },
        { text: `SENDING ${p.max_trades} TRADES TO MT5...`, kind: "info" },
        { text: `${p.max_trades}/${p.max_trades} TRADES EXECUTED ON MT5`, kind: "last" },
      ];
      setState("executed");
      setLogs([]);
      setOpen(true);
      stream.forEach((line, index) => {
        window.setTimeout(() => setLogs((prev) => (prev.some((existing) => existing.text === line.text && existing.kind === line.kind) ? prev : [...prev, line])), index * 500);
      });
    };
    window.closeExecutionToast = () => setOpen(false);
    // Live MT5 outcome — arrives on the event bus so this popup shows the real
    // result alongside the top execution toast (no single-slot overwrite).
    const onExecutionResult = (event: Event) => {
      const result = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      setLogs((prev) => {
        const base = prev.filter((line) => line.kind !== "last");
        return [...base, { text: result.ok ? `✔ ${result.message.toUpperCase()}` : `✖ ${result.message.toUpperCase()}`, kind: result.ok ? "last" : "info" }];
      });
    };
    window.addEventListener("eamp:execution-result", onExecutionResult);
    // Compatibility no-op — visibility is store-driven now.
    window.showBotStarted = () => {};
    return () => {
      delete window.triggerExecutionToast;
      delete window.closeExecutionToast;
      window.removeEventListener("eamp:execution-result", onExecutionResult);
      delete window.showBotStarted;
    };
  }, []);

  // Pointer-drag anywhere on the button; a tap (no movement) toggles the popup.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pos ?? defaultPos();
    dragOffset.current = { x: event.clientX - start.x, y: event.clientY - start.y };
    movedRef.current = false;
    setPos(start);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const width = typeof window !== "undefined" ? window.innerWidth : 400;
    const height = typeof window !== "undefined" ? window.innerHeight : 800;
    const next = {
      x: clamp(event.clientX - dragOffset.current.x, 4, width - SIZE - 4),
      y: clamp(event.clientY - dragOffset.current.y, 4, height - SIZE - 4),
    };
    const start = pos ?? defaultPos();
    if (Math.abs(next.x - start.x) > 3 || Math.abs(next.y - start.y) > 3) movedRef.current = true;
    setPos(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    // A genuine tap (no drag) toggles the popup; a drag does not.
    if (!movedRef.current) setOpen((value) => !value);
  };

  // The floating BUTTON only exists while the robot is running, but the popup
  // must always be able to appear (scanner Execute shows it even when idle).
  if (!running && !open) return null;

  const style: React.CSSProperties = {
    ...(pos
      ? { left: pos.x, top: pos.y }
      : { right: 16, bottom: 96 }),
    position: "fixed" as const,
    touchAction: "none",
    border: "3px solid #2E5BFF",
    boxShadow: "0 0 18px rgba(46,91,255,0.75), 0 0 36px rgba(46,91,255,0.35)",
  };

  return (
    <>
      {/* Floating bot button — blue glow ring + green dot, draggable anywhere */}
      <div
        ref={btnRef}
        role="button"
        tabIndex={0}
        aria-label={`${eaName} running — open trade log`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setOpen((value) => !value);
        }}
        style={style}
        className={`z-[9998] flex size-[64px] select-none items-center justify-center rounded-full bg-[#0A0F1E] transition-transform ${
          dragging ? "scale-110 cursor-grabbing" : "cursor-grab"
        }`}
      >
        <img src={eaImage} alt={eaName} className="size-full rounded-full object-cover" />
        <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-black bg-green-500 shadow-[0_0_8px_#22c55e]" />
      </div>

      {/* 320px popup with EA header + trade log */}
      {open && (
        <div
          role="dialog"
          aria-label={`${eaName} trade log`}
          className="fixed bottom-[172px] right-3 z-[9999] w-[320px] max-w-[calc(100vw-24px)] animate-[popUp_0.25s_ease] overflow-hidden rounded-[20px] border-2 border-[#A020F0] bg-[#0A0A1A] shadow-[0_0_30px_rgba(160,32,240,0.5)]"
        >
          {/* EA image header */}
          <div className="relative h-[220px] w-full bg-black">
            <img src={eaImage} alt={eaName} className="size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
            <button
              type="button"
              aria-label="Close trade log"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
            >
              ✕
            </button>
            <div className="absolute inset-x-4 bottom-3">
              <h2 className="text-[20px] font-black leading-tight text-white drop-shadow-[0_2px_4px_black]">{eaName}</h2>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="size-3 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                <span className="text-[12px] font-bold tracking-widest text-green-400">SERVER CONNECTED</span>
              </div>
            </div>
          </div>

          {/* Terminal trade log */}
          <div className="min-h-[110px] bg-[#0F172A] p-4 font-mono text-[12px] leading-[22px]">
            {state === "ready" ? (
              READY_LINES.map((line, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-gray-500">{">"}</span>
                  <span className={line.kind === "cmd" ? "text-gray-400" : "text-white"}>
                    {line.kind === "info" ? `${eaName} ${line.text}` : line.text}
                  </span>
                </div>
              ))
            ) : (
              logs.map((log, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-gray-600">{">"}</span>
                  <span className={log.kind === "last" ? "font-bold text-green-400" : "text-gray-300"}>{log.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes popUp{from{transform:translateY(15px) scale(0.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}`}</style>
    </>
  );
}
