import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { toast } from "sonner";
import { setVideoActive, toggleVideoPlayback } from "@/lib/video-playback";

/** Double-tap on the HOME hero to play the current EA video as a full-screen
 *  background over black (toggle). The robot picture stays visible in the
 *  interface slots; a single tap or a tap outside the media pauses playback. */
function useHomeDoubleTap() {
  /** Tracks the timestamp of the most recent tap; a second tap inside the
   *  window is a double-tap (plays the video), a solitary tap or a tap
   *  outside pauses it. */
  const lastTap = useRef<number | null>(null);

  const onTap = useCallback((event: React.TouchEvent | MouseEvent) => {
    const now = Date.now();
    const wasQuick = lastTap.current !== null && now - lastTap.current < 300;
    lastTap.current = now;

    // Double-tap (two taps within 300ms) plays the background video.
    // Any single tap does NOT toggle the video.
    if (wasQuick) {
      toggleVideoPlayback();
    }
  }, []);

  useEffect(() => {
    const onTouchEnd = (event: TouchEvent) => {
      // Ignore multi-touch gestures (pinches, two-finger scrolls).
      if ((event as TouchEvent).touches.length > 1) return;
      const touch = (event as TouchEvent).changedTouches[0];
      if (!touch) return;
      onTap(touch as unknown as MouseEvent);
    };
    const onMouseUp = (event: MouseEvent) => {
      // Exclude the right-click and text-selection drags.
      if (event.button !== 0) return;
      onTap(event);
    };
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onTap]);

  // Optional mouse-level double-click as a secondary trigger.
  const onDoubleClick = useCallback((event: MouseEvent) => {
    if (event.detail === 2) toggleVideoPlayback();
  }, []);
  useEffect(() => {
    window.addEventListener("dblclick", onDoubleClick as EventListener);
    return () => window.removeEventListener("dblclick", onDoubleClick as EventListener);
  }, [onDoubleClick]);
}
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
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { activateKey, appSignOut, getAppState, removeRobot, setActiveRobot, syncRobotsFromCloudPortal, syncRobotsFromPortal, toggleRobot, useAppState, type Robot } from "@/lib/app-store";
import { invalidateAccessCache, requireVerifiedAccess, resolveCloudAccess } from "@/lib/payment-gate";
import { paymentStatusForEmail } from "@/lib/auth-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { usePlatform } from "@/lib/platform";
import { speakBot } from "@/lib/bot-voice";
import { executeAutoTrade, readMtCredentials, resolveTradeDirection, safeTradeCount } from "@/lib/auto-trade";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  beforeLoad: async () => {
    const email = getAppState().email;
    // STRICT DATABASE CHECK FIRST — an explicit `resolveCloudAccess` pass in
    // the route guard itself, not just inside the gate helper. "unpaid" here
    // is a HARD STOP: the session is ended and the person is handed to
    // /app/login?pay=1 (the Choose Plan screen). This is deliberately checked
    // before anything else can decide the route may load.
    //
    // MENTOR APPROVAL IS A DIFFERENT THING ENTIRELY. `mentor_approvals` /
    // status: "approved" lets somebody use the MENTOR LICENSES DASHBOARD
    // (/dashboard/licenses) and nothing else. It is NOT read here and it is
    // NOT read in payment-gate.ts: an account the portal approved but never
    // marked is_paid is treated as strictly UNPAID for the trading app, which
    // is exactly what this guard enforces. Only is_paid (or an active Whop
    // membership / a license key bound to the email) opens the app.
    //
    // `fresh: true` skips the cache: the whole point of this guard is to
    // re-read the database at the moment of entry, so a session that was
    // allowed a moment ago under different rules cannot slip through on a
    // remembered answer.
    if (email) {
      try {
        const cloud = await resolveCloudAccess(email, { fresh: true });
        if (cloud === "unpaid") {
          // DEACTIVATED vs NEVER PAID — the same distinction the gate makes.
          // A device still holding a paid/admin record is a session the owner
          // has since revoked ("Set unpaid"), so it gets the plain notice. A
          // never-paid account is the one that owes money and gets the plans.
          const revoked = paymentStatusForEmail(email) !== "unpaid";
          appSignOut();
          invalidateAccessCache(email);
          throw redirect({ href: revoked ? "/app/login?deactivated=1" : "/app/login?pay=1" });
        }
      } catch (error) {
        // A gated redirect is control flow, not a failure — let it through.
        // Anything else (the database unreachable) falls to
        // requireVerifiedAccess below, which fails CLOSED.
        if (error && typeof error === "object" && "href" in error) throw error;
      }
    }
    // Cloud-verified gates: no email → /app/login; an unpaid one → checkout.
    const access = await requireVerifiedAccess(email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    // Access revoked by the owner (Set unpaid in the console) — the session
    // is already signed out inside the gate; hand them the notice.
    if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
    // An EXTERNAL url is not a valid router location — `redirect({href:
    // "https://whop.com/…"})` was resolved as an app path and went nowhere,
    // which is part of why an unpaid user ended up back on the login screen
    // with nothing happening. Hand the decision to the login page instead:
    // /app/login?pay=1 renders the Choose Plan screen (monthly + lifetime).
    if (access.action === "pay") {
      throw redirect({ href: "/app/login?pay=1" });
    }
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

/** Shown while the cloud decides whether this account may use the app. */
function AccessSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 pt-safe pb-safe-base text-white">
      <img src="/logo.png" alt="" className="size-16 rounded-2xl border border-white/10 bg-white/5 object-contain p-1" />
      <p className="text-sm font-semibold text-white/60">Checking your access…</p>
    </div>
  );
}

