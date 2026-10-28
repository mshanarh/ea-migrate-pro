import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { ThemeContent } from "@/components/app/ThemeContent";
import { CustomizationDrawer } from "@/components/app/CustomizationDrawer";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { TradeExecutionToast } from "@/components/app/TradeExecutionToast";
import { TradeAnalysisPopup } from "@/components/app/TradeAnalysisPopup";
import { EaConfigNote } from "@/components/app/EaConfigNote";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { invalidateAccessCache, peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { activateKey, appSignOut, getAppState, hasPendingLicense, refreshRobotConfigs, removeRobot, setActiveRobot, syncRobotsFromCloudPortal, syncRobotsFromPortal, toggleRobot, useAppState, type Robot } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { usePlatform } from "@/lib/platform";
import { speakBot, stopBotVoice, unlockBotVoice } from "@/lib/bot-voice";
import { isVideoActive, toggleVideoPlayback } from "@/lib/video-playback";
import { setExecutionStage, startExecution, stopExecution, updateExecutionPlan } from "@/lib/execution-state";
import { classifyNoTrade, executeAutoTrade, readMtCredentials, resolveTradeDirection, safeTradeCount, type TradeDecision } from "@/lib/auto-trade";
import { startScalpLoop, type BotMode, type ScalpLoopHandle } from "@/lib/scalp-loop";
import { beginBotSession, notifyBotStarted, notifyBotStopped } from "@/lib/bot-notify";
import {
  fetchScalperStatus,
  planFromAllowedQuotes,
  startScalperOnBridge,
  stopScalperOnBridge,
  type ScalperDaemonStatus,
} from "@/lib/scalper-bridge";
import { ScalperStatusStrip } from "@/components/app/ScalperStatusStrip";

/**
 * ONE QUIET RE-CHECK FOR AN ACTIVATED DEVICE — see the `undecided` branch below.
 *
 * The cloud gave NO verdict (timeout / error). That is not the ledger saying
 * "unpaid", so this device keeps the screen and asks once more a few seconds
 * later instead of ejecting a customer who has already activated a key. The
 * re-check warms the gate's cache; a POSITIVE refusal after it still ejects on
 * the very next navigation, and the mid-session poll below re-runs the same
 * decision anyway.
 */
let activatedRetryScheduled = false;
function scheduleActivatedRetry(email: string | null): void {
  if (activatedRetryScheduled || typeof window === "undefined") return;
  activatedRetryScheduled = true;
  window.setTimeout(() => {
    activatedRetryScheduled = false;
    invalidateAccessCache(email);
    void requireVerifiedAccess(email).catch(() => undefined);
  }, 5_000);
}

export const Route = createFileRoute("/app/home")({
  ssr: false,
  beforeLoad: () => {
    const email = getAppState().email;
    if (email && getAppState().robots.length === 0 && hasPendingLicense(email)) {
      throw redirect({ href: "/app/login?license=1" });
    }
    // ONE RESOLUTION PER NAVIGATION — payment AND the device binding come
    // back in that ONE round trip.
    //
    // This guard used to run `resolveCloudAccess(fresh)` and then
    // `requireVerifiedAccess`, which asked the cloud AGAIN plus a device-binding
    // READ and a device-binding WRITE: four serverless round trips before the
    // dashboard could paint, on every entry. The gate now resolves once per
    // navigation and every guard in it reuses that answer — one round trip on a
    // cold cache, ZERO while a confirmed-paid answer is still fresh (see
    // CACHE_TTL_MS in @/lib/payment-gate). The verdict itself is unchanged:
    // deactivated (a revoked payment, or a cloud `revoked`) ends the session,
    // while an account the ledger has simply never marked paid keeps its
    // session and lands on the plans, so the app can walk in by itself the
    // moment the ledger agrees.
    /**
     * FIRST PAINT, NOT A NETWORK WAIT.
     *
     * `peekAccessVerdict` answers synchronously from the gate's
     * stale-while-revalidate cache (the cloud is re-asked behind the render).
     * Only a genuinely cold cache (fresh boot, or one this gate just dropped)
     * falls through to the one awaited round trip — so an in-app tap can never
     * sit behind a slow KV read again.
     */
    const apply = (access: AppAccessCheck) => {
      if (access.action === "signin") throw redirect({ href: "/app/login" });
      // Access revoked by the owner (Mark unpaid) — the gate signed the session
      // out; hand them the first page with the notice. The cached verdict is
      // dropped first, so the next ask reads the cloud and never this refusal.
      if (access.action === "deactivate") {
        invalidateAccessCache(email);
        throw redirect({ href: "/app/login?deactivated=1" });
      }
      // NO VERDICT IS NOT A REFUSAL. A paid-record source that could not be
      // READ answers `retry`, and the destination for that is the plain retry
      // line on the login screen (`?verify=1`) — never the plan chooser. An
      // activated device stays put and asks again quietly instead of losing the
      // dashboard to a store that was briefly down.
      if (access.action === "retry") {
        if (getAppState().robots.length > 0) {
          scheduleActivatedRetry(email);
          return;
        }
        invalidateAccessCache(email);
        throw redirect({ href: "/app/login?verify=1" });
      }
      if (access.action === "pay") {
        // AN ACTIVATED DEVICE IS NOT EJECTED BY A CLOUD THAT DID NOT ANSWER.
        // Only a positive unpaid/revoked verdict sends them to checkout; a
        // timeout keeps the dashboard on screen and asks again quietly.
        if (access.undecided && getAppState().robots.length > 0) {
          scheduleActivatedRetry(email);
          return;
        }
        invalidateAccessCache(email);
        throw redirect({ href: "/app/login?pay=1" });
      }
    };
    const cached = peekAccessVerdict(email);
    if (cached) {
      apply(cached);
      return;
    }
    return requireVerifiedAccess(email).then(apply);
  },
  head: () => ({
    meta: [
      { title: "Robot Dashboard — EA Migrate" },
      { name: "description", content: "Control your licensed Forex robots." },
    ],
  }),
  errorComponent: HomeErrorFallback,
  component: AppHome,
});

function AccessSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 pt-safe pb-safe-base text-white">
      <img src="/logo.png" alt="" className="size-16 rounded-2xl border border-white/10 bg-white/5 object-contain p-1" />
      <p className="text-sm font-semibold text-white/60">Checking your access…</p>
    </div>
  );
}

