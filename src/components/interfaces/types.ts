import type { Robot } from "@/lib/app-store";

export type InterfaceProps = {
  active: Robot;
  mentorName: string;
  eaName: string;
  robots: Robot[];
  license?: { key?: string; name?: string } | null;
  onStart: () => void;
  onRemove: () => void;
  onSelectBot: (id: string) => void;
  onOpenBotModal: () => void;
  onOpenPairs: () => void;
  onOpenScanner: () => void;
};

export function robotImage(robot: Robot) {
  return robot.image || "/ea-migrate-platform-robot.jpg";
}
