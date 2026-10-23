import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { refreshRobotConfigs, useAppState } from "@/lib/app-store";

/**
 * THE HONEST "WHERE THESE SYMBOLS CAME FROM" LINE.
 *
 * The symbol list is refreshed from the server by licence key. When that fetch
 * succeeds the note shows WHEN; when it fails the last known list stays on
 * screen and the note says it is an offline copy, with its date. Never a
 * silent snapshot, never a blocked screen.
 */
export function EaConfigNote({ className = "" }: { className?: string }) {
  const app = useAppState();
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];
  const [busy, setBusy] = useState(false);
  if (!robot) return null;

  const at = robot.configUpdatedAt ? new Date(robot.configUpdatedAt) : null;
  const stamp = at && !Number.isNaN(at.getTime()) ? at.toLocaleString() : null;
  const label = robot.configStale
    ? stamp
      ? `Offline copy · last updated ${stamp}`
      : "Offline copy · not synced yet"
    : stamp
      ? `Symbols updated ${stamp}`
      : "Symbols not synced yet";

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshRobotConfigs();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="ea-config-note"
      className={`flex items-center justify-between gap-3 px-3 ${className}`}
    >
      <span className="if-muted text-[10px] font-semibold tracking-wide">{label}</span>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        data-testid="button-refresh-ea-config"
        className="if-chip if-text flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide uppercase disabled:opacity-60"
      >
        <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} /> Refresh
      </button>
    </div>
  );
}
