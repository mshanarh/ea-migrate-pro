import { useEffect, useRef, useState } from "react";
import { loadVideoUrl } from "@/lib/media-store";
import { isVideoActive, subscribeVideoActive } from "@/lib/video-playback";

type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = big media screen — plays the video IN the card when active;
   *  "avatar" = small round slot — ALWAYS the picture. */
  variant?: "hero" | "avatar";
  className: string;
  /** Kept for call-site compatibility — small slots always show the picture. */
  preferImage?: boolean;
};

/** Subscribe to the HOME double-press video toggle. */
function useVideoActive() {
  const [active, setActive] = useState(isVideoActive());
  useEffect(() => subscribeVideoActive(() => setActive(isVideoActive())), []);
  return active;
}

/** Resolve an IndexedDB/data/http video reference to a playback-ready src. */
function usePlayableVideo(video: string | undefined) {
  const [playableSrc, setPlayableSrc] = useState<string>();
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
  return playableSrc;
}

/** Keep a <video> element actually playing while active (slow decoders, etc.). */
function useEnsurePlaying(active: boolean, playableSrc: string | undefined) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active || !playableSrc) return;
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
  }, [active, playableSrc]);
  return videoRef;
}

/**
 * Media slot renderer:
 *   • Small slots (avatar / preferImage) — ALWAYS the robot's picture.
 *   • Big screens (hero) — the picture by default; when the HOME double-press
 *     turns the video ON, the video plays INSIDE the card (not the background),
 *     exactly as the owner asked for the big-screen interfaces.
 */
export function RobotMedia({ image, video, variant = "hero", className, preferImage = false }: RobotMediaProps) {
  const active = useVideoActive();
  const playableSrc = usePlayableVideo(video);
  const videoRef = useEnsurePlaying(active, playableSrc);

  const playInSlot = variant === "hero" && !preferImage && active && Boolean(video && playableSrc);
  if (playInSlot) {
    return (
      <video
        ref={videoRef}
        src={playableSrc}
        className={className}
        loop
        muted
        playsInline
        preload="auto"
      />
    );
  }
  return <img src={image} alt="" className={className} />;
}

/**
 * Full-bleed fixed backdrop driven by the HOME double-press toggle — used by
 * interfaces whose only media is a small circle (BLUEPRINT EDGE): there the
 * video plays edge-to-edge behind the console. Themes with a big media screen
 * play in the card instead (their universal backdrop passes
 * videoWhenActive={false}), so the video never runs in two places at once.
 */
export function VideoBackdrop({
  image,
  video,
  accent,
  showImageWhenInactive = true,
  videoWhenActive = true,
}: {
  image: string;
  video?: string | undefined;
  accent: string;
  /** Inactive state: keep the static image layer (theme backgrounds) or nothing. */
  showImageWhenInactive?: boolean;
  /** Set false when the theme's big screen plays the video in the card. */
  videoWhenActive?: boolean;
}) {
  const active = useVideoActive();
  const playableSrc = usePlayableVideo(video);
  const videoRef = useEnsurePlaying(active, playableSrc);

  const playing = Boolean(active && video && playableSrc && videoWhenActive);
  if (playing) {
    return (
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
        <video ref={videoRef} src={playableSrc} className="size-full object-cover opacity-50" loop muted playsInline preload="auto" />
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

  if (showImageWhenInactive) {
    return (
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
        <img src={image} alt="" className="size-full object-cover opacity-50" />
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

  return null;
}
