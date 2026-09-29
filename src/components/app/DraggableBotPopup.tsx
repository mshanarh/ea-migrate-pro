import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PictureInPicture2 } from "lucide-react";
import { useAppState } from "@/lib/app-store";
import { speakBot } from "@/lib/bot-voice";
import { callNative, queryNative } from "@/lib/native-bridge";

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
    triggerExecutionToast?: (name?: string, image?: string, pairData?: { symbol: string; lot_size: string | number; max_trades: number; direction?: string; stopLoss?: string | number; takeProfit?: string | number }) => void;
    closeExecutionToast?: () => void;
  }
}

export default function DraggableBotPopup() {
  const app = useAppState();
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];
  const running = robot?.running ?? false;
  const eaName = robot?.name ?? "My EA";
  const eaImage = robot?.image || "/logo.png";

  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [state, setState] = useState<"ready" | "executed">("ready");
  const prevRunning = useRef(running);

  // ── Picture-in-Picture: the popup rendered to a canvas → video stream.
  // Android PiP floats ABOVE every other app (MetaTrader included), so the
  // bot log keeps “moving with” the trader after they leave the browser.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgCache = useRef<{ src: string; img: HTMLImageElement } | null>(null);
  const pipData = useRef({ eaName, eaImage, logs, state });
  pipData.current = { eaName, eaImage, logs, state };

  const drawPip = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const { eaName: name, eaImage: image, logs: currentLogs, state: currentState } = pipData.current;

    ctx.fillStyle = "#0A0A1A";
    ctx.fillRect(0, 0, W, H);

    // EA image header (cover-fit) — only when the cached image is ready.
    const headerH = 180;
    const paint = (img: HTMLImageElement) => {
      const scale = Math.max(W / img.width, headerH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (W - w) / 2, (headerH - h) / 2, w, h);
      const grad = ctx.createLinearGradient(0, headerH * 0.35, 0, headerH);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.95)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, headerH);
      ctx.font = "800 20px system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name.slice(0, 24), 16, headerH - 34);
      ctx.beginPath();
      ctx.arc(22, headerH - 12, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = "#4ade80";
      ctx.fillText("SERVER CONNECTED", 34, headerH - 8);
    };
    const cached = imgCache.current;
    if (cached && cached.src === image && cached.img.complete && cached.img.naturalWidth > 0) {
      paint(cached.img);
    } else {
      const img = new Image();
      img.onload = () => drawPip();
      img.src = image;
      imgCache.current = { src: image, img };
    }

    // Terminal log panel.
    ctx.fillStyle = "#0F172A";
    ctx.fillRect(0, headerH, W, H - headerH);
    const lines =
      currentState === "ready"
        ? READY_LINES.map((line) => ({
            text: line.kind === "info" ? `${name} ${line.text}` : line.text,
            kind: line.kind,
          }))
        : currentLogs;
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    lines.slice(-4).forEach((line, index) => {
      const y = headerH + 24 + index * 22;
      ctx.fillStyle = "#6b7280";
      ctx.fillText(">", 14, y);
      ctx.fillStyle = line.kind === "last" ? "#4ade80" : line.kind === "cmd" ? "#9ca3af" : "#d1d5db";
      ctx.fillText(line.text.slice(0, 42), 26, y);
    });
  }, []);

  // Stream the canvas into the (hidden, muted) video so Chrome can PiP it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || typeof canvas.captureStream !== "function") return;
    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(2);
    } catch {
      return;
    }
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  // Redraw on every log/state change plus a 1s heartbeat.
  useEffect(() => {
    drawPip();
    const id = window.setInterval(drawPip, 1000);
    return () => window.clearInterval(id);
  }, [drawPip, logs, state, eaName, eaImage]);

  /**
   * Enter PiP. Inside the Android app this calls the NATIVE bridge (window
   * floats above every app, MetaTrader included); in a browser it uses the
   * video-stream API. Must be triggered by a user gesture.
   */
  const enterPip = async () => {
    // Resolve the native bridge FRESH at call time — a cached reference can
    // be a stale injected object that throws on invocation (Android WebView
    // recreates the bridge when the activity is rebuilt).
    if (queryNative("canPip") === true) {
      callNative("enterPip");
      toast.success("Floating over apps — open MetaTrader, the bot stays on top.");
      return;
    }
    const video = videoRef.current;
    if (!video || typeof video.requestPictureInPicture !== "function") {
      toast.error("Floating over apps needs Android Chrome — the popup stays in-app here.");
      return;
    }
    try {
      await video.play();
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      await video.requestPictureInPicture();
      toast.success("Floating over apps — open MetaTrader, the bot stays on top.");
    } catch {
      toast.error("Picture-in-Picture was blocked — try again or keep the app open.");
    }
  };

  // Inside the Android app: while a bot runs, show the NATIVE chat-head
  // bubble (round avatar floating above every app — MetaTrader included).
  // Stopping the bot removes it. The popup's float button stays for PiP.
  // All bridge calls resolve window.EAMigrate FRESH and swallow stale-bridge
  // throws ("non-injected object") — see src/lib/native-bridge.ts.
  //
  // "GOES WITH ME ANYWHERE": this component is mounted on EVERY app page.
  // A route change used to unmount it and the cleanup below hid the native
  // bubble — so navigating to Fundamentals/Admin/pairs erased the floating
  // bot. The cleanup-hide is GONE: the bubble is hidden only when the bot
  // actually stops, or when the page itself closes (pagehide = app closed,
  // not an in-app navigation).
  useEffect(() => {
    const release = () => callNative("hideBubble");
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  useEffect(() => {
    if (running) {
      // "Display over other apps" denied → the native bubble can NEVER float
      // over MetaTrader. Ask once per session: one tap opens the Android
      // settings screen for this exact app (wrapper v1.4+), the user flips
      // the switch, comes back — the next START shows the bubble natively.
      if (queryNative("canOverlay") === false) {
        if (!sessionStorage.getItem("eamp.overlay.asked")) {
          sessionStorage.setItem("eamp.overlay.asked", "1");
          toast.info("The bot needs permission to float over other apps", {
            description: "Allow \"Display over other apps\" for EA Migrate — then start the bot again.",
            duration: 12000,
            action: {
              label: "Allow",
              onClick: () => callNative("requestOverlayPermission"),
            },
          });
        }
      } else {
        // Re-show on every remount (page navigation) — the native service
        // keeps the existing bubble if it is already up, so this is cheap
        // and guarantees the bubble follows the user across pages.
        callNative("showBubble", eaImage);
      }
    } else {
      callNative("hideBubble");
    }
  }, [running, eaImage]);

  // Stream the newest log line into the native bubble.
  useEffect(() => {
    const latest = logs.at(-1);
    if (latest && running) callNative("pushLog", latest.text);
  }, [logs, running]);

  // Auto-PiP stays as the browser fallback when overlays are unavailable.
  // setAutoPip is the call that crashed the dashboard when the Android
  // activity was recreated — it now runs inside the safe bridge wrapper, so
  // a stale bridge is a no-op instead of an uncaught exception.
  useEffect(() => {
    const overlayDenied = queryNative("canOverlay") === false;
    callNative("setAutoPip", running && open && overlayDenied);
    return () => {
      callNative("setAutoPip", false);
    };
  }, [running, open]);

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
    window.triggerExecutionToast = (name?: string, _image?: string, pairData?: { symbol: string; lot_size: string | number; max_trades: number; direction?: string; stopLoss?: string | number; takeProfit?: string | number }) => {
      const p = pairData ?? { symbol: "XAUUSD", lot_size: 0.01, max_trades: 5 };
      // The scanner ALWAYS sends a direction and SL/TP with the plan — no
      // placeholder signal text here; fall back only if a caller omits them.
      const direction = p.direction === "SELL" ? "SELL" : "BUY";
      // NO fake fills here — the scanner dispatches a REAL per-trade event
      // ("TRADE N EXECUTED — EA MIGRATE ✓") after each broker confirmation,
      // and those arrive via onExecutionResult below, keeping this popup,
      // the top toast and the native floating bubble perfectly in sync.
      const stream: LogLine[] = [
        { text: `NEW SIGNAL: ${p.symbol} ${direction}`, kind: "cmd" },
        { text: `OPEN ${direction}: ${p.symbol} ${p.lot_size}`, kind: "cmd" },
        p.stopLoss != null && p.takeProfit != null
          ? { text: `TP: ${p.takeProfit} | SL: ${p.stopLoss}`, kind: "info" }
          : { text: "SL/TP attached by the trade plan", kind: "info" },
        { text: `EXECUTING ${p.max_trades} TRADE${p.max_trades === 1 ? "" : "S"} ONE BY ONE...`, kind: "info" },
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
        // The log BUILDS UP: each executed trade stays as its own line
        // ("TRADE 1 EXECUTED", then "TRADE 2 EXECUTED", …) — only the bold
        // "latest" highlight moves. The native bubble mirrors the newest line.
        const demoted = prev.map((line) => (line.kind === "last" ? { ...line, kind: "ok" as const } : line));
        return [...demoted, { text: result.ok ? result.message.toUpperCase() : `✖ ${result.message.toUpperCase()}`, kind: result.ok ? ("last" as const) : ("info" as const) }];
      });
      // Speak only milestone lines (per-trade fills + the final summary),
      // not every refusal — the voice would otherwise stack up.
      if (/TRADE \d+ EXECUTED|TRADES (OPENED|EXECUTED)|TRADE OPENED/.test(result.message)) {
        speakBot(result.ok ? result.message : result.message);
      }
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
      : { right: 16, bottom: `calc(96px + var(--sa-bottom))` }),
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
          style={{ marginBottom: "var(--sa-bottom)" }}
        >
          {/* EA image header */}
          <div className="relative h-[220px] w-full bg-black">
            <img src={eaImage} alt={eaName} className="size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
            <button
              type="button"
              aria-label="Float over other apps"
              onClick={() => void enterPip()}
              className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
            >
              <PictureInPicture2 className="size-4" />
            </button>
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

      {/* Hidden PiP pipeline: canvas → video stream (Chrome floats it above apps) */}
      <canvas ref={canvasRef} width={320} height={340} className="hidden" aria-hidden />
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 size-px opacity-0"
      />
    </>
  );
}
