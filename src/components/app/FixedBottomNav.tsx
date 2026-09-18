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

/** Any mounted robot video ref (idb-video:*, data:, http:) we can detect. */
function robotHasVideo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("eamp.app.v3");
    if (!raw) return false;
    const state = JSON.parse(raw) as { robots?: { video?: string }[] };
    return (state.robots ?? []).some((robot) => typeof robot.video === "string" && robot.video.length > 0);
  } catch {
    return false;
  }
}

/**
 * The one and only bottom navigation for the EA Migrate Pro app.
 * Floating pill: centered, 90% width, accent glow, fixed 20px from the bottom.
 * It never changes with the interface theme — themes only swap the top content.
 *
 * HOME has a special gesture: pressing it twice starts the robot's uploaded
 * video playing (the tap itself unlocks mobile autoplay). The request is
 * timestamped, so it still wins when the first press navigates and remounts
 * the home screen.
 */
export function FixedBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const lastHomeTap = useRef<number>(0);

  const handleHomeClick = () => {
    // The Link's SPA navigation still runs — module state (the request
    // timestamp) survives it, so a remounted home screen can pick the
    // playback request up via wasPlaybackRequestedRecently().
    const now = Date.now();
    const isDoubleTap = now - lastHomeTap.current < 800;
    lastHomeTap.current = now;

    if (isDoubleTap) {
      requestVideoPlayback();
      toast.success(robotHasVideo() ? "Playing your video" : "No robot video yet — your mentor can upload one");
    } else {
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
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={active ? "page" : undefined}
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
