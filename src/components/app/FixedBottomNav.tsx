import { useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { House, Server, ScanLine } from "lucide-react";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { isVideoActive, setVideoActive, toggleVideoPlayback } from "@/lib/video-playback";
import { useBottomNavStyle, type BottomNavStyle } from "@/lib/bottom-nav-style";
import { setRobotVideo } from "@/lib/app-store";
import { lookupRobotVideoForKey } from "@/lib/robot-video";

export type { BottomNavStyle };

const TABS = [
  { to: "/app/metatrader", label: "METATRADER", icon: Server },
  { to: "/app/home", label: "HOME", icon: House },
  { to: "/app/scanner", label: "SCANNER", icon: ScanLine },
] as const;

type Tab = (typeof TABS)[number];

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
    case "glass-bar":
      return "plat-nav-glass";
    case "outlined-pill":
      return "plat-nav-outline";
    case "circle-dock":
      return "plat-nav-dock";
    case "square-tiles":
      return "plat-nav-tiles";
    case "underline-tabs":
      return "plat-nav-underline";
    case "neon-glow":
      return "plat-nav-neon";
    case "segmented-control":
      return "plat-nav-segmented";
    case "labels-above":
      return "plat-nav-labels";
    case "rounded-tiles":
      return "plat-nav-rounded";
    case "gradient-bar":
      return "plat-nav-gradient";
    case "capsule-active":
      return "plat-nav-capsule";
    default:
      return "plat-nav-ios";
  }
}

