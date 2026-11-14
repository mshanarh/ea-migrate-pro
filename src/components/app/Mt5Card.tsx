import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { BRIDGE_KEY, getBridgeUrl } from "@/lib/bridge-client";

/**
 * THE MT5 VIP CARD + LIVE OPEN ORDERS.
 *
 * Everything here is ACCENT-DRIVEN: the rim, the glow, the avatar ring, the
 * active badge and the refresh control all read the one colour the trader
 * picked in Settings (`useCustomization()` → accentColorValue). There is no
 * static purple/pink anywhere, so the card follows the interface colour like
 * the rest of the app.
 *
 * ONE ACCOUNT ONLY. This is a single-account surface — no Account 2 tab, no
 * switcher. The card shows the saved login and the pill names Account 1.
 */

export type Mt5Robot = { name?: string | undefined; image?: string | undefined };

const CARD_GRADIENT = "linear-gradient(135deg, rgba(20,20,28,0.92) 0%, rgba(10,10,14,0.98) 100%)";

const last4 = (loginId: string) => {
  const digits = loginId.replace(/\s+/g, "");
  return digits.length <= 4 ? digits : digits.slice(-4);
};

/**
 * THE 3D VIP CARD — tap anywhere to flip.
 *
 * Framer Motion rotates the plate on Y; each face keeps `backface-visibility:
 * hidden` so the reverse side never shows through. The settings button is
 * inside the front face and stops propagation, so tapping it opens the
 * connect form instead of flipping.
 */
