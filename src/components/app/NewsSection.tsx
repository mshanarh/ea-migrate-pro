import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock,
  Crosshair,
  Minus,
  RefreshCw,
} from "lucide-react";
import { fetchUpcomingNews, type NewsEvent, type TradeDirection } from "@/lib/news.server";

/**
 * Settings → News & Predictions.
 *
 * Shows the upcoming economic calendar (the news that moves the market) with
 * the consensus forecast, a plain-language prediction, and an **Execute**
 * button that reveals the predicted trade direction — BUY/SELL for the event
 * currency plus concrete liquid pairs with per-pair directions.
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

const DIR_META: Record<
  TradeDirection,
  { color: string; icon: typeof ArrowUpRight; label: string }
> = {
  BUY: { color: "#34d399", icon: ArrowUpRight, label: "BUY" },
  SELL: { color: "#f87171", icon: ArrowDownRight, label: "SELL" },
  NEUTRAL: { color: "#facc15", icon: Minus, label: "WAIT" },
};

function DirectionCard({ event, accent }: { event: NewsEvent; accent: string }) {
  const meta = DIR_META[event.direction];
  const Icon = meta.icon;

  return (
    <div
      className="mt-2.5 rounded-2xl border p-3"
      style={{ borderColor: `${meta.color}44`, background: `${meta.color}0d` }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: `${meta.color}1f`, color: meta.color }}
        >
          <Icon className="size-5" strokeWidth={3} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-black" style={{ color: meta.color }}>
            {event.directionHeadline}
          </span>
          <span className="block text-[10.5px] leading-snug text-white/50">
            {event.directionReason}
          </span>
        </span>
      </div>

      {event.pairs.length > 0 && (
        <div className="mt-2.5 grid gap-1.5">
          {event.pairs.map((suggestion) => {
            const pairMeta = DIR_META[suggestion.direction];
            const PairIcon = pairMeta.icon;
            return (
              <div
                key={suggestion.pair}
                className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-1.5"
              >
                <span className="text-[12px] font-bold text-white/90">{suggestion.pair}</span>
                <span
                  className="ml-auto flex items-center gap-1 text-[11px] font-black"
                  style={{ color: pairMeta.color }}
                >
                  <PairIcon className="size-3.5" strokeWidth={3} />
                  {pairMeta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/55">
        <Crosshair className="mt-0.5 size-3 shrink-0" style={{ color: accent }} />
        {event.scenarios}
      </p>
    </div>
  );
}

export function NewsSection({ accent }: { accent: string }) {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [executed, setExecuted] = useState<Record<string, boolean>>({});

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
        const open = executed[event.id] === true;
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

            {open ? (
              <DirectionCard event={event} accent={accent} />
            ) : (
              <button
                type="button"
                onClick={() => setExecuted((current) => ({ ...current, [event.id]: true }))}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-[12px] font-black tracking-wide transition-transform active:scale-[0.98]"
                style={{
                  borderColor: `${accent}55`,
                  color: accent,
                  background: `${accent}14`,
                }}
              >
                <Crosshair className="size-3.5" />
                EXECUTE PREDICTION
              </button>
            )}

            {open && (
              <button
                type="button"
                onClick={() => setExecuted((current) => ({ ...current, [event.id]: false }))}
                className="mt-2 flex w-full items-center justify-center gap-1.5 text-[11px] font-bold text-white/40"
              >
                <Check className="size-3" /> Close prediction
              </button>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-[11px] text-white/35">
        Calendar data: ForexFactory weekly schedule · predictions are consensus-based analysis, not
        financial advice.
      </p>
    </div>
  );
}
