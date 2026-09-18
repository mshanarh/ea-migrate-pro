import { useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { House, Server, ScanLine } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { requestVideoPlayback } from "@/lib/video-playback";

const tabs = [
  { to: "/app/metatrader", label: "METATRADER", icon: Server },
  { to: "/app/home", label: "HOME", icon: House },
  { to: "/app/scanner", label: "SCANNER", icon: ScanLine },
] as const;

/**
 * The one and only bottom navigation for the EA Migrate Pro app.
 * Floating pill: centered, 90% width, accent glow, fixed 20px from the bottom.
 * It never changes with the interface theme — themes only swap the top content.
 *
 * HOME has a special gesture: pressing it twice in quick succession starts the
 * robot's uploaded video playing (the tap itself unlocks mobile autoplay), and
 * a hint toast confirms the first press.
 */
export function FixedBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const lastHomeTap = useRef<number>(0);

  const handleHomeClick = () => {
    const now = Date.now();
    const isDoubleTap = now - lastHomeTap.current < 800;
    lastHomeTap.current = now;
    if (isDoubleTap) {
      requestVideoPlayback();
      toast.success("Playing your video");
    } else if (path !== "/app/home") {
      toast.info("Press HOME again to play your video");
    } else if (lastHomeTap.current === 0 || now - lastHomeTap.current >= 800) {
      // First press while already on HOME — hint at the gesture.
      toast.info("Press HOME again to play your video");
    }
  };

  return (
    <nav
      aria-label="App navigation"
      className="fixed bottom-5 left-1/2 z-50 w-[90%] -translate-x-1/2"
      style={{
        backgroundColor: accent,
        borderRadius: 40,
        boxShadow: `0 10px 40px ${accent}80`,
        paddingBottom: "env(safe-area-inset-bottom)",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div className="flex h-[68px] w-full items-center justify-around px-4">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = path === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              className="flex min-w-[76px] flex-col items-center justify-center gap-1"
            >
              <span
                className={`flex size-11 items-center justify-center rounded-full transition-transform duration-200 ${active ? "scale-105" : ""}`}
                style={active ? { backgroundColor: "#ffffff", color: accent } : { color: "rgba(0,0,0,0.55)" }}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              </span>
              <span
                className="text-[10px] font-black tracking-[0.14em]"
                style={{ color: active ? "#ffffff" : "rgba(0,0,0,0.5)" }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