function HomeErrorFallback({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const handleLogout = () => {
    appSignOut();
    window.location.assign("/app/login");
  };
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 pt-safe pb-safe-base text-center text-white">
      <img src="/logo.png" alt="" className="plat-card size-16 rounded-2xl border border-white/10 bg-white/5 object-contain p-1" />
      <h1 className="mt-5 text-xl font-black tracking-tight">Dashboard didn't load</h1>
      <p className="mt-2 max-w-xs text-sm text-white/55">
        Something interrupted your robot dashboard. Try again — if it keeps happening, log out and sign back in.
      </p>
      <p className="mt-3 max-w-xs break-words text-[10px] leading-4 text-white/30">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="plat-pressable plat-control h-11 rounded-2xl bg-gradient-to-b from-[var(--accent)] to-[var(--accent-deep)] px-6 text-sm font-black text-black"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="plat-pressable plat-control h-11 rounded-2xl border border-white/15 px-6 text-sm font-bold text-white/75 transition-colors hover:text-white"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

function AddRobotModal({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (key: string) => void | Promise<void> }) {
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setKey("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 pt-safe text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">Add robot</DialogTitle>
          <DialogDescription className="text-sm text-white/55">
            Paste the HOST ROBOT KEY from your email to activate this device.
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-2 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting) return;
            const cleaned = key.trim().toUpperCase();
            if (!cleaned) {
              toast.error("Enter your HOST ROBOT KEY.");
              return;
            }
            setSubmitting(true);
            try {
              await onSubmit(cleaned);
              setKey("");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <input
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            placeholder="EMP-XXXXXXXXXXXX"
            aria-label="Host robot key"
            className="plat-field h-14 w-full border border-white/10 bg-white/[0.05] px-5 font-mono text-sm tracking-[0.18em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-white/30 focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="plat-pressable h-14 w-full bg-gradient-to-b from-[var(--accent)] to-[var(--accent-deep)] text-base font-black text-black shadow-[0_0_36px_var(--accent-soft)] disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? "ACTIVATING…" : "ACTIVATE ROBOT"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WelcomeMaster() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
    // EA NAME FIRST, THEN WELCOME — same lookup the bot popup uses (active
    // robot → first robot → "My EA"), read at announcement time from the
    // store: "Sniper Killer EA v6+. Welcome." The name is spoken EXACTLY
    // as configured — "+", spaces and version text included.
    const state = getAppState();
    const active =
      state.robots.find((candidate) => candidate.id === state.activeRobotId) ??
      state.robots[0];
    speakBot(`${active?.name ?? "My EA"}. Welcome.`);
    const timer = setTimeout(() => setShow(false), 600);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-label="Welcome"
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black"
      style={{ animation: "welcomeIn 0.25s ease-out both" }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse 70% 45% at 50% 30%, ${accent}26, transparent 70%)` }}
      />
      <img
        src="/logo.png"
        alt=""
        className="relative size-24 rounded-[24px] bg-white/5 object-contain p-1"
        style={{ boxShadow: `0 0 44px ${accent}66`, border: `2px solid ${accent}55`, animation: "welcomePop 0.45s cubic-bezier(0.22,1,0.36,1) both" }}
      />
      <h1
        className="relative mt-6 text-3xl font-black tracking-tight text-white"
        style={{ textShadow: `0 0 32px ${accent}88`, animation: "welcomeUp 0.35s ease-out 0.15s both" }}
      >
        WELCOME <span style={{ color: accent }}>MASTER</span>
      </h1>
      <p
        className="relative mt-2 text-sm font-semibold tracking-wide text-white/70"
        style={{ animation: "welcomeUp 0.3s ease-out 0.3s both", paddingBottom: "var(--sa-bottom)" }}
      >
        It&apos;s time to make money 💰
      </p>
    </div>
  );
}

/** Remembered bot mode — the last choice is the default next time. */
const BOT_MODE_KEY = "eamp.botMode.v1";
function readBotMode(): BotMode {
  try {
    const saved = window.localStorage.getItem(BOT_MODE_KEY);
    if (saved === "scalper" || saved === "normal") return saved;
  } catch {
    /* storage blocked — default below */
  }
  return "scalper";
}

function AppHome() {
  const app = useAppState();
  const { color: accentChoice } = useCustomization();
  const accent = accentColorValue(accentChoice);
  // SPA navigation for the QUOTES / SCANNER / METATRADER buttons — a
  // window.location.* call reloaded the whole document, which rebooted the
  // app and flashed the full-screen "Loading…" splash on EVERY press.
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  // The AI trade analysis card has its OWN open flag — the execution toast
  // closes itself when its sequence ends, the analysis card stays with the
  // confirmed trade until the trader dismisses it.
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const [toastSymbol, setToastSymbol] = useState("");
  // START offers the two modes; the last one chosen is the remembered default.
  const [modeOpen, setModeOpen] = useState(false);
  const [botMode, setBotMode] = useState<BotMode>(() => readBotMode());
  const scalpRef = useRef<ScalpLoopHandle | null>(null);
  // WHICH RUN OWNS THE START BUTTON — "scalper" is the VPS daemon, "normal" is
  // the browser loop. A ref because only the handlers and the status poll read it.
  const runKindRef = useRef<"scalper" | "normal" | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<ScalperDaemonStatus | null>(null);
  const [daemonError, setDaemonError] = useState<string | null>(null);
  const [scalperBusy, setScalperBusy] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  useEffect(() => {
    // The mentor's LOCAL store (empty on a client phone) and the REAL server
    // config, resolved by the activated licence key. The server is the source
    // of truth for symbols — the local store is only a fallback.
    void syncRobotsFromPortal();
    // The server config (symbols) is authoritative…
    void refreshRobotConfigs();
    // …and the legacy cloud mirror still fills in EA media for keys issued
    // before the picture travelled with the licence record.
    void syncRobotsFromCloudPortal();
  }, []);

  // Paint instantly: the route's own beforeLoad already awaited
  // requireVerifiedAccess for THIS navigation before this component mounted,
  // so the "Checking your access…" splash would only ever flash between the
  // mount paint and that same cached answer resolving. The effect below still
  // runs as the mid-session re-check — a revocation keeps redirecting out via
  // window.location.replace, and a denial never leaves the screen up.
  const [access, setAccess] = useState<"checking" | "ok">("ok");

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const verify = async () => {
      if (cancelled || running) return;
      running = true;
      let result: AppAccessCheck;
      try {
        result = await requireVerifiedAccess(app.email);
      } catch {
        // NO VERDICT IS NOT A REFUSAL. A thrown check is re-tried quietly
        // below rather than ejecting an activated session.
        result = { action: "pay", undecided: true };
      }
      running = false;
      if (cancelled) return;
      if (result.action === "pass") {
        setAccess("ok");
        return;
      }
      if (result.action === "deactivate") {
        window.location.replace("/app/login?deactivated=1");
        return;
      }
      if (result.action === "retry") {
        // A source was unreadable — retry quietly rather than eject the
        // dashboard to the plans. Nothing here grants access: the next check
        // still has to come back clean before the session is confirmed.
        scheduleActivatedRetry(app.email);
        return;
      }
      if (result.action === "pay") {
        if (result.undecided && app.robots.length > 0) {
          scheduleActivatedRetry(app.email);
          return;
        }
        window.location.replace("/app/login?pay=1");
        return;
      }
      window.location.replace("/app/login");
    };
    void verify();
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void verify();
    }, 15_000);
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      void verify();
    };
    let lastCheck = Date.now();
    const throttled = () => {
      if (Date.now() - lastCheck < 20_000) return;
      lastCheck = Date.now();
      onWake();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", throttled);
    window.addEventListener("pageshow", throttled);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", throttled);
      window.removeEventListener("pageshow", throttled);
    };
  }, [app.email]);

  /**
   * THE DAEMON IS THE TRUTH.
   *
   * Scalper mode lives on the VPS, so the start/stop button follows
   * GET /scalper/status instead of a local flag that outlives the run. While a
   * Normal (browser) run is in progress the button belongs to that run and this
   * sync stays out of its way.
   */
  const readDaemon = useCallback(async () => {
    const result = await fetchScalperStatus();
    if (!result.ok) {
      setDaemonStatus(null);
      setDaemonError(result.error);
      return;
    }
    setDaemonStatus(result.status);
    setDaemonError(null);
    if (runKindRef.current === "normal") return;
    const state = getAppState();
    const target =
      state.robots.find((candidate) => candidate.id === state.activeRobotId) ?? state.robots[0];
    if (!target || target.running === result.status.running) return;
    toggleRobot(target.id);
  }, []);

  useEffect(() => {
    void readDaemon();
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void readDaemon();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void readDaemon();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [readDaemon]);

  if (access !== "ok") return <AccessSplash />;

  // PULL DOWN → re-read the EA config from the server.
  const pull = usePullToRefresh(() => refreshRobotConfigs());
  const onTouchStart = (event: React.TouchEvent) => {
    pull.handlers.onTouchStart(event as React.TouchEvent<HTMLElement>);
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    pull.handlers.onTouchEnd();
    if (touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? null;
    if (endX !== null && touchStartX.current - endX > 70) setDrawerOpen(true);
    touchStartX.current = null;
  };

  const handleSubmit = async (key: string) => {
    const result = await activateKey(key);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.robot?.name ?? "Robot"} activated on this device`);
    setModalOpen(false);
  };

  const runConfiguredPairs = async (target: Robot) => {
    const pairs = target.pairs ?? [];
    if (pairs.length === 0) {
      toast.error("No quotes in Allowed Quotes — configure a symbol in Quotes first.");
      return;
    }

    // LIVE TRADING NEEDS THE SAVED MT5 ACCOUNT. Without the password half
    // (never leaves this device) there is nothing to place orders with, so
    // the run stops here with guidance instead of faking a filled batch.
    const credentials = readMtCredentials(app.mt);
    if (!credentials) {
      toast.message(`${target.name} is running`, {
        description:
          "Add your MT5 login, password and server on the MetaTrader page — the bot trades live with them saved.",
      });
      return;
    }

    // Calculate total trades across Allowed Quotes
    const totalTrades = pairs.reduce((sum, p) => sum + safeTradeCount(p.maxTrades), 0);
    setToastTrades(totalTrades);
    setToastSymbol(pairs[0]?.symbol ?? "");
    setToastOpen(true);
    // The AI trade analysis card opens with the run's REAL plan.
    setAnalysisOpen(true);
    const firstLot = Number(pairs[0]?.lotSize);
    startExecution({
      symbol: pairs[0]?.symbol ?? "",
      ...(Number.isFinite(firstLot) ? { lotSize: firstLot } : {}),
      totalTrades,
      robotName: target.name,
    });
    setExecutionStage("Analyzing chart trend...");

    // The floating bot popup narrates the same four steps (spec: the popup's
    // initial log lines stay in sync with the toast sequence).
    const first = pairs[0];
    if (first) {
      window.triggerExecutionToast?.(target.name, target.image, {
        symbol: first.symbol,
        lot_size: first.lotSize,
        max_trades: totalTrades,
        ...(first.direction ? { direction: first.direction } : {}),
      });
    }
    // Calm pacing: hold for 1.5s so the analysis steps finish on screen
    // before the first order is sent.
    if (totalTrades > 0) {
      await new Promise((r) => setTimeout(r, 1500));
    }

    console.log("[START DEBUG] Auto-trade starting for:", pairs[0]?.symbol ?? "", "trades:", totalTrades, "pairs:", pairs.map(p => ({sym: p.symbol, trades: p.maxTrades})));

    let opened = 0;
    let blocked = 0;
    let refused = 0;
    // The run-wide trade counter — the card and the voice say "trade 3 of 7"
    // for the WHOLE run, not per symbol.
    let tradeNumber = 0;

    for (const pair of pairs) {
      const symbol = pair.symbol.trim();
      if (!symbol) continue;

      try {
        // Credentialled analysis: the direction comes from the broker's own
        // candles (oldest→newest), not the fixture tables.
        const analysis = await resolveTradeDirection(symbol, { credentials });

        // ENTRY CONTEXT, ON THE CARD. The direction derivation is unchanged;
        // this only shows what was measured (trend, extension in ATR). It is
        // never a veto — the trade proceeds on the short-term direction.
        const gate = analysis.gate ?? null;
        if (gate) {
          updateExecutionPlan({
            trend: gate.direction,
            extensionAtr: gate.extensionAtr,
            entryGate: gate.verdict,
            entryReason: gate.summary,
          });
        }

        if (analysis.direction.type === "NO_TRADE") {
          blocked += 1;
          // NO TRADE (…) with the specific reason — a refusal the trader can
          // read (weak setup / no data / stale quote), never a vague error.
          const kind = classifyNoTrade(analysis.direction.reason);
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", {
              detail: {
                ok: false,
                message: `${symbol} NO TRADE (${kind}) — ${analysis.direction.reason}`,
                status: "blocked",
                symbol,
                robotName: target.name,
                blocked: true,
                reason: analysis.direction.reason,
              },
            }),
          );
          continue;
        }

        const direction = analysis.direction;
        const trades = safeTradeCount(pair.maxTrades);

        if (trades === 0) continue;

        // The analysed direction and levels are now KNOWN — the card shows
        // them until the broker's confirmed fill replaces them.
        const pairLot = Number(pair.lotSize);
        updateExecutionPlan({
          symbol: analysis.symbol,
          direction: direction.type,
          entry: direction.entry,
          stopLoss: direction.sl,
          takeProfit: direction.tp,
          ...(Number.isFinite(pairLot) ? { lotSize: pairLot } : {}),
        });
        setExecutionStage("Setting TP and SL...");
        setExecutionStage(`Executing ${trades} trades one by one...`);

        const result = await executeAutoTrade({
          symbol: analysis.symbol,
          lotSize: Number(pair.lotSize) || 0.01,
          maxTrades: trades,
          eaName: target.name,
          // LIVE orders on the trader's own account through the VPS bridge.
          credentials,
          onTradeExecute: (trade, index, total) => {
            tradeNumber += 1;
            const runIndex = tradeNumber;
            window.dispatchEvent(
              new CustomEvent("eamp:execution-result", {
                detail: {
                  ok: trade.status === "executed",
                  // Spec: each successful order announces itself as
                  // `TRADE {index}/{total} EXECUTED` on the event bus.
                  // Brokers are free to rewrite the order comment, so the
                  // returned comment is never compared against the robot
                  // name — the fill line stays clean.
                  message:
                    trade.status === "executed"
                      ? `TRADE ${runIndex}/${totalTrades} EXECUTED`
                      : trade.message,
                  status: trade.status,
                  symbol: trade.symbol,
                  side: trade.side === "BLOCKED" ? undefined : trade.side,
                  lotSize: trade.lotSize,
                  // The broker's own fill price for this order.
                  entry: trade.entry,
                  // Exact SL/TP executeAutoTrade sent to the bridge for this
                  // trade (read-only surfacing — no logic change). 0 on
                  // blocked rows; the popup skips zero levels when speaking.
                  stopLoss: trade.sl,
                  takeProfit: trade.tp,
                  robotName: target.name,
                  index: runIndex,
                  total: totalTrades,
                  ...(trade.meta?.mtOrderId ? { orderId: trade.meta.mtOrderId } : {}),
                },
              }),
            );
          },
        });

        const executedCount = result.filter((r) => r.status === "executed").length;
        opened += executedCount;

        if (result.some((r) => r.status === "blocked" || r.status === "failed")) {
          refused += result.filter((r) => r.status !== "executed").length;
        }
      } catch (error) {
        refused += 1;
        console.warn(`[start] ${symbol} failed:`, error);
        window.dispatchEvent(
          new CustomEvent("eamp:execution-result", {
            detail: {
              ok: false,
              message: `${symbol} FAILED — ${error instanceof Error ? error.message : "Unknown error"}`,
              status: "failed",
              symbol,
              robotName: target.name,
            },
          }),
        );
      }
    }

    if (opened > 0) {
      toast.success(
        `${target.name} opened ${opened} ${opened === 1 ? "trade" : "trades"} on MT5`,
        blocked > 0 || refused > 0
          ? { description: `${blocked} blocked, ${refused} refused — see bot log for details.` }
          : undefined,
      );
    } else if (blocked > 0) {
      toast.error(`${target.name} blocked ${blocked} symbol(s)`, {
        description: "Market conditions did not meet safety requirements. Check bot log.",
      });
    } else if (refused > 0) {
      toast.error(`${target.name} could not open any trades`, {
        description: "Check your MT5 details and the bot log for the broker's reason.",
      });
    }
  };

  /**
   * STOP — THE DAEMON FIRST, BECAUSE IT IS THE THING THAT TRADES.
   *
   * A scalper run is only over when POST /scalper/stop answered 200; the button
   * is not allowed to read "stopped" while the VPS keeps cycling. A Normal run
   * is the browser loop, so that one is halted locally.
   */
  const stopRun = async (target: Robot) => {
    if (scalperBusy) return;
    const kind: "scalper" | "normal" =
      runKindRef.current ?? (scalpRef.current ? "normal" : "scalper");
    console.info(`[bot] STOP pressed — halting the ${kind} run`);
    scalpRef.current?.stop();
    scalpRef.current = null;
    // The session is over: cut the voice off wherever it is, including any
    // lines the native engine still had queued from the last batch.
    stopBotVoice();
    stopExecution();
    setAnalysisOpen(false);
    if (kind === "scalper") {
      setScalperBusy(true);
      const result = await stopScalperOnBridge();
      setScalperBusy(false);
      if (!result.ok) {
        // The daemon may still be cycling — say so instead of clearing the button.
        console.warn(`[scalper] stop failed: ${result.error}`);
        toast.error("Could not stop the scalper daemon", { description: result.error });
        void readDaemon();
        return;
      }
    }
    runKindRef.current = null;
    if (target.running) toggleRobot(target.id);
    window.showBotStarted?.(target.name, "stopped");
    // "Bot stopped" — no outcome is claimed for the positions that stay open.
    notifyBotStopped();
    void readDaemon();
  };

  const handleStart = () => {
    if (!robot) return;
    // The START tap arms audio, so the first announcement of the run is heard.
    unlockBotVoice();
    // START/STOP SHOWS NOTHING — no toast, no popup, no voice. Only the
    // floating bubble changes state. The execution popup and its voice
    // belong to the runs below (scanner Execute / auto trading).
    if (robot.running) {
      void stopRun(robot);
      return;
    }
    // STOP ANY PREVIOUS LOOP, then ask which mode this run uses.
    scalpRef.current?.stop();
    scalpRef.current = null;
    setModeOpen(true);
  };

  /**
   * BOTH MODES RUN THE SAME LOOP.
   *   SCALPER — trade, take the profit, re-analyse, open again, non-stop.
   *   NORMAL  — open on the same short-term direction and let the broker's
   *             SL/TP manage it; re-analyses on each new M15 candle without
   *             ever force-closing a winner.
   */
  const runBotLoop = (target: Robot, mode: BotMode) => {
    console.info(`[bot] STEP 1 mode selected: ${mode} for ${target.name}`);
    const pairs = (target.pairs ?? []).filter((pair) => pair.symbol?.trim());
    if (pairs.length === 0) {
      console.warn("[bot] STEP 2 blocked: no allowed quotes");
      toast.error("No quotes in Allowed Quotes — configure a symbol in Quotes first.");
      return;
    }
    console.info(`[bot] STEP 2 quotes: ${pairs.map((pair) => pair.symbol).join(", ")}`);
    const credentials = readMtCredentials(app.mt);
    console.info(`[bot] STEP 3 MT5 credentials: ${credentials ? "saved" : "missing"}`);
    if (!credentials) {
      toast.message(`${target.name} is running`, {
        description:
          "Add your MT5 login, password and server on the MetaTrader page — the scalper trades live with them saved.",
      });
      return;
    }
    const totalTrades = pairs.reduce((sum, pair) => sum + safeTradeCount(pair.maxTrades), 0);
    // THE CARD NAMES THE MODE, so the trader always knows what is running.
    startExecution({
      symbol: pairs[0]?.symbol?.trim() ?? "",
      ...(Number.isFinite(Number(pairs[0]?.lotSize)) ? { lotSize: Number(pairs[0]?.lotSize) } : {}),
      totalTrades,
      robotName: target.name,
      mode,
    });
    // START ANALYSES FIRST — it never fires an order blindly. The card opens
    // on the waiting line and the loop keeps analysing; the moment the
    // analysis produces a valid signal the batch is sent through the bridge
    // and the run continues (Scalper re-analyses and opens again, Normal lets
    // the broker's SL/TP manage each trade) until STOP.
    setExecutionStage(`Analyzing… watching ${pairs.length} symbol${pairs.length === 1 ? "" : "s"}`);
    // THE CARD OPENS IMMEDIATELY — a run that does not show its analysis is
    // indistinguishable from a bot that never started.
    setAnalysisOpen(true);
    setToastSymbol(pairs[0]?.symbol?.trim() ?? "");
    setToastTrades(totalTrades);
    setToastOpen(true);
    console.info("[bot] STEP 4 opening the AI TRADE card and starting the loop");
    // NUMBERING RESTARTS WITH THE SESSION, before the first pass can fill an
    // order — so the loop's first confirmed trade is "Trade 1".
    beginBotSession();
    scalpRef.current = startScalpLoop({
      symbols: pairs.map((pair) => ({
        symbol: pair.symbol.trim(),
        lotSize: Number(pair.lotSize) || 0.01,
        maxTrades: safeTradeCount(pair.maxTrades),
      })),
      eaName: target.name,
      credentials,
      mode,
      // START TRADES THIS RUN BY ITSELF, exactly as it did before: the loop
      // analyses the Allowed Quotes first and opens a batch the moment a valid
      // signal forms. It does NOT hand the decision back to the trader and it
      // does NOT send anybody to the Quotes page to pick a symbol — the run
      // continues on its own, pass after pass, until STOP.
      //
      // The manual analyze → Execute card is a separate, deliberate path: it
      // lives on the symbols list and on Fundamentals, where a tap is the only
      // thing that sends an order.
      requireConfirmation: false,
    });
    console.info("[bot] STEP 5 loop started");
    // "Bot started — Scalper mode, watching BTCUSDm" (Normal lists the symbols too).
    notifyBotStarted(mode, pairs.map((pair) => pair.symbol.trim()));
    toast.success(`${target.name} — ${mode === "scalper" ? "Scalper" : "Normal"} mode`, {
      description: `Analyzing… watching ${pairs.length} symbol${pairs.length === 1 ? "" : "s"}. It opens the batch here as soon as a valid signal forms.`,
    });
  };

  /**
   * SCALPER MODE HANDS THE RUN TO THE VPS DAEMON.
   *
   * This is the WHOLE scalper start path: one POST /scalper/start carrying the
   * Allowed Quotes (symbols + lot + trade count). It deliberately does NOT start
   * the browser loop, does NOT call /trade/execute and does NOT open the
   * execution card — nothing is executed from the phone in this mode. Only a
   * 200 from the bridge flips the button and announces the run.
   */
  const startScalper = async (target: Robot) => {
    const plans = planFromAllowedQuotes(target.pairs ?? []);
    console.info(
      `[scalper] STEP 1 start → ${
        plans.map((plan) => `${plan.symbol} ${plan.lot}×${plan.trades}`).join(", ") || "no usable quote"
      }`,
    );
    if (plans.length === 0) {
      toast.error("No usable quote in Allowed Quotes", {
        description:
          "Add a symbol with a lot size and a Number of Trades above 0 in Quotes, then start again.",
      });
      return;
    }
    setScalperBusy(true);
    const result = await startScalperOnBridge(plans);
    setScalperBusy(false);
    if (!result.ok) {
      console.warn(`[scalper] start failed: ${result.error}`);
      toast.error("Scalper did not start", { description: result.error });
      return;
    }
    runKindRef.current = "scalper";
    if (!target.running) toggleRobot(target.id);
    window.showBotStarted?.(target.name, "started");
    notifyBotStarted("scalper", result.symbols);
    await readDaemon();
    toast.success(`${target.name} — Scalper started on the VPS daemon`, {
      description: `${result.symbols.join(", ")} · ${result.lot} × ${result.trades}. The daemon trades; the app only starts, stops and monitors it.`,
    });
  };

  /** Choose a mode: remembered as the default, then the run starts. */
  const chooseMode = (mode: BotMode) => {
    if (!robot) return;
    setBotMode(mode);
    try {
      window.localStorage.setItem(BOT_MODE_KEY, mode);
    } catch {
      /* storage blocked — this session still uses the choice */
    }
    setModeOpen(false);
    if (mode === "scalper") {
      // THE SCALPER IS THE DAEMON'S RUN — never a browser loop.
      void startScalper(robot);
      return;
    }
    runKindRef.current = "normal";
    toggleRobot(robot.id);
    window.showBotStarted?.(robot.name, "started");
    runBotLoop(robot, mode);
  };

  // A mode chooser left open, or a running loop, must not outlive the screen.
  useEffect(() => {
    return () => {
      scalpRef.current?.stop();
      scalpRef.current = null;
    };
  }, []);

  // The QUOTES / Symbols button lives on /app/trading-pairs (route id
  // "/app/trading-pairs"). It goes through the router now — the path is
  // matched against the route tree (no more typo'd hrefs landing on the 404)
  // and the navigation stays in the SPA instead of reloading the document.
  const handleQuotes = () => void navigate({ to: "/app/trading-pairs" });
  const handlePlayVideo = () => {
    if (!robot?.video) {
      toast.info("No robot video yet — your mentor can upload one");
      return;
    }
    toggleVideoPlayback();
    toast.success(isVideoActive() ? "Playing your video — press HOME twice to stop" : "Video stopped");
  };
  const handleRemove = () => {
    if (!robot) return;
    if (!window.confirm(`Remove ${robot.name} from this device?`)) return;
    removeRobot(robot.id);
    toast.success(`${robot.name} removed`);
  };

  return (
    <div
      className="app-fullscreen if-screen flex w-full flex-col bg-black text-white"
      onTouchStart={onTouchStart}
      onTouchMove={pull.handlers.onTouchMove}
      onTouchEnd={(event) => {
        if (touchStartX.current !== null && event.changedTouches?.length === 1) {
          const touchEnd = event.changedTouches?.[0];
          if (!touchEnd) return;
          const dx = touchStartX.current - touchEnd.clientX;
          if (dx > 70) {
            setDrawerOpen(true);
            touchStartX.current = null;
            return;
          }
        }
        touchStartX.current = null;
      }}
    >
      <div className="app-scroll-area">
        <main className="flex w-full flex-col gap-4 pt-safe pb-safe-nav">
          <EaConfigNote className="pt-1" />
          {/* THE DAEMON'S REAL STATE — read from GET /scalper/status, never a
              local flag. Scalper mode trades on the VPS, not in this tab. */}
          <ScalperStatusStrip
            status={daemonStatus}
            error={daemonError}
            busy={scalperBusy}
            onRefresh={() => void readDaemon()}
          />
          <ThemeContent
            robot={robot}
            robots={app.robots}
            onStart={() => void handleStart()}
            onQuotes={handleQuotes}
            onRemove={handleRemove}
            onOpenScanner={() => { void navigate({ to: "/app/scanner" }); }}
            onOpenSymbols={() => { void navigate({ to: "/app/metatrader" }); }}
            onSelectRobot={(id) => { setActiveRobot(id); toast.success("Robot selected"); }}
            onOpenAdd={() => setModalOpen(true)}
            onPlayVideo={handlePlayVideo}
          />
        </main>
      </div>

      <Dialog open={modeOpen} onOpenChange={setModeOpen}>
        <DialogContent className="max-w-sm border-white/10 bg-[#0d0d0d] text-white">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-black tracking-wide">Choose how {robot?.name ?? "the bot"} trades</DialogTitle>
            <DialogDescription className="text-[12px] text-white/50">
              Your last choice is remembered as the default.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 space-y-2">
            {([
              {
                mode: "scalper" as BotMode,
                title: "Scalper mode",
                body: "Hands the run to the VPS scalper daemon: it analyses the last 8 completed M15 candles, opens the batch from Allowed Quotes, closes it when the batch turns positive and repeats. The app only starts, stops and monitors it — no trade is opened from this device.",
              },
              {
                mode: "normal" as BotMode,
                title: "Normal mode",
                body: "Opens on the same short-term direction and lets the broker's SL/TP1/TP2 manage each trade — re-analysed on every new M15 candle, winners never force-closed.",
              },
            ]).map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => chooseMode(option.mode)}
                disabled={scalperBusy}
                className="w-full rounded-2xl border p-4 text-left active:scale-[0.99] disabled:opacity-60"
                style={{
                  borderColor: botMode === option.mode ? accent : "rgba(255,255,255,0.12)",
                  borderWidth: botMode === option.mode ? 2 : 1,
                  backgroundColor: botMode === option.mode ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                }}
              >
                <span className="block text-[13px] font-black text-white">{option.title}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-white/50">{option.body}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AddRobotModal open={modalOpen} onOpenChange={setModalOpen} onSubmit={handleSubmit} />

      <WelcomeMaster />
      <DraggableBotPopup />        <TradeAnalysisPopup
          isOpen={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
          robot={robot}
          scannerMode={false}
          activeRobotId={app.activeRobotId ?? ""}
        />
      <CustomizationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <FixedBottomNav />

      {/* TradeExecutionToast mounted at the bottom */}
      <TradeExecutionToast
        isOpen={toastOpen}
        onClose={() => setToastOpen(false)}
        botName={robot?.name ?? "EA"}
        totalTrades={toastTrades}
        mode="auto"
        symbol={toastSymbol}
      />
    </div>
  );
}

export default AppHome;
