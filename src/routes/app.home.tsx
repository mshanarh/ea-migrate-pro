import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Play, Plus, Trash2, Waves } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppTabBar } from "@/components/AppTabBar";
import {
  activateKey,
  removeRobot,
  toggleRobot,
  useAppState,
  type Robot,
} from "@/lib/app-store";

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

type AddRobotModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (key: string) => void;
};

function AddRobotModal({ open, onOpenChange, onSubmit }: AddRobotModalProps) {
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

type RobotCardProps = {
  robot: Robot;
  onStart: (eaName: string) => void;
  onQuotes: (eaName: string) => void;
  onRemove: (eaName: string) => void;
};

function RobotCard({ robot, onStart, onQuotes, onRemove }: RobotCardProps) {
  const eaName = robot.name;
  const imageSrc = robot.image || "/ea-migrate-platform-robot.jpg";

  const actions = [
    { label: "START", icon: Play, onClick: () => onStart(eaName) },
    { label: "QUOTES", icon: Waves, onClick: () => onQuotes(eaName) },
    { label: "REMOVE", icon: Trash2, onClick: () => onRemove(eaName) },
  ];

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      aria-label={eaName}
      className="relative w-full overflow-hidden rounded-[32px] bg-[#0a0a0a]"
    >
      <img src={imageSrc} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.25)_38%,rgba(0,0,0,0.86)_78%,rgba(0,0,0,0.95)_100%)]" />

      <div className="relative flex min-h-[430px] flex-col items-center justify-end px-4 pb-8 pt-4">
        <div className="absolute top-4 left-4 flex flex-col items-center gap-3">
          <button
            type="button"
            aria-label="Chat with support"
            className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
          >
            <MessageCircle className="size-5" />
          </button>
          <span className="relative flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur-sm">
            <img src="/botlogic-mascot.png" alt="" className="size-full rounded-full object-cover" />
            <span className="absolute -bottom-0.5 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-black bg-[#22C55E]" />
          </span>
        </div>

        <h1 className="text-center text-3xl font-black tracking-[0.08em] text-white uppercase">
          {eaName}
        </h1>

        <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-2">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="group flex flex-col items-center gap-2 py-1"
            >
              <Icon className="size-9 text-[#FFA500] transition-transform duration-200 group-hover:scale-110" strokeWidth={2.2} />
              <span className="text-xs font-bold tracking-[0.14em] text-[#FFA500]">{label}</span>
            </button>
          ))}
        </div>

        <p className="mt-7 text-[11px] font-semibold tracking-[0.3em] text-white/45 uppercase">
          Powered by Ea migrate
        </p>
      </div>
    </motion.section>
  );
}

function AppHome() {
  const app = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  const handleSubmit = (key: string) => {
    const result = activateKey(key);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.robot?.name ?? "Robot"} activated on this device`);
    setModalOpen(false);
  };

  const handleStart = (eaName: string) => {
    if (!robot) return;
    toggleRobot(robot.id);
    toast.success(
      app.robots.find((candidate) => candidate.id === robot.id)?.running
        ? `${eaName} stopped`
        : `${eaName} started`,
    );
  };

  const handleQuotes = (eaName: string) => {
    toast.info(`Quotes for ${eaName} are on the way.`);
  };

  const confirmRemove = (eaName: string) => {
    if (!robot) return;
    const confirmed = window.confirm(`Remove ${eaName} from this device?`);
    if (!confirmed) return;
    removeRobot(robot.id);
    toast.success(`${eaName} removed`);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 pt-8 pb-36">
        {robot ? (
          <RobotCard
            robot={robot}
            onStart={handleStart}
            onQuotes={handleQuotes}
            onRemove={confirmRemove}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.03] p-10 text-center"
          >
            <span className="flex size-16 items-center justify-center rounded-3xl bg-[#FFA500]/15">
              <Plus className="size-8 text-[#FFA500]" />
            </span>
            <h1 className="mt-5 text-2xl font-black tracking-tight">No robot yet</h1>
            <p className="mt-2 text-sm text-white/55">
              Add your HOST ROBOT KEY to bring your EA onto this device.
            </p>
          </motion.div>
        )}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex h-24 w-full items-center gap-5 rounded-[32px] bg-gradient-to-b from-[#FFA500] to-[#CC7A00] px-7 text-left shadow-[0_14px_44px_rgba(255,165,0,0.4)] transition-transform active:scale-[0.98]"
        >
          <Plus className="size-9 shrink-0 text-white" strokeWidth={2.6} />
          <span className="flex flex-col">
            <span className="text-xl font-black tracking-wide text-white">ADD ROBOT</span>
            <span className="text-xs font-semibold tracking-[0.22em] text-white/80">HOST ROBOT KEY</span>
          </span>
        </button>
      </main>

      <AddRobotModal open={modalOpen} onOpenChange={setModalOpen} onSubmit={handleSubmit} />
      <AppTabBar />
    </div>
  );
}
