import { useRef, useState } from "react";
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
import { CustomizationDrawer } from "@/components/app/CustomizationDrawer";
import { activateKey, removeRobot, setActiveRobot, toggleRobot, useAppState } from "@/lib/app-store";

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

function AppHome() {
  const app = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const handleStart = () => {
    if (!robot) return;
    toggleRobot(robot.id);
    toast.success(robot.running ? `${robot.name} stopped` : `${robot.name} started`);
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
    <div className="min-h-screen bg-black text-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 pt-8 pb-40">
        <ThemeContent
          robot={robot}
          robots={app.robots}
          onStart={handleStart}
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

      <AddRobotModal open={modalOpen} onOpenChange={setModalOpen} onSubmit={handleSubmit} />
      <CustomizationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <FixedBottomNav />
    </div>
  );
}