/** "METATRADER" → "Metatrader" — the iOS-style label casing. */
function tabLabel(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** Inactive tabs follow the active interface's muted text token. */
const INACTIVE = "var(--if-muted, rgba(255,255,255,0.45))";

/** One destination. Every style renders this, so all three always exist. */
function NavLink({
  tab,
  active,
  accent,
  onClick,
  className = "",
  style,
  iconClassName = "size-[22px]",
  labelClassName = "",
  showLabel = true,
  labelFirst = false,
  children,
}: {
  tab: Tab;
  active: boolean;
  accent: string;
  onClick?: (() => void) | undefined;
  className?: string;
  style?: CSSProperties | undefined;
  iconClassName?: string;
  labelClassName?: string;
  showLabel?: boolean;
  /** "Labels On Top" — the label is drawn above the icon instead of below. */
  labelFirst?: boolean;
  children?: ReactNode;
}) {
  const Icon = tab.icon;
  return (
    <Link
      to={tab.to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={className}
      style={{ color: active ? accent : INACTIVE, ...style }}
    >
      {labelFirst && showLabel && <span className={labelClassName}>{tabLabel(tab.label)}</span>}
      <Icon
        className={iconClassName}
        strokeWidth={active ? 2.5 : 2}
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
      {!labelFirst && showLabel && <span className={labelClassName}>{tabLabel(tab.label)}</span>}
      {children}
    </Link>
  );
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

/** The active robot as the persisted app state has it (id + licence key). */
function activeRobotSnapshot(): { id: string; key: string; video?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("eamp.app.v3");
    if (!raw) return null;
    const state = JSON.parse(raw) as {
      activeRobotId?: string | null;
      robots?: { id?: string; key?: string; video?: string }[];
    };
    const robots = state.robots ?? [];
    const robot = robots.find((item) => item.id && item.id === state.activeRobotId) ?? robots[0];
    if (!robot?.id) return null;
    return {
      id: robot.id,
      key: typeof robot.key === "string" ? robot.key : "",
      ...(typeof robot.video === "string" && robot.video ? { video: robot.video } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The one and only bottom navigation for the EA Migrate app.
 *
 * Its LOOK comes from the shared, persisted bottom-nav store, so picking a
 * style in Settings → Bottom Nav (or the drawer) re-renders the real nav on
 * Home, Metatrader, Quotes, Scanner and Settings instantly — no reload. All
 * fifteen styles keep the same three destinations and colour the active tab
 * with the live theme accent, so the colour cycle keeps working everywhere.
 *
 * HOME keeps its special gesture: pressing it twice starts the robot's uploaded
 * video playing (the tap itself unlocks mobile autoplay).
 */
export function FixedBottomNav({ style }: { style?: BottomNavStyle } = {}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const lastHomeTap = useRef<number>(0);
  const storedStyle = useBottomNavStyle();
  const navStyle = style ?? storedStyle;

  /**
   * DOUBLE-PRESS HOME — the background toggle.
   *
   * The video belongs to the LICENCE KEY, so a robot with nothing cached asks
   * the server for it (src/lib/robot-video.ts) before any claim is made. "No
   * robot video yet" appears only when the store answered and confirmed the
   * key has no video; a lookup that could not answer is a retryable error.
   */
  const toggleRobotVideo = async () => {
    const snapshot = activeRobotSnapshot();
    if (!snapshot?.video) {
      if (!snapshot) {
        toast.info("No robot video yet — your mentor can upload one");
        return;
      }
      const lookup = await lookupRobotVideoForKey(snapshot.key);
      if (lookup.status === "unavailable") {
        toast.error("Could not load your robot video", {
          description: `${lookup.error} Double-press HOME to retry.`,
          duration: 12000,
        });
        return;
      }
      if (lookup.status === "none") {
        toast.info("No robot video yet — your mentor can upload one");
        return;
      }
      setRobotVideo(snapshot.id, lookup.video);
      setVideoActive(true);
      toast.success("Robot video on — it now plays behind Settings and the other screens");
      return;
    }
    // DOUBLE-PRESS = STOP. It stops EVERYWHERE, Home's big screen included,
    // and it stays stopped until the gesture (or the Settings switch) plays it
    // again — the video must never resume by itself.
    toggleVideoPlayback();
    toast.success(
      isVideoActive()
        ? "Robot video playing — Home and the other screens"
        : "Robot video stopped on every screen",
    );
  };

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
      void toggleRobotVideo();
    } else if (robotHasVideo()) {
      toast.info("Double-press HOME for the video switch");
    }
  };

  const isActive = (to: string) => path === to;
  const onTab = (tab: Tab) => (tab.label === "HOME" ? handleHomeClick : undefined);

  return (
    <nav
      aria-label="App navigation"
      className={`fixed bottom-0 left-1/2 z-50 w-[min(92%,26rem)] -translate-x-1/2 transition-all duration-300 ${getNavClass(navStyle)}`}
    >
      {navStyle === "floating-pill" && (
        <div
          className="flex w-full items-stretch justify-around rounded-[28px] px-2 pt-1.5"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.88))",
            backdropFilter: "blur(var(--if-nav-blur, 18px)) saturate(1.6)",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 18px)) saturate(1.6)",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.10))",
            borderRadius: "var(--if-nav-radius, 28px)",
            boxShadow: "var(--if-nav-shadow, 0 10px 34px rgba(0,0,0,0.55))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
                labelClassName="text-[10px] font-semibold tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {navStyle === "icon-pill" && (
        <div
          className="flex items-center justify-around rounded-full px-4 py-2"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.85))",
            backdropFilter: "blur(var(--if-nav-blur, 16px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 16px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.08))",
            borderRadius: "var(--if-nav-radius, 999px)",
            boxShadow: "var(--if-nav-shadow, 0 8px 24px rgba(0,0,0,0.5))",
          }}
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              tab={tab}
              active={isActive(tab.to)}
              accent={accent}
              onClick={onTab(tab)}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-1"
              iconClassName="size-[20px]"
              showLabel={false}
            />
          ))}
        </div>
      )}

      {navStyle === "classic-tabs" && (
        <div
          className="flex w-full items-stretch justify-around rounded-none px-2"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.95))",
            borderTop: "1px solid var(--if-nav-border, rgba(255,255,255,0.10))",
            boxShadow: "var(--if-nav-shadow, 0 -4px 12px rgba(0,0,0,0.3))",
          }}
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              tab={tab}
              active={isActive(tab.to)}
              accent={accent}
              onClick={onTab(tab)}
              className="flex h-full flex-1 flex-col items-center justify-center py-2"
              iconClassName="size-[20px]"
              labelClassName="mt-1 text-[11px] font-semibold tracking-wide"
            />
          ))}
        </div>
      )}

      {navStyle === "compact-dots" && (
        <div
          className="flex items-center justify-around rounded-[50px] py-1.5"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.80))",
            backdropFilter: "blur(var(--if-nav-blur, 12px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 12px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.06))",
            borderRadius: "var(--if-nav-radius, 50px)",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="relative flex size-8 items-center justify-center rounded-full"
                style={active ? { backgroundColor: "rgba(255,255,255,0.10)" } : undefined}
                iconClassName="size-[16px]"
                showLabel={false}
              >
                {active && (
                  <span
                    className="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                )}
              </NavLink>
            );
          })}
        </div>
      )}

      {navStyle === "glass-bar" && (
        <div
          className="flex w-full items-stretch justify-around rounded-3xl px-2 pt-1.5"
          style={{
            background: "var(--if-nav-bg, rgba(255,255,255,0.045))",
            backdropFilter: "blur(var(--if-nav-blur, 30px)) saturate(1.9)",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 30px)) saturate(1.9)",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.14))",
            borderRadius: "var(--if-nav-radius, 24px)",
            boxShadow: "var(--if-nav-shadow, 0 18px 50px rgba(0,0,0,0.55))",
          }}
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              tab={tab}
              active={isActive(tab.to)}
              accent={accent}
              onClick={onTab(tab)}
              className="plat-pressable flex min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
              labelClassName="text-[10px] font-semibold tracking-[0.08em]"
            />
          ))}
        </div>
      )}

      {navStyle === "outlined-pill" && (
        <div
          className="flex items-center justify-around rounded-full px-3 py-2"
          style={{
            backgroundColor: "transparent",
            border: "1.5px solid var(--if-nav-border, rgba(255,255,255,0.28))",
            borderRadius: "var(--if-nav-radius, 999px)",
            boxShadow: "var(--if-nav-shadow, 0 10px 30px rgba(0,0,0,0.45))",
          }}
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              tab={tab}
              active={isActive(tab.to)}
              accent={accent}
              onClick={onTab(tab)}
              className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
              labelClassName="text-[10px] font-semibold tracking-[0.08em]"
            />
          ))}
        </div>
      )}

      {navStyle === "circle-dock" && (
        <div
          className="flex items-end justify-around rounded-full px-5 py-2"
          style={{
            // The interface definition supplies the dock chrome and the centre
            // button (white circle on red, split silver/red, …).
            background: "var(--if-nav-bg, rgba(16,16,18,0.92))",
            backdropFilter: "blur(var(--if-nav-blur, 18px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 18px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.10))",
            borderRadius: "var(--if-nav-radius, 999px)",
            boxShadow: "var(--if-nav-shadow, 0 14px 40px rgba(0,0,0,0.6))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            // HOME (the middle tab) is the raised circular button.
            if (tab.label === "HOME") {
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  onClick={onTab(tab)}
                  aria-current={active ? "page" : undefined}
                  aria-label={tabLabel(tab.label)}
                  className="plat-pressable relative -mt-8 flex size-14 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "var(--if-nav-centre, var(--accent))",
                    color: "#08080a",
                    border: "1px solid rgba(255,255,255,0.18)",
                    boxShadow: `0 12px 26px var(--accent-soft, ${accent}66), 0 0 0 5px rgba(10,10,12,0.96)`,
                  }}
                >
                  <Icon className="size-6" strokeWidth={2.6} />
                </Link>
              );
            }
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="flex min-w-[56px] flex-col items-center justify-center gap-0.5 pb-1"
                iconClassName="size-[20px]"
                labelClassName="text-[10px] font-semibold tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {navStyle === "square-tiles" && (
        <div
          className="flex w-full items-stretch gap-1.5 p-1.5"
          style={{
            background: "var(--if-nav-bg, rgba(12,12,14,0.96))",
            borderTop: "1px solid var(--if-nav-border, rgba(255,255,255,0.10))",
            boxShadow: "var(--if-nav-shadow, none)",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex h-12 flex-1 flex-col items-center justify-center gap-0.5 border"
                style={
                  active
                    ? { backgroundColor: accent, color: "#08080a", borderColor: accent }
                    : { borderColor: "rgba(255,255,255,0.12)" }
                }
                iconClassName="size-[18px]"
                labelClassName="text-[9px] font-black uppercase tracking-[0.14em]"
              />
            );
          })}
        </div>
      )}

      {/* ── NEON GLOW BAR — the accent lights the edge and the active tab. */}
      {navStyle === "neon-glow" && (
        <div
          className="flex w-full items-stretch justify-around rounded-[26px] px-2 pt-1.5"
          style={{
            background: "var(--if-nav-bg, rgba(14,14,16,0.92))",
            backdropFilter: "blur(var(--if-nav-blur, 18px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 18px))",
            border: `1px solid ${accent}66`,
            borderRadius: "var(--if-nav-radius, 26px)",
            boxShadow: `0 0 0 1px ${accent}22, 0 0 26px ${accent}55, 0 12px 34px rgba(0,0,0,0.55)`,
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
                style={active ? { backgroundColor: `${accent}1F` } : undefined}
                labelClassName="text-[10px] font-bold tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {/* ── SEGMENTED CONTROL — one track, the active tab is the filled segment. */}
      {navStyle === "segmented-control" && (
        <div
          className="flex w-full items-stretch gap-1 rounded-full p-1"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.90))",
            backdropFilter: "blur(var(--if-nav-blur, 16px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 16px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.09))",
            borderRadius: "var(--if-nav-radius, 999px)",
            boxShadow: "var(--if-nav-shadow, 0 10px 30px rgba(0,0,0,0.5))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2"
                style={active ? { backgroundColor: accent, color: "#08080a" } : undefined}
                iconClassName="size-[18px]"
                labelClassName="text-[10px] font-black tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {/* ── LABELS ON TOP — the label sits above the icon. */}
      {navStyle === "labels-above" && (
        <div
          className="flex w-full items-stretch justify-around rounded-[24px] px-2 pb-1.5 pt-2"
          style={{
            background: "var(--if-nav-bg, rgba(18,18,20,0.90))",
            backdropFilter: "blur(var(--if-nav-blur, 16px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 16px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.10))",
            borderRadius: "var(--if-nav-radius, 24px)",
            boxShadow: "var(--if-nav-shadow, 0 10px 30px rgba(0,0,0,0.5))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[62px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1.5"
                style={active ? { backgroundColor: "rgba(255,255,255,0.06)" } : undefined}
                iconClassName="size-[20px]"
                labelClassName="text-[10px] font-semibold tracking-[0.08em]"
                labelFirst
              />
            );
          })}
        </div>
      )}

      {/* ── ROUNDED TILES — each tab is its own tile; the active one is tinted. */}
      {navStyle === "rounded-tiles" && (
        <div className="flex w-full items-stretch justify-around gap-2 px-1 py-2">
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[58px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border py-2"
                style={
                  active
                    ? { backgroundColor: `${accent}24`, borderColor: `${accent}99` }
                    : { background: "var(--if-nav-bg, rgba(16,16,18,0.90))", borderColor: "rgba(255,255,255,0.12)" }
                }
                iconClassName="size-[19px]"
                labelClassName="text-[10px] font-bold tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {/* ── GRADIENT BAR — the bar itself is tinted from the accent. */}
      {navStyle === "gradient-bar" && (
        <div
          className="flex w-full items-stretch justify-around rounded-[26px] px-2 pt-1.5"
          style={{
            background: `linear-gradient(135deg, ${accent}3D 0%, var(--if-nav-bg, rgba(14,14,16,0.94)) 62%)`,
            backdropFilter: "blur(var(--if-nav-blur, 20px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 20px))",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "var(--if-nav-radius, 26px)",
            boxShadow: "var(--if-nav-shadow, 0 12px 34px rgba(0,0,0,0.55))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="plat-pressable flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
                style={active ? { backgroundColor: `${accent}22` } : undefined}
                labelClassName="text-[10px] font-semibold tracking-[0.08em]"
              />
            );
          })}
        </div>
      )}

      {/* ── ACTIVE CAPSULE — icon and label side by side, capsule when active. */}
      {navStyle === "capsule-active" && (
        <div
          className="flex w-full items-center justify-around rounded-2xl px-1.5 py-2"
          style={{
            background: "var(--if-nav-bg, rgba(16,16,18,0.94))",
            backdropFilter: "blur(var(--if-nav-blur, 14px))",
            WebkitBackdropFilter: "blur(var(--if-nav-blur, 14px))",
            border: "1px solid var(--if-nav-border, rgba(255,255,255,0.08))",
            borderRadius: "var(--if-nav-radius, 18px)",
            boxShadow: "var(--if-nav-shadow, 0 12px 30px rgba(0,0,0,0.5))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className={`plat-pressable flex min-w-[64px] items-center justify-center gap-1.5 px-3 py-2${
                  active ? " rounded-full" : ""
                }`}
                style={active ? { backgroundColor: accent, color: "#08080a" } : undefined}
                iconClassName="size-[18px]"
                labelClassName="text-[10px] font-black tracking-[0.06em]"
              />
            );
          })}
        </div>
      )}

      {navStyle === "underline-tabs" && (
        <div
          className="flex w-full items-stretch justify-around"
          style={{
            background: "var(--if-nav-bg, rgba(10,10,12,0.94))",
            borderTop: "1px solid var(--if-nav-border, rgba(255,255,255,0.08))",
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                tab={tab}
                active={active}
                accent={accent}
                onClick={onTab(tab)}
                className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5"
                iconClassName="size-[18px]"
                labelClassName="text-[11px] font-semibold tracking-[0.04em]"
              >
                {active && (
                  <span
                    className="absolute bottom-0 h-[2px] w-10 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </nav>
  );
}
