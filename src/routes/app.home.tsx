import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
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
import TradeExecutionToast from "@/components/app/TradeExecutionToast";
import { CustomizationDrawer } from "@/components/app/CustomizationDrawer";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { activateKey, removeRobot, setActiveRobot, toggleRobot, useAppState } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { executeLiveTrade } from "@/lib/metacopier";

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

/** Full-screen welcome moment — plays once per app visit. */
function WelcomeMaster() {
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Once per browser session — entering the app fresh greets you.
    if (sessionStorage.getItem("eamp_welcomed")) return;
    sessionStorage.setItem("eamp_welcomed", "1");
    setShow(true);
    const timer = setTimeout(() => setShow(false), 2800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="welcome"
          role="status"
          aria-label="Welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black"
        >
          {/* Ambient accent glow */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: `radial-gradient(ellipse 70% 45% at 50% 30%, ${accent}26, transparent 70%)` }}
          />
          <motion.img
            src="/botlogic-mascot.png"
            alt=""
            initial={{ scale: 0.6, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 160, damping: 16, delay: 0.15 }}
            className="relative size-28 rounded-[28px] object-cover"
            style={{ boxShadow: `0 0 48px ${accent}66`, border: `2px solid ${accent}55` }}
          />
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5, ease: "easeOut" }}
            className="relative mt-7 text-4xl font-black tracking-tight text-white"
            style={{ textShadow: `0 0 32px ${accent}88` }}
          >
            WELCOME <span style={{ color: accent }}>MASTER</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.5, ease: "easeOut" }}
            className="relative mt-3 text-base font-semibold tracking-wide text-white/70"
          >
            It&apos;s time to make money 💰
          </motion.p>
          <motion.div
            aria-hidden
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.6, duration: 1.6, ease: "easeInOut" }}
            className="relative mt-6 h-[3px] w-40 origin-left rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AppHome() {
  const app = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

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
      return;
    }
    toggleRobot(robot.id);
    window.showBotStarted?.(robot.name, "started");
    toast.success(`${robot.name} started`);
    // Top execution toast narrates the start sequence with per-trade progress.
    const toastCount = Math.max(1, Math.min(Number(robot.pairs?.[0]?.maxTrades) || 5, 20));
    setToastTrades(toastCount);
    setToastOpen(true);
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
      <TradeExecutionToast isOpen={toastOpen} onClose={() => setToastOpen(false)} botName={robot?.name ?? "EA"} totalTrades={toastTrades} />
      <CustomizationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <FixedBottomNav />
    </div>
  );
}