/**
 * Dashboard-only recovery screen — a crash here never falls back to the
 * generic site error page. Offers a retry AND a clean logout: a corrupted
 * robot/local-state record is the most likely cause, so logging out (which
 * clears the app session) must always be one tap away.
 */
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
      {/* The raw message is the ONLY way to diagnose a device-specific crash
          (Android WebView bundles fail differently than desktop Chrome) — and
          it is rendered in tiny, low-contrast text so normal users ignore it. */}
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
          className="plat-pressable plat-control h-11 rounded-2xl bg-gradient-to-b from-[#FFA500] to-[#CC7A00] px-6 text-sm font-black text-black"
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
            className="plat-field h-14 w-full border border-white/10 bg-white/[0.05] px-5 font-mono text-sm tracking-[0.18em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-white/30 focus:border-[#FFA500]/70"
          />
          <button
            type="submit"
            disabled={submitting}
            className="plat-pressable h-14 w-full bg-gradient-to-b from-[#FFA500] to-[#CC7A00] text-base font-black text-black shadow-[0_0_36px_rgba(255,165,0,0.35)] disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? "ACTIVATING…" : "ACTIVATE ROBOT"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Full-screen welcome moment — greets on every app entry, flashes briefly, voice on. */
function WelcomeMaster() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Greet on every app entry — but navigating within the app re-arms nothing
    // because AppHome only mounts on /app/home, and the in-app nav never
    // remounts it. The old armed-once flow skipped the greeting entirely on
    // most entries, which felt broken.
    setShow(true);
    // Speak the greeting through the Bot Voice engine (respects its toggle).
    speakBot("Welcome Master. It's time to make money.");
    // Brief flash, then straight into the app — fast redirect, greeting still seen.
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
      {/* Ambient accent glow */}
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

