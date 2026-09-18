import { useEffect, useRef, useState } from "react";
import { loadVideoUrl } from "@/lib/media-store";
import {
  isRobotVideoAuto,
  subscribeVideoAuto,
  subscribeVideoRequests,
  wasPlaybackRequestedRecently,
} from "@/lib/video-playback";

type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = background layer (no controls); "avatar" = framed player with controls. */
  variant: "hero" | "avatar";
  className: string;
  /** Prefer the picture until the user explicitly requests playback (circle themes). */
  preferImage?: boolean;
};

/**
 * Renders the robot's uploaded video when one exists (from the mentor
 * dashboard's EA Video/GIF upload), otherwise the static image.
 *
 * Playback is deliberate, never automatic-by-default: pressing the HOME button
 * twice → the video starts playing, wherever the media sits (picture slot on
 * circle themes, background on black themes). The Settings → Back Animation →
 * Robot Video toggle can also start (and keep) playback via the persisted
 * auto flag. All mounted RobotMedia instances subscribe to the playback bus.
 *
 * Videos live in IndexedDB and are handed to the element as an instant object
 * URL, so the double-press starts playback immediately with no decode lag.
 */
export function RobotMedia({ image, video, variant, className, preferImage = false }: RobotMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playableSrc, setPlayableSrc] = useState<string>();
  const [activated, setActivated] = useState(false);

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

  // Playback requests: live bus for already-mounted media, plus the recent
  // request check for media that mounted a moment later (the first HOME press
  // can navigate and remount the home screen — the second press must still win).
  // The Robot Video toggle (auto flag) also activates, and live-updates via its
  // own bus so switching off returns the picture slot to the image.
  useEffect(() => {
    if (!playableSrc) return;
    if (wasPlaybackRequestedRecently()) setActivated(true);
    if (isRobotVideoAuto()) setActivated(true);
    const offRequests = subscribeVideoRequests(() => setActivated(true));
    const offAuto = subscribeVideoAuto(() => {
      if (isRobotVideoAuto()) setActivated(true);
      else {
        videoRef.current?.pause();
        setActivated(false);
      }
    });
    return () => {
      offRequests();
      offAuto();
    };
  }, [playableSrc]);

  // Once activated, actually start playback: try now, and keep retrying until
  // the element reports it is really playing (slow mobile decoders, browser
  // autoplay policies, codec probing — the first play() call can fail silently).
  useEffect(() => {
    if (!activated || !playableSrc) return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    const attemptPlay = () => {
      if (cancelled) return;
      void el.play().catch(() => {});
    };
    attemptPlay();
    el.addEventListener("loadeddata", attemptPlay);
    el.addEventListener("canplay", attemptPlay);
    // A short retry window catches browsers that reject the first play() before
    // the element is ready, without running forever.
    const retries = window.setTimeout(attemptPlay, 350);
    const confirmTimer = window.setInterval(() => {
      if (!el.paused) {
        window.clearInterval(confirmTimer);
        return;
      }
      attemptPlay();
    }, 500);
    const stopConfirming = window.setTimeout(() => window.clearInterval(confirmTimer), 5000);
    return () => {
      cancelled = true;
      el.removeEventListener("loadeddata", attemptPlay);
      el.removeEventListener("canplay", attemptPlay);
      window.clearTimeout(retries);
      window.clearInterval(confirmTimer);
      window.clearTimeout(stopConfirming);
    };
  }, [activated, playableSrc]);

  // Show the picture until playback is requested, or when no usable video exists.
  if (preferImage && !activated) {
    return <img src={image} alt="" className={className} />;
  }
  if (!video || !playableSrc) {
    return <img src={image} alt="" className={className} />;
  }

  return (
    <video
      ref={videoRef}
      src={playableSrc}
      className={className}
      loop
      muted
      playsInline
      preload="auto"
      controls={variant === "avatar"}
    />
  );
}

/**
 * Full-bleed fixed backdrop that plays the robot's video edge-to-edge across
 * the whole screen — used by the black-background interface styles, where the
 * media belongs behind the content instead of inside the small rounded screen.
 * Falls back to a static image layer, then to nothing.
 */
export function VideoBackdrop({ image, video, accent }: { image: string; video?: string | undefined; accent: string }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
      <RobotMedia image={image} video={video} variant="hero" className="size-full object-cover opacity-50" />
      {/* Legibility scrims over the media */}
      <div className="absolute inset-0 bg-black/45" />
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse 90% 55% at 50% 25%, transparent 0%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,0.94) 100%)` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-56"
        style={{ background: `linear-gradient(180deg, transparent, rgba(0,0,0,0.92) 70%), linear-gradient(0deg, ${accent}14, transparent 60%)` }}
      />
    </div>
  );
}
