import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import type { TradeDirection } from "@/lib/execution";

export type ExecutionStatus = "scanning" | "connecting" | "executing" | "success" | "error";

export type ExecutionNotificationProps = {
  open: boolean;
  robotName: string;
  robotImage?: string;
  robotId: string;
  symbol: string;
  direction: TradeDirection;
  lotSize: string;
  status: ExecutionStatus;
  errorMessage?: string;
  onClose: () => void;
};

const statusCopy: Record<ExecutionStatus, { title: string; detail: string }> = {
  scanning: { title: "Scanning Markets...", detail: "Preparing terminal for order" },
  connecting: { title: "Connecting to trading terminal...", detail: "Waiting for provider confirmation" },
  executing: { title: "Executing order...", detail: "Submitting the confirmed trade request" },
  success: { title: "Order executed successfully", detail: "The trading provider confirmed the order" },
  error: { title: "Execution failed", detail: "The order was not confirmed by the trading provider" },
};

export function ExecutionNotification({ open, robotName, robotImage, robotId, symbol, direction, lotSize, status, errorMessage, onClose }: ExecutionNotificationProps) {
  const copy = statusCopy[status];
  const finished = status === "success" || status === "error";
  return <AnimatePresence>
    {open && <motion.section role="status" aria-live="polite" aria-label="Trade execution status" initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.24, ease: "easeOut" }} className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-md rounded-[1.75rem] border border-white/10 bg-[#0b1118]/95 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <img src={robotImage || "/ea-migrate-platform-robot.jpg"} alt="" className="size-14 shrink-0 rounded-full border border-white/15 object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-lg font-black">{robotName}</p><p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">{symbol} · {direction} · {lotSize} lots</p></div>
            <button type="button" aria-label="Close execution notification" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/15 hover:text-white"><X className="size-4" /></button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm font-bold"><span className={finished ? status === "success" ? "text-emerald-300" : "text-rose-300" : "text-cyan-300"}>{finished ? status === "success" ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" /> : <LoaderCircle className="size-5 animate-spin" />}</span><span>{copy.title}</span></div>
          <p className="mt-1 text-xs text-white/55">{copy.detail}</p>
          {status === "error" && <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-5 text-rose-100">{errorMessage || "No confirmation was received from the execution service."}</p>}
        </div>
      </div>
      <span className="sr-only">Robot ID: {robotId}</span>
    </motion.section>}
  </AnimatePresence>;
}