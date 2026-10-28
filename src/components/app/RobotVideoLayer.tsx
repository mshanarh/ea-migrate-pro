import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAppState } from "@/lib/app-store";
import {
  retrySharedVideo,
  setSharedVideoSource,
  useSharedVideo,
  useVideoHost,
  videoLayerMode,
} from "@/lib/shared-video";
import { useRobotVideoAuto, useRobotVideoStopped, useRobotVideoUltra } from "@/lib/video-playback";

/**
 * THE APP-WIDE ROBOT VIDEO LAYER — one shared player, one placement rule.
 *
 * Mounted once in the root route (next to AppBackground), so it survives every
 * navigation: the single <video> element in src/lib/shared-video.ts is moved
 * in and out of the hosts below and is NEVER remounted, which is what keeps
 * playback from stacking or restarting when switching tabs.
 *
 *   • Home        → the big screen hosts the player in-card; when the active
 *                   interface has no media slot this layer shows it full
 *                   screen. Home plays ALWAYS, whatever the switches say.
 *   • Settings & the other non-trading /app pages → only while the persisted
 *                   "Robot Video" switch is ON, as a see-through layer behind
 *                   the content (opacity below).
 *   • Metatrader, Scanner, Fundamentals → nothing at all: plain black, no
 *                   video, whatever the switches say (videoLayerMode).
 *
 * Nothing here can block boot, navigation or trading: it renders null unless
 * the player is ready, and a failed load falls back to the interface's normal
 * background with the retryable "Could not load your robot video" line.
 */

/** Full strength where Home plays it on-screen; see-through behind content. */
const OPACITY = {
  home: 1,
  /** Ultra HD keeps the clip clear and readable behind text; off is a soft wash. */
  background: { ultra: 0.62, soft: 0.4 },
};

export function RobotVideoLayer() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const videoAuto = useRobotVideoAuto();
  const { robots, activeRobotId } = useAppState();
  const robot = robots.find((candidate) => candidate.id === activeRobotId) ?? robots[0];
  const source = typeof robot?.video === "string" && robot.video ? robot.video : null;
  const { ready, failed, sourceRef } = useSharedVideo();

  // The source comes from the app state (filled by Home's quiet key lookup);
  // setting the SAME source again is a no-op, so navigation never restarts it.
  useEffect(() => {
    setSharedVideoSource(source);
  }, [source]);

  const mode = videoLayerMode(pathname, videoAuto);
  /** A HOME double-press stop pauses the video on every screen, this one too. */
  const stopped = useRobotVideoStopped();
  const ultra = useRobotVideoUltra();

  // ONE retryable line per source — never a loop, never a "no video" claim.
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!failed || !sourceRef) return;
    if (reportedRef.current === sourceRef) return;
    reportedRef.current = sourceRef;
    toast.error("Could not load your robot video", {
      description: "Tap Retry to play it. Until then these screens keep their normal background.",
      duration: 12_000,
      action: {
        label: "Retry",
        onClick: () => {
          reportedRef.current = null;
          retrySharedVideo();
        },
      },
    });
  }, [failed, sourceRef]);

  // Declared unconditionally (hooks rule); the host div only renders below.
  const setHostEl = useVideoHost("screen", {
    opacity:
      mode === "background"
        ? ultra
          ? OPACITY.background.ultra
          : OPACITY.background.soft
        : OPACITY.home,
    transparentScreen: true,
  });

  if (stopped || mode === "none" || !ready) return null;

  return (
    <div
      key={mode}
      ref={setHostEl}
      aria-hidden
      data-eamp-video-layer={mode}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    />
  );
}

export default RobotVideoLayer;