function AppHome() {
  const app = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  // Double-tap on Home toggles the EA video as a full-screen background over black.
  useHomeDoubleTap();

  // Pull the mentor's latest EA data (symbols, image, video) into the activated
  // robots whenever the home screen mounts — portal edits appear instantly.
  // LOCAL store covers mentors on their own device; the CLOUD portal scan
  // covers clients (their local mentor store is empty) — this repaints
  // robots activated before the picture started travelling with activation.
  useEffect(() => {
    void syncRobotsFromPortal();
    void syncRobotsFromCloudPortal();
  }, []);

  /**
   * THE LAST LINE OF DEFENCE — nothing renders here until the cloud says this
   * account may use the app, and it keeps asking.
   *
   * beforeLoad already runs requireVerifiedAccess, but it is a single guard on
   * a single navigation: a redirect that cannot be resolved, a back/forward
   * restore, or any future caller reaching this component another way all skip
   * it. That is how an unpaid account reached the dashboard and could add a
   * robot key. This re-checks on mount and keeps the screen blank until the
   * answer is "pass".
   *
   * AND IT KEEPS CHECKING, because a one-shot mount check protects nobody who
   * already had the app open. An Android WebView or a phone home-screen app
   * that was backgrounded all day came straight back into the dashboard with a
   * session that had since been revoked. `visibilitychange`, `focus` and
   * `pageshow` all fire the moment the app is brought back to the front, on
   * both platforms, and anything short of "pass" is thrown out on the spot.
   * requireVerifiedAccess never throws and fails CLOSED — an unreachable
   * database means "pay", not "in".
   */
  const [access, setAccess] = useState<"checking" | "ok">("checking");
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const verify = async () => {
      if (cancelled || running) return;
      running = true;
      let result: { action: "pass" | "signin" | "pay" | "deactivate" };
      try {
        result = await requireVerifiedAccess(app.email);
      } catch {
        result = { action: "pay" };
      }
      running = false;
      if (cancelled) return;
      if (result.action === "pass") {
        setAccess("ok");
        return;
      }
      // DEACTIVATED — the owner set this account to unpaid while it was open.
      // The gate already signed the session out; all that is left is the door.
      if (result.action === "deactivate") {
        window.location.replace("/app/login?deactivated=1");
        return;
      }
      // UNPAID — the door, and the plans. No programmatic hop to Whop here:
      // /app/login?pay=1 renders the Choose Plan screen (monthly + lifetime)
      // and the customer picks. An automatic redirect could only guess which
      // product, and it is silently dropped in an iOS home-screen app anyway.
      if (result.action === "pay") {
        window.location.replace("/app/login?pay=1");
        return;
      }
      window.location.replace("/app/login");
    };
    void verify();
    // KEEP ASKING while this tab stays open — a deactivated account that
    // never touches the screen must still be thrown out. The gate caches a
    // paid answer for 60s, so this is at most one cheap check per minute,
    // and only while the dashboard is actually visible.
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void verify();
    }, 60_000);
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      void verify();
    };
    // Throttled: returning to the tab repeatedly must not become a request
    // storm against the database.
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

  if (access !== "ok") return <AccessSplash />;

  // Swipe left anywhere on the screen opens the customization drawer.
  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
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

  /**
   * AUTO-TRADE the robot's configured Selected Quotes on the user's own MT5
   * account through the VPS bridge.
   *
   * Each pair is executed one after another — never in parallel, because
   * brokers rate-limit bursts — and every step is announced on the
   * `eamp:execution-result` bus so the floating bot popup narrates the run.
   * A pair configured as BOTH is resolved against the market before trading;
   * a specific BUY/SELL is honoured as the user's own instruction.
   *
   * The robot is already RUNNING by the time this is called: START is a
   * toggle, and the user must not wait on a broker round-trip to see their bot
   * come alive. Failures are reported per symbol and never leave the run half
   * finished without an explanation.
   */
  const runConfiguredPairs = async (target: Robot) => {
    // ALLOWED QUOTES ONLY. `target.pairs` IS the Allowed Quotes list — the
    // symbols the user opened, set lot/direction/trade count for and pressed
    // Configure on. Nothing is ever inferred from the EA's symbol universe
    // (target.symbols), so a symbol sitting in Selected Quotes can never be
    // traded by START.
    const pairs = target.pairs ?? [];
    if (pairs.length === 0) {
      // NOTHING TO TRADE — say so instead of leaving a running bot that
      // silently does nothing, which reads as "the bot is broken".
      toast.error("No quotes in Allowed Quotes — configure a symbol in Quotes first.");
      return;
    }
    const credentials = readMtCredentials(app.mt);
    if (!credentials) {
      toast.message(`${target.name} is running`, {
        description: "Add your MT5 details to trade its quotes automatically — MetaTrader page.",
      });
      return;
    }

    let opened = 0;
    let refused = 0;
    for (const pair of pairs) {
      const symbol = pair.symbol.trim();
      if (!symbol) continue;
      try {
        const resolution = await resolveTradeDirection(symbol, pair.direction);
        const result = await executeAutoTrade({
          credentials,
          symbol,
          direction: resolution.direction,
          lot: Number(pair.lotSize) || 0.01,
          trades: safeTradeCount(pair.maxTrades),
          botName: target.name,
          ...(target.image ? { robotImage: target.image } : {}),
        });
        if (result.ok) opened += 1;
        else refused += 1;
      } catch (error) {
        refused += 1;
        console.warn(`[start] ${symbol} failed:`, error);
        window.dispatchEvent(
          new CustomEvent("eamp:execution-result", {
            detail: {
              ok: false,
              message: `${symbol.toUpperCase()} FAILED — ${
                error instanceof Error ? error.message.toUpperCase() : "UNKNOWN ERROR"
              }`,
            },
          }),
        );
      }
    }

    if (opened > 0) {
      toast.success(
        `${target.name} opened ${opened} ${opened === 1 ? "trade" : "trades"} on MT5`,
        refused > 0 ? { description: `${refused} symbol(s) were refused — see the bot log.` } : undefined,
      );
    } else if (refused > 0) {
      toast.error(`${target.name} could not open any trades`, {
        description: "Check your MT5 details and the bot log for the broker's reason.",
      });
    }
  };

  // START toggles the robot and always confirms with the draggable bot popup.
  const handleStart = () => {
    if (!robot) return;
    if (robot.running) {
      toggleRobot(robot.id);
      window.showBotStarted?.(robot.name, "stopped");
      toast.success(`${robot.name} stopped`);
      speakBot(`${robot.name} stopped. Trading closed.`);
      return;
    }
    toggleRobot(robot.id);
    window.showBotStarted?.(robot.name, "started");
    toast.success(`${robot.name} started`);
    speakBot(`${robot.name} started. Time to make money.`);
    // Live execution fires in the background on the user's own saved MT5
    // account through the VPS bridge; it never blocks START.
    // Fire-and-forget: START is a toggle and must not wait on the broker.
    // runConfiguredPairs handles and reports its own per-symbol failures.
    void runConfiguredPairs(robot).catch((error: unknown) => {
      console.warn("[start] auto-trade run failed:", error);
    });
  };

  // ── QUOTES — the QUOTES button opens the redesigned quotes page (Selected
  // Quotes / Allowed Quotes with the per-symbol Configure modal), identical
  // on iOS, Android and the web.
  const handleQuotes = () => window.location.assign("/app/trading-pairs");

  const handleRemove = () => {
    if (!robot) return;
    if (!window.confirm(`Remove ${robot.name} from this device?`)) return;
    removeRobot(robot.id);
    toast.success(`${robot.name} removed`);
  };

  return (      <div
        className="app-fullscreen flex w-full flex-col bg-black text-white"
        onTouchStart={onTouchStart}
        onTouchEnd={(event) => {
          // A quick tap pauses (stops) the background video — does NOT toggle.
          // A horizontal swipe (>70px) opens the customisation drawer.
          if (touchStartX.current !== null && event.changedTouches?.length === 1) {
            const touchEnd = event.changedTouches?.[0];
            if (!touchEnd) return;
            const dx = touchStartX.current - touchEnd.clientX;
            if (dx > 70) {
              // Horizontal swipe opens the customisation drawer.
              setDrawerOpen(true);
              touchStartX.current = null;
              return;
            }
            if (Math.abs(dx) < 70) {
              // Single tap (no horizontal movement) pauses the background video.
              setVideoActive(false);
              touchStartX.current = null;
              return;
            }
          }
          touchStartX.current = null;
        }}
      >
      <div className="app-scroll-area">
      <main className="flex w-full flex-col gap-4 pt-safe pb-safe-nav">
        <ThemeContent
          robot={robot}
          robots={app.robots}
          onStart={() => void handleStart()}
          onQuotes={handleQuotes}
          onRemove={handleRemove}
          onOpenScanner={() => {
            window.location.assign("/app/scanner");
          }}
          onOpenSymbols={() => {
            window.location.assign("/app/metatrader");
          }}
          onSelectRobot={(id) => {
            setActiveRobot(id);
            toast.success("Robot selected");
          }}
          onOpenAdd={() => setModalOpen(true)}
        />
      </main>
      </div>

      <AddRobotModal open={modalOpen} onOpenChange={setModalOpen} onSubmit={handleSubmit} />

      <WelcomeMaster />
      <DraggableBotPopup />
      <CustomizationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <FixedBottomNav />
    </div>
  );
}
