import { useSharedVideo, useVideoHost } from "@/lib/shared-video";
import { useRobotVideoStopped } from "@/lib/video-playback";

type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = the big media screen — hosts THE shared video player;
   *  "avatar" = small round slot — ALWAYS the picture. */
  variant?: "hero" | "avatar";
  className: string;
  /** Kept for call-site compatibility — small slots always show the picture. */
  preferImage?: boolean;
};

/**
 * Media slot renderer.
 *
 * THE PLAYER IS SHARED (src/lib/shared-video.ts): the hero slot does not own a
 * <video> — it registers a HOST and the app's ONE element is moved into it.
 * That is what makes Home's big screen play the video automatically (no button
 * press, any switch position) while switching tabs can never stack a second
 * decoder or restart the clip from the beginning.
 */
export function RobotMedia({
  image,
  video,
  variant = "hero",
  className,
  preferImage = false,
}: RobotMediaProps) {
  const { ready } = useSharedVideo();
  /** A HOME double-press stop must clear Home's big screen too — picture back. */
  const stopped = useRobotVideoStopped();
  const setHostEl = useVideoHost("card", { opacity: 1 });

  const playInSlot =
    variant === "hero" && !preferImage && Boolean(video) && ready && !stopped;

  if (playInSlot) {
    return (
      <div
        ref={setHostEl}
        aria-hidden
        data-eamp-video-host="card"
        className={`${className} pointer-events-none`}
      />
    );
  }
  return <img src={image} alt="" className={className} />;
}

/**
 * Full-bleed fixed backdrop — the STATIC image behind an interface.
 *
 * It never renders a <video> any more: whenever the shared player has a
 * source, this layer steps aside entirely so the ONE element (mounted in
 * RobotVideoLayer / the hero slot) owns the full screen. When there is no
 * video — or the video failed to load — the picture comes back exactly as
 * before, which is the "fall back to the normal background" behaviour.
 */
export function VideoBackdrop({
  image,
  video,
  showImageWhenInactive = true,
  videoWhenActive = true,
  mediaDim = true,
}: {
  image: string;
  /** Kept for call-site compatibility — the shared layer reads the app state. */
  video?: string | undefined;
  /** Kept for call-site compatibility — the backdrop paints no accent layer. */
  accent?: string;
  /** Static image when the shared player is not showing. */
  showImageWhenInactive?: boolean;
  /** Kept for call-site compatibility — playback is owned by the shared player. */
  videoWhenActive?: boolean;
  /** The "Background Picture" gate. */
  mediaDim?: boolean | undefined;
}) {
  const { ready } = useSharedVideo();

  // THE SHARED PLAYER OWNS THE FULL SCREEN while it has a source: painting
  // anything here would only stack a second layer over (or under) it.
  if (ready) return null;

  // BACKGROUND PICTURE OFF → no media at all, just the clean black behind it.
  if (!mediaDim) return null;

  // THE PICTURE IS THE POINT — full strength: no opacity, no scrim, no blur.
  if (showImageWhenInactive) {
    return (
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
        <img src={image} alt="" className="size-full object-cover" />
      </div>
    );
  }

  return null;
}
