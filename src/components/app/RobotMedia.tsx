import { useEffect, useRef } from "react";

type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = background layer (muted loop, no controls); "avatar" = framed player with controls. */
  variant: "hero" | "avatar";
  className: string;
};

/**
 * Renders the robot's uploaded video when one exists (from the mentor dashboard's
 * EA Video/GIF upload), otherwise the static image.
 *
 * RobotMedia is only mounted on the HOME screen themes, which gives the exact
 * behaviour requested: the video plays as soon as the user lands on HOME.
 *
 * Why the explicit play() below: browsers reject implicit autoplay when the
 * element mounts mid-route-change (especially on mobile) and the failure is
 * silent — the video only appeared after leaving and re-entering HOME. We now
 * call play() on mount, retry when the file is actually decodable (large
 * uploads load slowly), and unlock on the first user gesture as a last resort.
 */
export function RobotMedia({ image, video, variant, className }: RobotMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!video) return;
    const el = videoRef.current;
    if (!el) return;

    let cancelled = false;
    const attemptPlay = () => {
      if (cancelled) return;
      // Muted + playsInline autoplay is permitted by every major browser once
      // the element can decode; a rejected promise just means "not ready yet"
      // and the ready/canplay listeners below will retry.
      el.play().catch(() => {});
    };

    attemptPlay();
    el.addEventListener("loadeddata", attemptPlay);
    el.addEventListener("canplay", attemptPlay);

    // Last resort for strict autoplay policies (some iOS/Android combos):
    // the first interaction anywhere on the page unlocks playback.
    const unlockOnGesture = () => attemptPlay();
    window.addEventListener("pointerdown", unlockOnGesture, { once: true, passive: true });
    window.addEventListener("touchstart", unlockOnGesture, { once: true, passive: true });

    return () => {
      cancelled = true;
      el.removeEventListener("loadeddata", attemptPlay);
      el.removeEventListener("canplay", attemptPlay);
      window.removeEventListener("pointerdown", unlockOnGesture);
      window.removeEventListener("touchstart", unlockOnGesture);
    };
  }, [video]);

  if (video) {
    return (
      <video
        ref={videoRef}
        src={video}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        controls={variant === "avatar"}
        preload="auto"
      />
    );
  }
  return <img src={image} alt="" className={className} />;
}
