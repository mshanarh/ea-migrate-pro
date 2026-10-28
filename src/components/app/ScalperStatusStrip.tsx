import { RefreshCw, Server } from "lucide-react";
import type { ScalperDaemonStatus } from "@/lib/scalper-bridge";

/**
 * THE DAEMON'S REAL STATE, ON THE HOME SCREEN.
 *
 * Scalper mode is run by scalper_daemon.py on the VPS, so "is the scalper on?"
 * can only be answered by GET /scalper/status. This strip renders exactly that
 * answer — running/idle, the daemon's own version banner, the symbols it is
 * cycling and its latest log line — plus the honest error when the bridge
 * cannot be reached. It never invents a local state.
 */
export function ScalperStatusStrip({
  status,
  error,
  busy,
  onRefresh,
  className = "",
}: {
  status: ScalperDaemonStatus | null;
  error: string | null;
  busy: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const running = status?.running === true;
  const label = error ? "BRIDGE UNREACHABLE" : status === null ? "CHECKING…" : running ? "RUNNING" : "IDLE";
  const dotColor = error ? "#f97316" : running ? "#22c55e" : "rgba(255,255,255,0.35)";
  const detail = error
    ? error
    : status
      ? running
        ? [
            status.symbols.length > 0 ? status.symbols.join(", ") : "no symbol reported",
            status.lot !== null && status.trades !== null
              ? `${status.lot} × ${status.trades}`
              : null,
            status.positions > 0 ? `${status.positions} position(s)` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : status.message || "Waiting for /scalper/start"
      : "Reading GET /scalper/status…";

  return (
    <div
      data-testid="scalper-status-strip"
      data-running={running ? "true" : "false"}
      className={`flex flex-col gap-1 px-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Server className="size-3 shrink-0 if-muted" />
          <span className="if-muted shrink-0 text-[10px] font-black tracking-wide uppercase">
            Scalper daemon
          </span>
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] font-black tracking-wide uppercase"
            style={{ color: dotColor }}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: dotColor, boxShadow: running ? `0 0 8px ${dotColor}` : "none" }}
            />
            {label}
          </span>
          {status?.version ? (
            <span className="if-chip if-text shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide uppercase">
              v{status.version}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh scalper daemon status"
          data-testid="button-refresh-scalper-status"
          className="if-chip if-text flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide uppercase disabled:opacity-60"
        >
          <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} /> Status
        </button>
      </div>
      <p className="if-muted line-clamp-2 text-[10px] leading-relaxed">{detail}</p>
    </div>
  );
}
