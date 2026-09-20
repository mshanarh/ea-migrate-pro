import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { BrandLogo } from "@/components/BrandLogo";
import { CustomizationDrawer } from "@/components/app/CustomizationDrawer";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { activateKey, removeRobot, setActiveRobot, syncRobotsFromPortal, toggleRobot, useAppState } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { speakBot } from "@/lib/bot-voice";
import { executeLiveTrade } from "@/lib/metaapi";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Robot Dashboard — EA Migrate Pro" },
      { name: "description", content: "Control your licensed Forex robots." },
    ],
  }),
  component: AppHome,
});

function AddRobotModal({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setKey("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">Add robot</DialogTitle>
          <DialogDescription className="text-sm text-white/55">
            Paste the HOST ROBOT KEY from your email to activate this device.
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-2 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const cleaned = key.trim().toUpperCase();
            if (!cleaned) {
              toast.error("Enter your HOST ROBOT KEY.");
              return;
            }
            onSubmit(cleaned);
            setKey("");
          }}
        >
          <input
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            placeholder="EMP-XXXXXXXXXXXX"
            aria-label="Host robot key"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 font-mono text-sm tracking-[0.18em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-white/30 focus:border-[#FFA500]/70"
          />
          <button
            type="submit"
            className="h-14 w-full rounded-2xl bg-gradient-to-b from-[#FFA500] to-[#CC7A00] text-base font-black text-black shadow-[0_0_36px_rgba(255,165,0,0.35)] transition-transform active:scale-[0.99]"
          >
            ACTIVATE ROBOT
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
      <BrandLogo
        className="relative size-24 rounded-[24px] object-cover"
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
        style={{ animation: "welcomeUp 0.3s ease-out 0.3s both" }}
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

  // Pull the mentor's latest EA data (symbols, image, video) into the activated
  // robots whenever the home screen mounts — portal edits appear instantly.
  useEffect(() => {
    syncRobotsFromPortal();
  }, []);

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

  const handleSubmit = (key: string) => {
    const result = activateKey(key);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.robot?.name ?? "Robot"} activated on this device`);
    setModalOpen(false);
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
    // Live execution fires in the background on the user's own connected MT5
    // account; it never blocks START. Without a connected account it is a no-op.
    if (!app.mt?.mcAccountId) return;
    const firstPair = robot.pairs?.[0];
    const symbol = firstPair?.symbol ?? robot.symbols[0] ?? "XAUUSD";
    void executeLiveTrade({
      data: {
        accountId: app.mt.mcAccountId,
        eaName: robot.name,
        symbol,
        direction: "BUY",
        lotSize: String(firstPair?.lotSize ?? 0.01),
      },
    })
      .then((result) => {
        if (!result.ok) console.warn("[start] live execution skipped:", result.message);
      })
      .catch(() => {});
  };

  const handleQuotes = () => {
    if (!robot) return;
    toast.info(`Quotes for ${robot.name} are on the way.`);
  };

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
      onTouchEnd={onTouchEnd}
    >
      <div className="app-scroll-area">
      <main className="flex w-full flex-col gap-4 pb-36">
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
