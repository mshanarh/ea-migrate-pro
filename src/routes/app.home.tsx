import { useEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
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
import { activateKey, appSignOut, getAppState, hasPendingLicense, removeRobot, setActiveRobot, syncRobotsFromCloudPortal, syncRobotsFromPortal, toggleRobot, useAppState, type Robot } from "@/lib/app-store";
import { invalidateAccessCache, requireVerifiedAccess, resolveCloudAccess } from "@/lib/payment-gate";
import { paymentStatusForEmail } from "@/lib/auth-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { usePlatform } from "@/lib/platform";
import { speakBot } from "@/lib/bot-voice";
import { executeAutoTrade, resolveTradeDirection, safeTradeCount, type TradeDecision } from "@/lib/auto-trade";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  beforeLoad: async () => {
    const email = getAppState().email;
    if (email && getAppState().robots.length === 0 && hasPendingLicense(email)) {
      throw redirect({ href: "/app/login?license=1" });
    }
    if (email) {
      try {
        const cloud = await resolveCloudAccess(email, { fresh: true });
        if (cloud === "unpaid" || cloud === "revoked") {
          const revoked = cloud === "revoked" || paymentStatusForEmail(email) !== "unpaid";
          appSignOut();
          invalidateAccessCache(email);
          throw redirect({ href: revoked ? "/app/login?deactivated=1" : "/app/login?pay=1" });
        }
      } catch (error) {
        if (error && typeof error === "object" && "href" in error) throw error;
      }
    }
    const access = await requireVerifiedAccess(email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
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

function WelcomeMaster() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
    speakBot("Welcome Master. It's time to make money.");
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

function AppHome() {
  const app = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  useEffect(() => {
    void syncRobotsFromPortal();
    void syncRobotsFromCloudPortal();
  }, []);

  const [access, setAccess] = useState<"checking" | "ok">("checking");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const [toastSymbol, setToastSymbol] = useState("");

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
      if (result.action === "deactivate") {
        window.location.replace("/app/login?deactivated=1");
        return;
      }
      if (result.action === "pay") {
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

  if (access !== "ok") return <AccessSplash />;

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

  const runConfiguredPairs = async (target: Robot) => {
    const pairs = target.pairs ?? [];
    if (pairs.length === 0) {
      toast.error("No quotes in Allowed Quotes — configure a symbol in Quotes first.");
      return;
    }

    let opened = 0;
    let blocked = 0;
    let refused = 0;

    for (const pair of pairs) {
      const symbol = pair.symbol.trim();
      if (!symbol) continue;

      try {
        const analysis = await resolveTradeDirection(symbol);

        if (analysis.direction.type === "NO_TRADE") {
          blocked += 1;
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", {
              detail: {
                ok: false,
                message: `${symbol.toUpperCase()} BLOCKED — ${analysis.direction.reason}`,
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

        const result = await executeAutoTrade({
          symbol: analysis.symbol,
          lotSize: Number(pair.lotSize) || 0.01,
          maxTrades: trades,
          eaName: target.name,
          paperTrading: true,
          onTradeExecute: (trade, index, total) => {
            window.dispatchEvent(
              new CustomEvent("eamp:execution-result", {
                detail: {
                  ok: trade.status === "executed",
                  message: trade.message,
                  symbol: trade.symbol,
                  side: trade.side,
                  index,
                  total,
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
              message: `${symbol.toUpperCase()} FAILED — ${error instanceof Error ? error.message.toUpperCase() : "UNKNOWN ERROR"}`,
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

    void runConfiguredPairs(robot).catch((error: unknown) => {
      console.warn("[start] auto-trade run failed:", error);
    });
  };

  const handleQuotes = () => window.location.assign("/app/tradingpairs");
  const handleRemove = () => {
    if (!robot) return;
    if (!window.confirm(`Remove ${robot.name} from this device?`)) return;
    removeRobot(robot.id);
    toast.success(`${robot.name} removed`);
  };

  return (
    <div
      className="app-fullscreen flex w-full flex-col bg-black text-white"
      onTouchStart={onTouchStart}
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
          <ThemeContent
            robot={robot}
            robots={app.robots}
            onStart={() => void handleStart()}
            onQuotes={handleQuotes}
            onRemove={handleRemove}
            onOpenScanner={() => { window.location.assign("/app/scanner"); }}
            onOpenSymbols={() => { window.location.assign("/app/metatrader"); }}
            onSelectRobot={(id) => { setActiveRobot(id); toast.success("Robot selected"); }}
            onOpenAdd={() => setModalOpen(true)}
          />
        </main>
      </div>

      <AddRobotModal open={modalOpen} onOpenChange={setModalOpen} onSubmit={handleSubmit} />

      <WelcomeMaster />
      <DraggableBotPopup />
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
