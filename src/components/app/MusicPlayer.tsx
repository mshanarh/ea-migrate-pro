import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Plus, Volume2 } from "lucide-react";
import { loadAudioUrl } from "@/lib/media-store";
import { removeMusicTrack, setMusicPlaying, setMusicVolume, setSpotifyTrack, setUploadedTrack, useMusic } from "@/lib/music-store";
import { useCustomization } from "@/lib/app-customization";

/**
 * Floating relaxation-music pill, available on every app screen.
 *
 * - Tap the pill to expand the mini-panel: upload a track from the phone's
 *   files (any audio type), paste a Spotify playlist link, play/pause and
 *   adjust volume.
 * - Playback is always started by an explicit user tap (browser autoplay
 *   policies block sound on load).
 * - The audio element itself lives at document level so navigation between
 *   app screens never interrupts playback.
 */

function formatName(name: string) {
  return name.length > 26 ? `${name.slice(0, 24)}…` : name;
}

export function MusicPlayer() {
  const { track, playing, volume } = useMusic();
  const { color } = useCustomization();
  const accent = color === "white" ? "#FFFFFF" : undefined;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [spotifyDraft, setSpotifyDraft] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // The element is created once and survives route changes.
  useEffect(() => {
    const el = new Audio();
    el.loop = true;
    audioRef.current = el;
    return () => {
      el.pause();
      audioRef.current = null;
    };
  }, []);

  // Resolve the uploaded track reference to a playable object URL.
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    if (track?.kind === "upload") {
      loadAudioUrl(track.ref)
        .then((url) => {
          if (cancelled) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          created = url;
          setResolvedUrl(url);
        })
        .catch(() => {
          if (!cancelled) setResolvedUrl(null);
        });
    } else {
      setResolvedUrl(null);
    }
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [track]);

  // Keep element state in sync with the store.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (track?.kind === "spotify" || !resolvedUrl) {
      el.pause();
      el.removeAttribute("src");
      return;
    }
    if (el.src !== resolvedUrl) {
      el.src = resolvedUrl;
      el.currentTime = 0;
    }
    el.volume = volume;
    if (playing) {
      el.play().catch(() => setMusicPlaying(false));
    } else {
      el.pause();
    }
  }, [playing, volume, resolvedUrl, track]);

  const handleUpload = (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("That file is larger than 50MB.");
      return;
    }
    const ref = URL.createObjectURL(file);
    // Revoke after the store settles; loadAudioUrl only handles idb refs so a
    // blob: URL passes straight through the same "plain URL" path.
    import("@/lib/media-store").then(({ saveAudioBlob }) => saveAudioBlob(file)).then((idbRef) => {
      URL.revokeObjectURL(ref);
      setUploadedTrack(idbRef, file.name.replace(/\.[^.]+$/, ""));
    }).catch(() => {
      URL.revokeObjectURL(ref);
      setUploadError("Could not save that file. Try again.");
    });
  };

  const handleSpotifySave = () => {
    const url = spotifyDraft.trim();
    if (!/^https:\/\/(open\.)?spotify\.com\//.test(url) && !url.startsWith("https://spotify.link/")) {
      setUploadError("Paste a spotify.com playlist or track link.");
      return;
    }
    setSpotifyTrack(url, "Spotify playlist");
    setSpotifyDraft("");
    setUploadError(null);
  };

  const onMainTap = () => {
    if (!track) {
      setOpen(true);
      return;
    }
    if (track.kind === "spotify") {
      window.open(track.url, "_blank", "noopener");
      return;
    }
    setMusicPlaying(!playing);
  };

  // Circle themes with a white accent need a visible icon color.
  const iconColor = accent ?? "#fff";

  return (
    <>
      <div className="pointer-events-none fixed right-3 top-24 z-[60] flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          {open && (
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/85 px-3 py-2 shadow-[0_10px_36px_rgba(0,0,0,0.6)] backdrop-blur-md">
              <button
                type="button"
                aria-label={playing ? "Pause music" : "Play music"}
                onClick={onMainTap}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-transform active:scale-95"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                aria-label="Music volume"
                onChange={(event) => setMusicVolume(Number(event.target.value))}
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/20 accent-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <button
                type="button"
                aria-label="Remove track"
                onClick={() => void removeMusicTrack()}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white transition-transform active:scale-95"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Relaxation music"
          onClick={() => setOpen((value) => !value)}
          className="pointer-events-auto flex size-12 items-center justify-center rounded-full border bg-black/85 shadow-[0_10px_36px_rgba(0,0,0,0.6)] backdrop-blur-md transition-transform active:scale-95"
          style={{ borderColor: `${iconColor}44` }}
        >
          <Music2 className="size-5" style={{ color: iconColor }} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-x-3 top-[7.5rem] z-[60] mx-auto max-w-md rounded-3xl border border-white/12 bg-[#0b0b0d]/95 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.75)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/8">
              <Music2 className="size-5 text-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{track ? formatName(track.name) : "No track yet"}</p>
              <p className="text-[11px] text-white/45">{track ? (track.kind === "upload" ? "Uploaded track" : "Spotify link saved") : "Upload music or paste a Spotify link"}</p>
            </div>
            {track?.kind === "upload" && (
              <button
                type="button"
                aria-label={playing ? "Pause" : "Play"}
                onClick={onMainTap}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-full bg-white/5 px-3 py-2">
            <Volume2 className="size-4 text-white/60" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={(event) => setMusicVolume(Number(event.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              handleUpload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-black text-black transition-transform active:scale-[0.98]"
          >
            <Plus className="size-4" strokeWidth={3} /> UPLOAD MUSIC FROM PHONE
          </button>

          <div className="mt-3 flex gap-2">
            <input
              value={spotifyDraft}
              onChange={(event) => setSpotifyDraft(event.target.value)}
              placeholder="Spotify playlist link…"
              inputMode="url"
              aria-label="Spotify link"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <button
              type="button"
              onClick={handleSpotifySave}
              className="h-11 shrink-0 rounded-full border border-white/15 px-4 text-sm font-bold text-white transition-transform active:scale-95"
            >
              Save
            </button>
          </div>
          {uploadError && <p className="mt-2 text-[12px] text-red-400">{uploadError}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-white/35">
            Spotify links open the playlist in the Spotify app so playback keeps running while you trade.
          </p>
        </div>
      )}
    </>
  );
}
