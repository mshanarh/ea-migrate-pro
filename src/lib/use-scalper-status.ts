import { useCallback, useEffect, useState } from "react";
import { getAppState, toggleRobot } from "./app-store";
import { setExecutionStage } from "./execution-state";
import { fetchScalperStatus, type ScalperDaemonStatus } from "./scalper-bridge";

/**
 * THE VPS DAEMON, WATCHED FROM WHEREVER THE TRADER IS.
 *
 * Scalper mode runs on the VPS, so the START/STOP button can only follow
 * GET /scalper/status. This hook is that poll — every 10 s while the tab is
 * visible, and immediately on focus — and it keeps the local `running` flag
 * honest when the daemon disagrees (a stop from another device, a daemon that
 * died, a run resumed after a reload).
 *
 * THE UI ONLY READS IT. The home screen shows a tiny pill; the MetaTrader
 * screen shows the full detail (symbols strip, STATUS button, last log line).
 * Polling, the button correction and the daemon calls are identical on both
 * because they all come from here.
 */

/** Which run owns the START button right now. */
let activeRunKind: "scalper" | "normal" | null = null;

/** Set by the start/stop handlers in app.home.tsx. */
export function setActiveRunKind(kind: "scalper" | "normal" | null): void {
  activeRunKind = kind;
}

export function getActiveRunKind(): "scalper" | "normal" | null {
  return activeRunKind;
}

export type ScalperDaemonView = {
  status: ScalperDaemonStatus | null;
  error: string | null;
  /** Re-read the daemon now (the STATUS button). */
  refresh: () => void;
};

export function useScalperDaemonStatus(): ScalperDaemonView {
  const [status, setStatus] = useState<ScalperDaemonStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const result = await fetchScalperStatus();
    if (!result.ok) {
      setStatus(null);
      setError(result.error);
      // A SCALPER RUN'S STATUS LINE TELLS THE TRUTH — including "the bridge
      // did not answer" — instead of keeping whatever it said last. This is
      // the same 10-second poll that owns the START button.
      if (activeRunKind === "scalper") {
        setExecutionStage(`Scalper status unreadable — ${result.error}`);
      }
      return;
    }
    setStatus(result.status);
    setError(null);
    // RUNNING / STOPPED, straight from the daemon, every 10 seconds — a
    // stale "Analyzing…" cannot survive the next poll.
    if (activeRunKind === "scalper") {
      setExecutionStage(
        result.status.running
          ? `Scalper RUNNING — ${
              result.status.symbols.length > 0
                ? result.status.symbols.join(", ")
                : "symbols not reported"
            }${
              result.status.lot !== null && result.status.trades !== null
                ? ` · ${result.status.lot} × ${result.status.trades}`
                : ""
            }`
          : `Scalper STOPPED — ${result.status.message || "the daemon is idle"}`,
      );
    }
    // A NORMAL (browser) RUN OWNS THE BUTTON — never fight it.
    if (activeRunKind === "normal") return;
    const state = getAppState();
    const target =
      state.robots.find((candidate) => candidate.id === state.activeRobotId) ?? state.robots[0];
    if (!target || target.running === result.status.running) return;
    toggleRobot(target.id);
  }, []);

  useEffect(() => {
    void read();
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void read();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [read]);

  const refresh = useCallback(() => {
    void read();
  }, [read]);

  return { status, error, refresh };
}
