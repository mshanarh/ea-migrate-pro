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
 * The one and only bottom navigation for the EA Migrate app —
 * the iOS floating capsule style on EVERY platform (per owner request:
 * "restore it to the previous, like the iPhone UI"):
 * floating glass tab bar above the home indicator, rounded icons,
 * Apple-style labels, springy press.
 *
 * HOME keeps its special gesture: pressing it twice starts the robot's
 * uploaded video playing (the tap itself unlocks mobile autoplay).
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

  // ── Floating capsule tab bar (iPhone style, all platforms) ─────────────
  return (
    <nav
      aria-label="App navigation"
      className="fixed bottom-0 left-1/2 z-50 w-[min(92%,26rem)] -translate-x-1/2 plat-nav-ios"
    >
      <div
        className="flex w-full items-stretch justify-around rounded-[28px] px-2 pt-1.5"
        style={{
          backgroundColor: "rgba(18,18,20,0.88)",
          backdropFilter: "blur(24px) saturate(1.6)",
          WebkitBackdropFilter: "blur(24px) saturate(1.6)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 10px 34px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = path === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={active ? "page" : undefined}
              className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
              style={{ color: active ? accent : "rgba(255,255,255,0.45)" }}
            >
              <Icon
                className="size-[22px]"
                strokeWidth={active ? 2.5 : 2}
                // iOS tab bars fill the icon of the active tab.
                fill={active ? "currentColor" : "none"}
                fillOpacity={active ? 0.18 : 0}
              />
              <span
                className="text-[10px] font-semibold tracking-[0.06em]"
                style={{ color: active ? accent : "rgba(255,255,255,0.45)" }}
              >
                {label.charAt(0) + label.slice(1).toLowerCase()}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