export function Mt5Card({
  accent,
  robot,
  loginId,
  server,
  onOpenSettings,
}: {
  accent: string;
  robot: Mt5Robot | undefined;
  loginId: string;
  server: string;
  onOpenSettings: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const portrait = robot?.image || "/logo.png";
  const robotName = robot?.name || "YOUR ROBOT";

  const faceStyle = {
    background: CARD_GRADIENT,
    border: `1.5px solid ${accent}`,
    boxShadow: `0 0 32px ${accent}33, inset 0 0 18px ${accent}14`,
    backfaceVisibility: "hidden" as const,
  };

  return (
    <div className="w-full max-w-md [perspective:1400px]">
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Show the front of the account card" : "Show the back of the account card"}
        onClick={() => setFlipped((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setFlipped((value) => !value);
          }
        }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
        className="relative w-full min-h-[215px] cursor-pointer select-none rounded-[24px] outline-none [aspect-ratio:1.586/1]"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* ---------------- FRONT ---------------- */}
        <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[24px] p-5" style={faceStyle}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="" className="size-7 rounded-lg object-contain" />
              <span className="text-[13px] font-black tracking-[0.22em] text-white">
                EA <span style={{ color: accent }}>MIGRATE</span>
              </span>
            </div>
            <button
              type="button"
              aria-label="Account settings"
              onClick={(event) => {
                event.stopPropagation();
                onOpenSettings();
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
              style={{ boxShadow: `0 0 14px ${accent}26` }}
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.3em] text-white/45 uppercase">Account 1</p>
              <p className="mt-1 truncate text-lg font-black tracking-wide text-white">{robotName}</p>
              <p className="mt-0.5 text-[11px] font-semibold tracking-[0.18em] text-white/50">{loginId}</p>
            </div>
            <span
              className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={{ border: `2px solid ${accent}`, boxShadow: `0 0 22px ${accent}66` }}
            >
              <img src={portrait} alt="" className="size-full object-cover" />
            </span>
          </div>

          <p className="text-center text-[10px] font-bold tracking-[0.25em] text-white/50">TAP TO FLIP</p>
        </div>

        {/* ---------------- BACK ---------------- */}
        <div
          className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[24px] p-5"
          style={{ ...faceStyle, transform: "rotateY(180deg)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-white/80">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
              <span className="truncate">• {server}</span>
            </span>
            <span
              className="shrink-0 rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.2em]"
              style={{ borderColor: `${accent}80`, color: accent, boxShadow: `0 0 14px ${accent}22` }}
            >
              MT5
            </span>
          </div>

          <div>
            {/* Gold EMV chip with its circuitry lines. */}
            <div className="relative h-8 w-11 overflow-hidden rounded-lg border border-amber-200/50 bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600">
              <span aria-hidden className="absolute inset-y-1.5 left-[45%] w-px bg-amber-700/60" />
              <span aria-hidden className="absolute top-1/2 left-0 h-px w-2 bg-amber-700/60" />
              <span aria-hidden className="absolute top-1/2 right-0 h-px w-2 bg-amber-700/60" />
              <span aria-hidden className="absolute top-[22%] left-2 h-[1px] w-3 bg-amber-100/70" />
              <span aria-hidden className="absolute bottom-[22%] left-2 h-[1px] w-3 bg-amber-100/70" />
            </div>
            <p className="mt-3 font-mono text-[15px] font-bold tracking-[0.22em] text-white/80">
              •••• {last4(loginId)}
            </p>
          </div>

          <p className="text-center text-[10px] font-bold tracking-[0.25em] text-white/50">TAP TO FLIP BACK</p>
        </div>
      </motion.div>
    </div>
  );
}

/* ───────────────────────── live open orders ───────────────────────── */

type OpenPosition = {
  ticket: number;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  price_open: number;
  price_current: number;
  sl: number;
  tp: number;
  profit: number;
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asPosition = (row: unknown): OpenPosition | null => {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const ticket = asNumber(record["ticket"]);
  const symbol = typeof record["symbol"] === "string" ? record["symbol"] : "";
  const type = record["type"] === "BUY" || record["type"] === "SELL" ? record["type"] : null;
  if (ticket === null || !symbol || !type) return null;
  return {
    ticket,
    symbol,
    type,
    volume: asNumber(record["volume"]) ?? 0,
    price_open: asNumber(record["price_open"]) ?? 0,
    price_current: asNumber(record["price_current"]) ?? 0,
    sl: asNumber(record["sl"]) ?? 0,
    tp: asNumber(record["tp"]) ?? 0,
    profit: asNumber(record["profit"]) ?? 0,
  };
};

/** Prices need their real precision: 5 digits on FX, 2 on indices/crypto. */
const formatPrice = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(Math.abs(value) >= 100 ? 2 : 5) : "—";

/** Signed money line — the sign is the signal, so it is always shown. */
const formatMoney = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** The password saved on this device at LINK time (the bridge needs it). */
function readDevicePassword(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem("mt_password") ?? "";
  } catch {
    return "";
  }
}

/**
 * LIVE OPEN ORDERS — polls `POST /positions/list` while the ORDERS tab is on
 * screen. Nothing is cached and nothing is invented: a failed call shows the
 * reason with a refresh button, an empty account says so plainly.
 */
export function Mt5OpenOrders({
  accent,
  connected,
  loginId,
  server,
}: {
  accent: string;
  connected: boolean;
  loginId: string;
  server: string;
}) {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const mounted = useRef(true);
  const hasPassword = readDevicePassword().length > 0;
  const active = connected && hasPassword;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!active) return;
    const password = readDevicePassword();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const reply = await fetch(`${getBridgeUrl()}/positions/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
        body: JSON.stringify({
          credentials: { login: Number(loginId) || loginId, password, server },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await reply.json().catch(() => null)) as
        | { success?: boolean; positions?: unknown[]; message?: string }
        | null;
      if (!mounted.current) return;
      if (!reply.ok || payload?.success === false) {
        setError(
          payload?.message ??
            (reply.ok ? "The broker did not return your orders." : `The bridge answered HTTP ${reply.status}.`),
        );
        return;
      }
      const rows = Array.isArray(payload?.positions) ? payload.positions : [];
      setPositions(rows.map(asPosition).filter((row): row is OpenPosition => row !== null));
      setUpdatedAt(Date.now());
    } catch (failure) {
      if (!mounted.current) return;
      const name = (failure as Error | undefined)?.name;
      setError(
        name === "TimeoutError"
          ? "The trading server did not answer within 15 seconds."
          : "Could not reach the trading server — check the connection and that the bridge is running.",
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [active, loginId, server]);

  // Poll only while this view is mounted (it lives inside the ORDERS tab).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = window.setTimeout(tick, 15_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, refresh]);

  const totalProfit = positions.reduce((sum, position) => sum + position.profit, 0);
  const netPositive = totalProfit >= 0;

  if (!active) {
    return (
      <div className="if-well rounded-[28px] border p-6 text-center">
        <p className="text-sm font-semibold text-white/60">Connect an account to see its orders.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="if-muted text-[10px] font-bold tracking-[0.3em] uppercase">
          Open orders{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh open orders"
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-[0.12em] disabled:opacity-50"
          style={{ borderColor: `${accent}59`, color: accent, backgroundColor: `${accent}0f` }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          REFRESH
        </button>
      </div>

      {error && (
        <div className="rounded-[24px] border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200/90">
          {error}
        </div>
      )}

      {positions.length > 0 && (
        <div
          className="rounded-[24px] border p-4"
          style={{ borderColor: `${accent}40`, background: `${accent}0d`, boxShadow: `0 0 24px ${accent}1f` }}
        >
          <p className="text-[10px] font-bold tracking-[0.3em] text-white/45 uppercase">Floating P&amp;L</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className={`text-2xl font-black ${netPositive ? "text-emerald-400" : "text-rose-400"}`}>
              {formatMoney(totalProfit)}
            </p>
            <p className="text-xs font-bold text-white/50">
              {positions.length} {positions.length === 1 ? "position" : "positions"}
            </p>
          </div>
        </div>
      )}

      {positions.length === 0 && !loading && !error ? (
        <div className="if-well rounded-[28px] border p-6 text-center">
          <p className="text-sm font-semibold text-white/60">No open orders currently running on this account.</p>
        </div>
      ) : null}

      {positions.map((position) => {
        const isBuy = position.type === "BUY";
        const flashing = position.profit >= 0;
        return (
          <div key={position.ticket} className="if-well rounded-[24px] border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-black tracking-wide text-white">{position.symbol}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-black tracking-[0.16em] ${
                      isBuy ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {position.type}
                  </span>
                  <span className="text-[11px] font-semibold text-white/50">{position.volume} lot</span>
                </div>
              </div>
              <p className={`shrink-0 text-base font-black ${flashing ? "text-emerald-400" : "text-rose-400"}`}>
                {formatMoney(position.profit)}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <p className="font-bold tracking-[0.14em] text-white/35 uppercase">Open</p>
                <p className="font-mono font-semibold text-white/80">{formatPrice(position.price_open)}</p>
              </div>
              <div>
                <p className="font-bold tracking-[0.14em] text-white/35 uppercase">Current</p>
                <p className="font-mono font-semibold text-white/80">{formatPrice(position.price_current)}</p>
              </div>
            </div>

            {(position.sl > 0 || position.tp > 0) && (
              <div className="mt-2 flex items-center gap-4 text-[11px]">
                {position.sl > 0 && (
                  <p className="text-white/50">
                    SL <span className="font-mono font-semibold text-rose-300">{formatPrice(position.sl)}</span>
                  </p>
                )}
                {position.tp > 0 && (
                  <p className="text-white/50">
                    TP <span className="font-mono font-semibold text-emerald-300">{formatPrice(position.tp)}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default Mt5Card;
