import { Link } from "@tanstack/react-router";
import type { ScalperDaemonStatus } from "@/lib/scalper-bridge";

/**
 * THE QUIET ONE: a dot, the daemon's state and its version.
 *
 * The home screen used to carry a full status card with a STATUS button and the
 * daemon's raw log line. All of that moved to the MetaTrader screen; what stays
 * here is a single unobtrusive pill that answers "is the scalper on?" at a
 * glance and opens the detail when tapped.
 */
export function ScalperStatusPill({
  status,
  error,
}: {
  status: ScalperDaemonStatus | null;
  error: string | null;
}) {
  const running = status?.running === true;
  const label = error ? "OFFLINE" : status === null ? "…" : running ? "RUNNING" : "IDLE";
  const color = error ? "#f97316" : running ? "#22c55e" : "rgba(255,255,255,0.4)";

  return (
    <Link
      to="/app/metatrader"
      data-testid="scalper-status-pill"
      data-running={running ? "true" : "false"}
      aria-label={`Scalper daemon ${label}${status?.version ? `, version ${status.version}` : ""} — open status`}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-black tracking-[0.12em] uppercase"
      style={{ color }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: running ? `0 0 6px ${color}` : "none" }}
      />
      {label}
      {status?.version ? <span className="if-muted ml-0.5">v{status.version}</span> : null}
    </Link>
  );
}
