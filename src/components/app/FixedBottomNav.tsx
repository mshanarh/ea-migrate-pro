import { useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { House, Server, ScanLine } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { isVideoActive, toggleVideoPlayback } from "@/lib/video-playback";
import { useBottomNavStyle, type BottomNavStyle } from "@/lib/bottom-nav-style";

export type { BottomNavStyle };

const TABS = [
  { to: "/app/metatrader", label: "METATRADER", icon: Server },
  { to: "/app/home", label: "HOME", icon: House },
  { to: "/app/scanner", label: "SCANNER", icon: ScanLine },
] as const;

function getNavClass(style: BottomNavStyle): string {
  switch (style) {
    case "floating-pill":
      return "plat-nav-ios";
    case "icon-pill":
      return "plat-nav-icons";
    case "classic-tabs":
      return "plat-nav-classic";
    case "compact-dots":
      return "plat-nav-compact";
    default:
      return "plat-nav-ios";
  }
}

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
export function FixedBottomNav({ style }: { style?: BottomNavStyle } = {}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const lastHomeTap = useRef<number>(0);
  // Live, persisted style: selecting one in Settings re-renders every mounted
  // nav immediately (no reload), on Home, Metatrader, Quotes and Scanner.
  const storedStyle = useBottomNavStyle();
  const navStyle = style ?? storedStyle;

  const handleHomeClick = () => {
    // The Link's SPA navigation still runs — module state (the request
    // timestamp) survives it, so a remounted home screen can pick the
    // playback request up via wasPlaybackRequestedRecently().
    const now = Date.now();
    const isDoubleTap = now - lastHomeTap.current < 800;
    lastHomeTap.current = now;

    if (isDoubleTap) {
      // TOGGLE — double-press starts the background video; double-press again
      // stops it (both iOS and Android).
      if (!robotHasVideo()) {
        toast.info("No robot video yet — your mentor can upload one");
        return;
      }
      toggleVideoPlayback();
      toast.success(isVideoActive() ? "Playing your video — press HOME twice to stop" : "Video stopped");
    } else if (robotHasVideo()) {
      toast.info("Press HOME twice to play your video");
    }
  };

  const isActive = (to: string) => path === to;

  // ── Bottom nav with style support ───────────────────────────────────────
  return (
    <nav
      aria-label="App navigation"
      className={`fixed bottom-0 left-1/2 z-50 w-[min(92%,26rem)] -translate-x-1/2 transition-all duration-300 ${getNavClass(navStyle)}`}
    >
      {navStyle === "floating-pill" && (
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
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={isActive(to) ? "page" : undefined}
              className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
              style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
            >
              <Icon
                className="size-[22px]"
                strokeWidth={isActive(to) ? 2.5 : 2}
                fill={isActive(to) ? "currentColor" : "none"}
                fillOpacity={isActive(to) ? 0.18 : 0}
              />
              <span
                className="text-[10px] font-semibold tracking-[0.06em]"
                style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
              >
                {label.charAt(0) + label.slice(1).toLowerCase()}
              </span>
            </Link>
          ))}
        </div>
      )}
      {navStyle === "icon-pill" && (
        <div
          className="flex items-center justify-around rounded-full px-4 py-2"
          style={{
            backgroundColor: "rgba(18,18,20,0.85)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={isActive(to) ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-0.5"
            >
              <Icon
                className="size-[20px]"
                strokeWidth={isActive(to) ? 2.5 : 2}
                fill={isActive(to) ? "currentColor" : "none"}
                fillOpacity={isActive(to) ? 0.2 : 0}
                style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
              />
            </Link>
          ))}
        </div>
      )}
      {navStyle === "classic-tabs" && (
        <div
          className="flex w-full items-stretch justify-around rounded-none px-2"
          style={{
            backgroundColor: "rgba(18,18,20,0.95)",
            borderTop: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={isActive(to) ? "page" : undefined}
              className="flex flex-col items-center justify-center flex-1 h-full py-2"
            >
              <Icon
                className="size-[20px]"
                strokeWidth={isActive(to) ? 2.5 : 2}
                fill={isActive(to) ? "currentColor" : "none"}
                fillOpacity={isActive(to) ? 0.15 : 0}
                style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
              />
              <span
                className="mt-1 text-[11px] font-semibold tracking-wide"
                style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
              >
                {label.charAt(0) + label.slice(1).toLowerCase()}
              </span>
            </Link>
          ))}
        </div>
      )}
      {navStyle === "compact-dots" && (
        <div
          className="flex items-center justify-around rounded-[50px] py-1.5"
          style={{
            backgroundColor: "rgba(18,18,20,0.80)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={label === "HOME" ? handleHomeClick : undefined}
              aria-current={isActive(to) ? "page" : undefined}
              className="flex flex-col items-center justify-center"
            >
              <div
                className={`relative flex size-8 items-center justify-center rounded-full transition-colors ${
                  isActive(to) ? "bg-white/10" : ""
                }`}
                style={{ color: isActive(to) ? accent : "rgba(255,255,255,0.45)" }}
              >
                <Icon className="size-[16px]" strokeWidth={isActive(to) ? 2.5 : 2} />
                {isActive(to) && (
                  <span
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
