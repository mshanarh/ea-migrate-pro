import { useEffect, useRef, useState } from "react";
import { loadVideoUrl } from "@/lib/media-store";
import { subscribeVideoRequests } from "@/lib/video-playback";

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
 * Playback is deliberately NOT automatic. The owner wants: press the HOME
 * button twice → the video starts playing, wherever the media sits (picture
 * slot on circle themes, background on black themes). All mounted RobotMedia
 * instances subscribe to the playback request published by the bottom nav.
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

  // Double-tap-HOME playback request — swap in the video and start playing.
  useEffect(() => {
    if (!playableSrc) return;
    return subscribeVideoRequests(() => {
      setActivated(true);
    });
  }, [playableSrc]);

  // Once activated, start playback (the double-tap is the user gesture that
  // unlocks it) and retry on data arrival for slow decoders.
  useEffect(() => {
    if (!activated || !playableSrc) return;
    const el = videoRef.current;
    if (!el) return;
    const attemptPlay = () => el.play().catch(() => {});
    attemptPlay();
    el.addEventListener("loadeddata", attemptPlay);
    return () => el.removeEventListener("loadeddata", attemptPlay);
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
