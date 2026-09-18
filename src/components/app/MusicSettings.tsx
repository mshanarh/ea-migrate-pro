import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Plus, Volume2, X } from "lucide-react";
import { loadAudioUrl } from "@/lib/media-store";
import { removeMusicTrack, setMusicPlaying, setMusicVolume, setSpotifyTrack, setUploadedTrack, useMusic } from "@/lib/music-store";

/**
 * Relaxation-music settings section (lives inside Settings → Music, not as a
 * floating pill on every screen).
 *
 * - Upload any audio file from the phone (mp3, m4a, wav, ogg…) — stored in
 *   IndexedDB via media-store, so it persists across visits.
 * - Or save a Spotify playlist/track link — a tap opens it in the Spotify app
 *   so playback keeps running while the user trades.
 * - Play/pause + volume. Playback is always started by an explicit user tap
 *   (browser autoplay policies block sound on load).
 * - The audio element lives at document level, so navigation between app
 *   screens never interrupts playback.
 */

function formatName(name: string) {
  return name.length > 26 ? `${name.slice(0, 24)}…` : name;
}

export function MusicSettingsSection() {
  const { track, playing, volume } = useMusic();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [spotifyDraft, setSpotifyDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError("That file is larger than 50MB.");
      return;
    }
    import("@/lib/media-store")
      .then(({ saveAudioBlob }) => saveAudioBlob(file))
      .then((idbRef) => setUploadedTrack(idbRef, file.name.replace(/\.[^.]+$/, "")))
      .catch(() => setError("Could not save that file. Try again."));
  };

  const handleSpotifySave = () => {
    const url = spotifyDraft.trim();
    if (!/^https:\/\/(open\.)?spotify\.com\//.test(url) && !url.startsWith("https://spotify.link/")) {
      setError("Paste a spotify.com playlist or track link.");
      return;
    }
    setSpotifyTrack(url, "Spotify playlist");
    setSpotifyDraft("");
    setError(null);
  };

  const onPlayTap = () => {
    if (!track) return;
    if (track.kind === "spotify") {
      window.open(track.url, "_blank", "noopener");
      return;
    }
    setMusicPlaying(!playing);
  };

  return (
    <div className="space-y-4">
      {/* Now playing card */}
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-[#0f1a1a] p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/8">
          <Music2 className="size-6 text-cyan-300" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{track ? formatName(track.name) : "No track yet"}</p>
          <p className="text-[11px] text-white/45">
            {track ? (track.kind === "upload" ? "Uploaded track" : "Spotify link saved") : "Upload music or paste a Spotify link"}
          </p>
        </div>
        {track?.kind === "upload" && (
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onPlayTap}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-cyan-300 transition-transform active:scale-95"
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
        )}
        {track?.kind === "spotify" && (
          <button
            type="button"
            onClick={onPlayTap}
            className="shrink-0 rounded-full bg-[#1DB954] px-4 py-2 text-xs font-black uppercase text-black transition-transform active:scale-95"
          >
            Open
          </button>
        )}
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3 rounded-full bg-white/5 px-4 py-3">
        <Volume2 className="size-4 text-white/60" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Music volume"
          onChange={(event) => setMusicVolume(Number(event.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
        <span className="w-9 text-right text-xs text-white/50">{Math.round(volume * 100)}%</span>
      </div>

      {/* Upload from phone */}
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
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-black text-black transition-transform active:scale-[0.98]"
      >
        <Plus className="size-4" strokeWidth={3} /> UPLOAD MUSIC FROM PHONE
      </button>

      {/* Spotify link */}
      <div className="flex gap-2">
        <input
          value={spotifyDraft}
          onChange={(event) => setSpotifyDraft(event.target.value)}
          placeholder="Spotify playlist link…"
          inputMode="url"
          aria-label="Spotify link"
          className="h-12 min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
        />
        <button
          type="button"
          onClick={handleSpotifySave}
          className="h-12 shrink-0 rounded-full border border-white/15 px-5 text-sm font-bold text-white transition-transform active:scale-95"
        >
          Save
        </button>
      </div>

      {track && (
        <button
          type="button"
          onClick={() => void removeMusicTrack()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs font-bold text-white/60 transition-transform active:scale-95"
        >
          <X className="size-3.5" /> REMOVE CURRENT TRACK
        </button>
      )}

      {error && <p className="text-[12px] text-red-400">{error}</p>}
      <p className="text-[11px] leading-relaxed text-white/35">
        Your music keeps playing across app screens. Spotify links open in the Spotify app so playback continues while you trade.
      </p>
    </div>
  );
}
