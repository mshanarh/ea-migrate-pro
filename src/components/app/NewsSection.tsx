import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { fetchUpcomingNews, type NewsEvent } from "@/lib/news.server";

/**
 * Settings → News & Predictions.
 *
 * Shows the upcoming economic calendar (the news that moves the market) with
 * the consensus forecast for each release and a plain-language prediction of
 * what it means. Data is the public ForexFactory weekly calendar, fetched
 * through a server function and cached for 5 minutes.
 */

const IMPACT_STYLE: Record<string, { bg: string; label: string }> = {
  High: { bg: "rgba(255,68,68,0.16)", label: "HIGH" },
  Medium: { bg: "rgba(255,170,40,0.16)", label: "MED" },
  Low: { bg: "rgba(120,200,255,0.14)", label: "LOW" },
  Holiday: { bg: "rgba(255,255,255,0.1)", label: "HOLIDAY" },
};

function countdownLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return "now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function NewsSection({ accent }: { accent: string }) {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(() => {
    setState("loading");
    fetchUpcomingNews()
      .then((res) => {
        setEvents(res.events);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/45">Upcoming market-moving news with predictions</p>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh news"
          className="flex size-8 items-center justify-center rounded-full border border-white/10 text-white/60 transition-transform active:scale-95"
        >
          <RefreshCw className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} />
        </button>
      </div>

      {state === "error" && (
        <p className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="size-4 shrink-0" /> Couldn't load the calendar. Tap refresh to
          try again.
        </p>
      )}

      {state === "ready" && events.length === 0 && (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/40">
          No upcoming releases this week.
        </p>
      )}

      {events.map((event) => {
        const style = IMPACT_STYLE[event.impact] ?? { bg: "rgba(120,200,255,0.14)", label: "LOW" };
        const countdown = countdownLabel(event.date);
        const soon = countdown === "now" || countdown.endsWith("m");
        return (
          <div
            key={event.id}
            className="rounded-[22px] border border-white/[0.06] bg-[#121212] px-4 py-3.5"
            style={
              soon ? { borderColor: `${accent}55`, boxShadow: `0 0 18px ${accent}14` } : undefined
            }
          >
            <div className="flex items-center gap-2">
              <span
                className="rounded-md px-1.5 py-0.5 text-[9px] font-black tracking-wider"
                style={{
                  background: style.bg,
                  color:
                    event.impact === "High"
                      ? "#ff7676"
                      : event.impact === "Medium"
                        ? "#ffc46b"
                        : "#9ccfff",
                }}
              >
                {style.label}
              </span>
              <span className="text-[11px] font-bold text-white/85">{event.currency || "—"}</span>
              <span
                className="ml-auto flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: soon ? accent : "rgba(255,255,255,0.45)" }}
              >
                <Clock className="size-3" />
                {soon ? `in ${countdown}` : timeLabel(event.date)}
              </span>
            </div>
            <p className="mt-1.5 text-[15px] font-black text-white">{event.title}</p>
            <p className="mt-0.5 text-[11px] text-white/45">
              Forecast <span className="font-bold text-white/75">{event.forecast || "n/a"}</span>
              {" · "}Previous{" "}
              <span className="font-bold text-white/75">{event.previous || "n/a"}</span>
            </p>
            <p
              className="mt-2 rounded-xl px-3 py-2 text-[12px] leading-relaxed text-white/70"
              style={{ background: `${accent}0d`, borderLeft: `2px solid ${accent}` }}
            >
              {event.prediction}
            </p>
          </div>
        );
      })}

      <p className="pt-1 text-center text-[11px] text-white/35">
        Calendar data: ForexFactory weekly schedule · forecasts are market consensus, not
        guarantees.
      </p>
    </div>
  );
}
