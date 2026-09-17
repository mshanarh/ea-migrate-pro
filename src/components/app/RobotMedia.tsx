import { useEffect, useRef, useState } from "react";
import { loadVideoUrl } from "@/lib/media-store";

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
 * Playback used to need a second HOME press because (a) implicit autoplay is
 * silently rejected mid-route-change and (b) giant base64 data URLs took seconds
 * to decode. Videos now live in IndexedDB and are handed to the element as an
 * instant object URL, and play() is driven explicitly with retries so the first
 * press just works.
 */
export function RobotMedia({ image, video, variant, className }: RobotMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playableSrc, setPlayableSrc] = useState<string>();

  // Resolve IndexedDB video references to a fast object URL; plain URLs and
  // legacy data URLs pass straight through.
  useEffect(() => {
    if (!video) {
      setPlayableSrc(undefined);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    loadVideoUrl(video)
      .then((resolved) => {
        if (cancelled) {
          if (resolved) URL.revokeObjectURL(resolved);
          return;
        }
        objectUrl = resolved ?? undefined;
        setPlayableSrc(resolved ?? video);
      })
      .catch(() => {
        if (!cancelled) setPlayableSrc(video);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video]);

  useEffect(() => {
    if (!playableSrc) return;
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
  }, [playableSrc]);

  if (video && playableSrc) {
    return (
      <video
        ref={videoRef}
        src={playableSrc}
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
