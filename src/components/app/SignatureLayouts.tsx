import { motion } from "framer-motion";
import {
  Bot,
  House,
  Info,
  Pause,
  Play,
  Plus,
  ScanLine,
  Server,
  Trash2,
  TrendingUp,
  User,
  Waves,
  Wifi,
  Volume2,
  Battery,
  Clock,
  ArrowRight,
  Scan,
} from "lucide-react";
import type { Robot } from "@/lib/app-store";
import { RobotMedia } from "@/components/app/RobotMedia";
import { PoweredBadge } from "@/components/app/ThemeContent";

/** ---------- shared chrome helpers ---------- */

function StatsBar({ robot }: { robot: Robot | undefined }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
      <span>12:11</span>
      <span className="flex items-center gap-1.5">
        <Volume2 className="size-3" style={{ color: "#22C55E" }} />
        Mute
      </span>
      <span className="flex items-center gap-1">
        <Wifi className="size-3" style={{ color: "#22C55E" }} />
        5G
      </span>
      <span className="flex items-center gap-1">
        <ScanLine className="size-3" style={{ color: "#22C55E" }} />
        Wi-Fi
      </span>
      <span className="flex items-center gap-1">
        <Battery className="size-3" style={{ color: "#22C55E" }} />
        70
      </span>
    </div>
  );
}

