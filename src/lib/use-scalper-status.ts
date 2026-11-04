import { useCallback, useEffect, useState } from "react";
import { getAppState, toggleRobot } from "./app-store";
import { recordExecutionResult, setExecutionStage } from "./execution-state";
import { EXECUTION_EVENT, type ExecutionResultDetail } from "./execution-events";
import { fetchScalperStatus, type ScalperDaemonStatus } from "./scalper-bridge";

/**
 * THE VPS DAEMON, WATCHED FROM WHEREVER THE TRADER IS.
 *
 * Scalper mode runs on the VPS, so the START/STOP button can only follow
 * GET /scalper/status. This hook is that poll — every 3 s while a scalper run
 * is on screen and every 10 s otherwise (visible tab only), plus immediately
 * on focus — and it keeps the local `running` flag honest when the daemon
 * disagrees (a stop from another device, a daemon that died, a run resumed
 * after a reload).
 *
 * THE FILLS COME FROM THE SAME READ. The daemon writes the legs it really has
 * on the broker's book (ticket, side, volume, entry, stop, target) into its
 * state file, and /scalper/status serves them. Each leg that appears there for
 * the first time is announced on `eamp:execution-result` — the exact bus the
 * normal-mode engine uses — so the top toast, the floating popup, the Android
 * bubble and the trade card all react to a daemon trade the way they react to a
 * browser trade. That is why the running poll is 3 s: a 10 s gap would hide
 * executions that already happened.
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

/** A running scalper is polled fast — the fills ride on this read. */
const RUNNING_POLL_MS = 3_000;
const IDLE_POLL_MS = 10_000;

/** Tickets already announced, so a poll can never toast the same fill twice. */
const announcedFills = new Set<string>();
let announcedRun: string | null = null;

/**
 * ANNOUNCE THE LEGS THAT ARE NEW SINCE THE LAST POLL.
 *
 * The run key (start time + symbols) resets the memory when a fresh run starts,
 * so the first poll of a new run announces the fills that run really has open —
 * including after a reload. A leg that is still open from an earlier poll is
 * silent: the same ticket is never announced twice.
 *
 * Returns how many fills were announced, so the caller can leave the stage line
 * on the confirmed trade instead of overwriting it with "RUNNING" in the same
 * pass.
 */
function announceFills(status: ScalperDaemonStatus): number {
  const runKey = `${status.startedAt ?? ""}|${status.symbols.join(",")}`;
  if (runKey !== announcedRun) {
    announcedRun = runKey;
    announcedFills.clear();
  }
  let announced = 0;
  const perBatch = new Map<number, number>();
  for (const fill of status.fills) {
    if (announcedFills.has(fill.ticket)) continue;
    announcedFills.add(fill.ticket);
    announced += 1;
    // Legs are numbered inside their own batch — a second cycle starts again
    // at TRADE 1/n instead of pretending to be trade 7 of 5.
    const batch = fill.batch ?? 0;
    const index = (perBatch.get(batch) ?? 0) + 1;
    perBatch.set(batch, index);
    const total = status.trades;
    const detail: ExecutionResultDetail = {
      ok: true,
      status: "executed",
      message: total !== null ? `TRADE ${index}/${total} EXECUTED` : "TRADE EXECUTED",
      symbol: fill.symbol,
      ...(fill.side ? { side: fill.side } : {}),
      ...(fill.lots !== null ? { lotSize: fill.lots } : {}),
      ...(fill.entry !== null ? { entry: fill.entry } : {}),
      ...(fill.stopLoss !== null ? { stopLoss: fill.stopLoss } : {}),
      ...(fill.takeProfit !== null ? { takeProfit: fill.takeProfit } : {}),
      orderId: fill.ticket,
      index,
      ...(total !== null ? { total } : {}),
    };
    // The toast, the floating popup and the Android bubble listen on the bus…
    window.dispatchEvent(new CustomEvent(EXECUTION_EVENT, { detail }));
    // …and the card's own store is fed directly, so a card that was not open
    // still shows the confirmed fill the moment it is opened.
    recordExecutionResult(detail);
  }
  return announced;
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
      // A SCALPER RUN'S STATUS LINE TELLS THE TRUTH — including "the server
      // did not answer" — instead of keeping whatever it said last. This is
      // the same poll that owns the START button.
      if (activeRunKind === "scalper") {
        setExecutionStage(`Scalper status unreadable — ${result.error}`);
      }
      return;
    }
    setStatus(result.status);
    setError(null);
    // A CONFIRMED FILL IS THE FIRST THING THE TRADER SEES — the card already
    // shows it (announceFills fed the store), so the RUNNING line must not
    // overwrite it in the same pass.
    const announced = announceFills(result.status);
    // RUNNING / STOPPED, straight from the daemon, every poll — a stale
    // "Analyzing…" cannot survive the next one.
    if (activeRunKind === "scalper" && announced === 0) {
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
            }${result.status.positions > 0 ? ` · ${result.status.positions} open` : ""}`
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
    let cancelled = false;
    let timer = 0;

    // A CHAINED TIMER, NOT A FIXED INTERVAL: the gap is chosen after every read
    // from the CURRENT run kind, so starting or stopping the scalper changes the
    // cadence immediately instead of on the next re-render.
    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(tick, activeRunKind === "scalper" ? RUNNING_POLL_MS : IDLE_POLL_MS);
    };

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        schedule();
        return;
      }
      void read().finally(schedule);
    };

    tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void read().finally(schedule);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [read]);

  const refresh = useCallback(() => {
    void read();
  }, [read]);

  return { status, error, refresh };
}
