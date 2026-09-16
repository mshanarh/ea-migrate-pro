import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const STEP_MS = 1300; // auto-advance every 1.3s
const TRADES = 6;

type Props = {
  open: boolean;
  eaName: string;
  onClose: () => void;
};

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

/**
 * L_FX style execution popup — shown when the user taps START on any theme.
 * Black card (#0D0D0D), rounded 16px, #2A2A2A border, green spinning loader,
 * dismissible, and a stepped sequence: scan → bridge → 6 trades → finale.
 */
export function ExecutionToast({ open, eaName, onClose }: Props) {
  const [current, setCurrent] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = [
    { icon: "🔍", text: `${eaName} Scanning Markets...` },
    { icon: "📡", text: `Connecting ${eaName} to bridge...` },
    { icon: "✅", text: `${eaName} Connected` },
    ...Array.from({ length: TRADES }, (_, i) => ({
      icon: "✅",
      text: `Trade ${i + 1}/${TRADES} completed successfully`,
    })),
    { icon: "🎉", text: `${eaName} All trades live!` },
  ];

  // Reset and run the sequence each time the toast opens.
  useEffect(() => {
    if (!open) return;
    setCurrent(0);
    playTick();

    const stepper = setInterval(() => {
      setCurrent((s) => {
        if (s >= steps.length - 1) {
          clearInterval(stepper);
          return s;
        }
        playTick();
        return s + 1;
      });
    }, STEP_MS);

    return () => clearInterval(stepper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-hide one beat after the final step (X still dismisses instantly).
  useEffect(() => {
    if (!open) return;
    if (current === steps.length - 1) {
      closeTimer.current = setTimeout(onClose, STEP_MS);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className="fixed bottom-[90px] left-[2.5%] z-[9999] w-[95%] max-w-[430px]"
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
              <p className="truncate text-sm font-bold leading-tight text-white">
                {eaName} Scanning Markets...
              </p>
              <p className="mt-1 flex items-center gap-1 truncate text-[13px] text-white">
                <span>{steps[current]?.icon}</span>
                <span className="truncate">{steps[current]?.text}</span>
              </p>
            </div>

            <button
              type="button"
              aria-label="Dismiss execution status"
              onClick={onClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-white transition-transform hover:scale-105 active:scale-95"
            >
              <X className="size-4" strokeWidth={2.6} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