function BottomNav({ onOpenScanner }: { onOpenScanner: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1 pb-2 pt-4">
      {[
        { icon: Server, label: "Metatrader" },
        { icon: House, label: "Home", active: true },
        { icon: Scan, label: "Scanner" },
      ].map(({ icon: Icon, label, active }) => (
        <button
          key={label}
          type="button"
          onClick={
            active
              ? () => undefined
              : onOpenScanner
          }
          className="flex flex-1 flex-col items-center justify-center gap-1 rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors"
          style={{
            backgroundColor: active ? "rgba(34,197,94,0.12)" : "transparent",
            color: active ? "#22C55E" : "#9CA3AF",
            borderColor: active ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.06)",
          }}
        >
          <Icon
            className="size-5"
            style={{ color: active ? "#22C55E" : "#9CA3AF" }}
          />
          <span className="text-[9px] font-black tracking-[0.18em]" style={{ color: active ? "#22C55E" : "#9CA3AF" }}>
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

function DollerDecor({ count = 14 }: { count?: number }) {
  const coords = [];
  for (let i = 0; i < count; i++) {
    coords.push({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
    });
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {coords.map((c) => (
        <span
          key={c.id}
          className="absolute h-3 w-3 animate-ping select-none"
          style={{
            left: c.left,
            top: c.top,
            background: "rgba(34,197,94,0.85)",
            borderRadius: "999px",
            boxShadow: "0 0 8px rgba(34,197,94,0.9)",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SNIPER  —  "WARMING THE ZERO"                                       */
/* ------------------------------------------------------------------ */

export function Sniper(props: {
  robot: Robot | undefined;
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
}) {
  const { robot, onStart, onQuotes, onRemove, onOpenScanner, onOpenAdd } = props;
  const image = robot?.image || "/logo.png";
  const running = robot?.running ?? false;

  return (
    <div className="flex flex-col gap-5">
      <StatsBar robot={robot} />

      <div className="relative flex min-h-[60vh] w-full flex-col justify-end pb-8">
        {/* EA-picture background: full-bleed, no hardcoded black */}
        <RobotMedia
          image={image}
          video={robot?.video}
          variant="hero"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0.85) 100%)",
          }}
        />

        <div className="relative mx-auto w-full max-w-[96%] px-4">
          <h1
            className="mx-auto max-w-full break-words text-center text-3xl font-black uppercase leading-tight text-white sm:text-4xl"
            style={{
              fontFamily: "'Orbitron', 'Fira Code', sans-serif",
              textShadow: "0 2px 22px rgba(0,0,0,0.95)",
            }}
          >
            {robot?.name ?? "SNIPER KILLER EA V2.0"}
          </h1>
          <p
            className="mt-2 text-sm font-bold tracking-[0.34em] uppercase"
            style={{ color: "#22C55E" }}
          >
            {robot?.running ? "RUNNING" : "WARMING THE ZERO"}
          </p>
        </div>
      </div>

      <DollerDecor count={18} />

      {/* START / QUOTES / REMOVE — green rounded pill */}
      <div className="flex items-center justify-center gap-3">
        {[
          { label: "START", icon: Play },
          { label: "QUOTES", icon: Waves },
          { label: "REMOVE", icon: Trash2 },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={
              label === "START"
                ? onStart
                : label === "QUOTES"
                ? onQuotes
                : onRemove
            }
            className="flex items-center gap-2 rounded-[28px] border border-white/10 bg-black/40 px-7 py-3 text-sm font-black uppercase tracking-[0.22em] text-white backdrop-blur-sm transition-all duration-200 hover:bg-black/60 hover:shadow-[0_0_24px_rgba(34,197,94,0.35)] active:scale-[0.97]"
            style={{
              boxShadow: `0 0 20px ${running && label === "START" ? "rgba(34,197,94,0.55)" : "rgba(34,197,94,0.10)"}`,
            }}
          >
            <Icon
              className="size-5"
              style={{ color: "#22C55E" }}
            />
            <span
              className="text-xs font-black tracking-[0.18em]"
              style={{ color: running && label === "START" ? "#22C55E" : "#9CA3AF" }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <PoweredBadge accent="#22C55E" />
      </div>

      {/* Scanner card */}
      <button
        type="button"
        onClick={onOpenScanner}
        className="flex items-center justify-between gap-4 rounded-[28px] border-2 p-5 text-left"
        style={{
          borderColor: "#E11D48",
          backgroundColor: "rgba(225,29,72,0.08)",
          boxShadow: "0 0 28px rgba(225,29,72,0.18)",
        }}
      >
        <span className="flex items-center gap-4">
          <span
            className="flex size-12 items-center justify-center rounded-2xl bg-black"
            style={{ border: "2px solid rgba(34,197,94,0.55)" }}
          >
            <ScanLine className="size-6" style={{ color: "#22C55E" }} />
          </span>
          <span>
            <span className="block text-base font-black tracking-wide text-white">
              SNIPER TRACKER
            </span>
            <span className="block text-sm text-white/55">
              Auto executes the winning trigger
            </span>
          </span>
        </span>
        <Info className="size-5 shrink-0" style={{ color: "#22C55E" }} />
      </button>

      <BottomNav onOpenScanner={onOpenScanner} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PHOENIX — rise-from-the-embers                                       */
/* ------------------------------------------------------------------ */

export function Phoenix(props: {
  robot: Robot | undefined;
  onStart: () => void;
  onQuotes: () => void;
  onRemove: () => void;
  onOpenScanner: () => void;
  onOpenAdd: () => void;
}) {
  const { robot, onStart, onQuotes, onRemove, onOpenScanner, onOpenAdd } = props;
  const image = robot?.image || "/logo.png";
  const running = robot?.running ?? false;

  return (
    <div className="relative flex min-h-[62vh] w-full flex-col items-center justify-center gap-7 overflow-hidden px-5">
      {/* Cyberpunk dark background with scattered green $ icons */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 25%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.94) 100%), #0A0A0A",
        }}
      />
      <DollerDecor count={22} />

      <div className="relative flex flex-col items-center">
        {/* Red-black robotic face avatar — bright neon-green glowing border */}
        <div className="relative flex size-48 items-center justify-center">
          <div
            className="flex size-44 items-center justify-center overflow-hidden rounded-full border-4 bg-black"
            style={{
              borderColor: "rgba(34,197,94,0.95)",
              boxShadow: "0 0 48px rgba(34,197,94,0.65), 0 0 110px rgba(34,197,94,0.30)",
            }}
          >
            <RobotMedia
              image={image}
              video={robot?.video}
              variant="avatar"
              preferImage
              className="size-full rounded-full object-cover"
            />
          </div>
          {running && (
            <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-[#22C55E] px-3 py-1 text-[9px] font-black tracking-[0.2em] text-black">
              <span className="size-1.5 rounded-full bg-black" />
              LIVE
            </span>
          )}
        </div>

        <p className="mt-7 text-sm font-bold tracking-[0.34em] text-white/60 uppercase">
          YOU&apos;RE TRADING WITH
        </p>
        <h1
          className="mx-auto mt-2 max-w-full break-words text-center text-4xl font-black leading-tight text-white uppercase sm:text-5xl"
          style={{
            fontFamily: "'Orbitron', 'Fira Code', sans-serif",
            textShadow: "0 0 34px rgba(34,197,94,0.70)",
          }}
        >
          {robot?.name ?? "SNIPER KILLER EA V2.0"}
        </h1>
      </div>

      {/* "Powered by Ea migrate" pill — black semi-transparent + white border */}
      <div className="flex justify-center">
        <span
          className="inline-flex items-center rounded-full border border-white/20 bg-black/45 px-7 py-2.5 text-sm font-black uppercase tracking-[0.14em]"
          style={{
            backdropFilter: "blur(10px)",
            boxShadow: "0 0 24px rgba(34,197,94,0.18)",
          }}
        >
          <span className="text-white/80">Powered by</span>{" "}
          <span className="text-[#22C55E] font-bold">Ea migrate</span>
        </span>
      </div>

      {/* START / QUOTES / REMOVE — three circular neon-green buttons */}
      <div className="flex items-center justify-center gap-4">
        {[
          { label: "Start", icon: Play },
          { label: "Quotes", icon: Waves },
          { label: "Remove", icon: Trash2 },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={
              label === "Start"
                ? onStart
                : label === "Quotes"
                ? onQuotes
                : onRemove
            }
            className="flex size-22 flex-col items-center justify-center gap-2 rounded-full border-2 border-white/10 bg-black/40 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 active:scale-95"
            style={{
              borderColor: "#22C55E",
              boxShadow: `0 0 26px ${running && label === "Start" ? "rgba(34,197,94,0.75)" : "rgba(34,197,94,0.25)"}`,
            }}
          >
            <Icon className="size-6" style={{ color: "#22C55E" }} />
            <span
              className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: "#E5E7EB" }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>

      <BottomNav onOpenScanner={onOpenScanner} />
    </div>
  );
}
