import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const STEP_MS = 1200; // auto-advance every 1.2s
const AUTO_HIDE_MS = 8000; // toast disappears after 8s

declare global {
  interface Window {
    /** Show the execution popup. Call from any theme: window.triggerExecutionToast(eaName). */
    triggerExecutionToast?: (name?: string) => void;
    /** Hide the execution popup programmatically. */
    closeExecutionToast?: () => void;
  }
}

const TICK_SRC = "/sounds/tick.wav";

let tickAudio: HTMLAudioElement | null = null;

/** Small two-tone tick on every step. Created on a user gesture (START tap) so autoplay is allowed. */
function playTick() {
  if (typeof window === "undefined") return;
  try {
    tickAudio ??= new Audio(TICK_SRC);
    tickAudio.currentTime = 0;
    void tickAudio.play().catch(() => {
      // Autoplay blocked or file missing — stay silent.
    });
  } catch {
    // Ignore audio failures; the toast itself still runs.
  }
}

/** Resolve the active EA name: explicit argument → stored active robot → stored name → generic. */
function resolveEaName(name?: string): string {
  if (name && name.trim()) return name.trim();
  try {
    const active = JSON.parse(localStorage.getItem("activeRobot") || "{}") as { name?: string };
    if (active.name) return active.name;
    return localStorage.getItem("eaName") || "EA";
  } catch {
    return "EA";
  }
}

/**
 * L_FX style execution popup. Self-contained: mount it once per app page and any
 * theme can trigger it with window.triggerExecutionToast(eaName).
 * Black card (#0D0D0D), rounded 16px, #2A2A2A border, green spinning loader,
 * fixed above the bottom nav, dismissible, auto-hides after 8s.
 */
export default function ExecutionToast() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const [eaName, setEaName] = useState("EA");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register the global triggers once — any theme can call them.
  useEffect(() => {
    window.triggerExecutionToast = (name?: string) => {
      setEaName(resolveEaName(name));
      setCurrent(0);
      setVisible(true);
    };
    window.closeExecutionToast = () => setVisible(false);
    return () => {
      delete window.triggerExecutionToast;
      delete window.closeExecutionToast;
    };
  }, []);

  // Step sequence + auto-hide while visible.
  useEffect(() => {
    if (!visible) return;
    playTick();

    const stepper = setInterval(() => {
      setCurrent((s) => {
        if (s < 3) {
          playTick();
          return s + 1;
        }
        return s;
      });
    }, STEP_MS);

    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);

    return () => {
      clearInterval(stepper);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible]);

  if (!visible) return null;

  const steps = [
    `${eaName} Scanning Markets...`,
    "Trade 1/6 completed successfully",
    "Trade 2/6 completed successfully",
    "All trades live on MetaCopier!",
  ];

  return (
    <AnimatePresence>
      <motion.div
        key="execution-toast"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", damping: 26, stiffness: 320 }}
        className="fixed bottom-[90px] left-[2.5%] z-[99999] w-[95%] max-w-[430px]"
      >
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-2xl border border-[#2A2A2A] bg-[#0D0D0D] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.75)]"
        >
          {/* Green spinning loader in a dark-green disc */}
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0F2E1A]">
            <div className="size-7 animate-spin rounded-full border-[3px] border-[#22C55E] border-t-transparent" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{eaName} Scanning Markets...</p>
            <p className="mt-1 truncate text-[13px] text-white">
              ✅ <span>{steps[current]}</span>
            </p>
          </div>

          <button
            type="button"
            aria-label="Dismiss execution status"
            onClick={() => setVisible(false)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-white transition-transform hover:scale-105 active:scale-95"
          >
            <X className="size-4" strokeWidth={2.6} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
