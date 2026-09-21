import { useEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause, Play, Plus, Search, Volume2, X } from "lucide-react";
import { loadAudioUrl } from "@/lib/media-store";
import {
  removeMusicTrack,
  setBuiltinTrack,
  setMusicPlaying,
  setMusicVolume,
  setSpotifyTrack,
  setUploadedTrack,
  useMusic,
} from "@/lib/music-store";
import {
  BUILTIN_TRACKS,
  currentBuiltinTrackId,
  playBuiltinTrack,
  setBuiltinVolume,
  stopBuiltinTrack,
} from "@/lib/piano-tracks";

/**
 * Relaxation-music section — lives inside Settings → Music, on BOTH the full
 * settings page and the customization drawer.
 *
 * - TRACK LIST: rows like a playlist — title, artist credit and a round play
 *   button. Press a row and it plays instantly; press again to pause.
 *   Built-in tracks are original piano / amapiano / lofi grooves generated
 *   live in the browser (royalty free, offline, nothing to download).
 * - UPLOAD: any audio file from the phone (mp3, m4a, wav, ogg…) — stored in
 *   IndexedDB via media-store, so it persists across visits. Artist songs
 *   (Chris Brown etc.) can't be bundled, but upload + Spotify cover them.
 * - SPOTIFY: a saved playlist/track link opens in the Spotify app so
 *   playback keeps running while the user trades.
 * - The <audio> element is a document-level SINGLETON shared by every
 *   mounted instance of this section, so the drawer and the settings page
 *   can never double-play the same upload.
 * - Playback always starts from an explicit user tap (browser autoplay
 *   policies block sound on load).
 */

/** Document-level shared audio element for uploaded tracks. */
let sharedUploadAudio: HTMLAudioElement | null = null;
function getSharedUploadAudio(): HTMLAudioElement {
  if (!sharedUploadAudio) {
    sharedUploadAudio = new Audio();
    sharedUploadAudio.loop = true;
  }
  return sharedUploadAudio;
}

function formatName(name: string) {
  return name.length > 26 ? `${name.slice(0, 24)}…` : name;
}

/** Deterministic album-art gradient per track id — every song gets its own cover colour. */
function coverGradient(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + id.charCodeAt(index)) % 360;
  const second = (hash + 46) % 360;
  return `linear-gradient(135deg, hsl(${hash} 65% 42%) 0%, hsl(${second} 72% 20%) 100%)`;
}

/** The explicit "E" badge, like streaming apps show. */
function ExplicitBadge() {
  return (
    <span
      aria-label="Explicit"
      className="ml-1.5 inline-flex size-3.5 shrink-0 translate-y-[-1px] items-center justify-center rounded-[3px] bg-white/15 align-middle text-[8px] font-black text-white/70"
    >
      E
    </span>
  );
}

export function MusicSettingsSection({ accent = "#22d3ee" }: { accent?: string }) {
  const { track, playing, volume } = useMusic();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [spotifyDraft, setSpotifyDraft] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Resolve the uploaded track reference to a playable object URL. The
  // previous URL is revoked only when replaced, so a second mounted copy of
  // this section (drawer + page) can keep using the element's current src.
  useEffect(() => {
    let cancelled = false;
    if (track?.kind === "upload") {
      loadAudioUrl(track.ref)
        .then((url) => {
          if (cancelled) return;
          setResolvedUrl((previous) => {
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return url;
          });
        })
        .catch(() => {
          if (!cancelled) setResolvedUrl(null);
        });
    } else {
      setResolvedUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [track]);

  // Uploaded tracks: keep the shared element in sync with the store.
  useEffect(() => {
    const el = getSharedUploadAudio();
    if (track?.kind !== "upload" || !resolvedUrl) {
      el.pause();
      el.removeAttribute("src");
      return;
    }
    if (!el.src.endsWith(resolvedUrl)) {
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

  // Built-in generated tracks: drive the synth engine from the store.
  // If this section mounts while the same track is already playing (drawer
  // opened over the app, settings page revisited), the engine is left alone
  // so playback never restarts.
  useEffect(() => {
    if (track?.kind !== "builtin") {
      stopBuiltinTrack();
      return;
    }
    if (!playing) {
      stopBuiltinTrack();
      return;
    }
    if (currentBuiltinTrackId() === track.id) setBuiltinVolume(volume);
    else playBuiltinTrack(track.id, volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.kind === "builtin" ? track.id : null, playing]);

  useEffect(() => {
    setBuiltinVolume(volume);
  }, [volume]);

  /** Press a built-in track: play it; press again to pause. */
  const tapBuiltin = (id: string, name: string) => {
    setError(null);
    if (track?.kind === "builtin" && track.id === id) {
      setMusicPlaying(!playing);
      return;
    }
    setBuiltinTrack(id, name);
    setMusicPlaying(true);
  };

  const activeBuiltinId = track?.kind === "builtin" ? track.id : null;

  const visibleTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILTIN_TRACKS;
    return BUILTIN_TRACKS.filter((item) => `${item.name} ${item.artist}`.toLowerCase().includes(q));
  }, [query]);

  const activeTrack =
    track?.kind === "builtin" ? BUILTIN_TRACKS.find((item) => item.id === track.id) : undefined;

  const onPlayTap = () => {
    if (!track) return;
    if (track.kind === "spotify") {
      window.open(track.url, "_blank", "noopener");
      return;
    }
    setMusicPlaying(!playing);
  };

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
    if (
      !/^https:\/\/(open\.)?spotify\.com\//.test(url) &&
      !url.startsWith("https://spotify.link/")
    ) {
      setError("Paste a spotify.com playlist or track link.");
      return;
    }
    setSpotifyTrack(url, "Spotify playlist");
    setSpotifyDraft("");
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* Now playing card */}
      <div
        className="flex items-center gap-3 rounded-3xl border p-4"
        style={{ borderColor: `${accent}33`, background: `${accent}0d` }}
      >
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `${accent}1f`, color: accent }}
        >
          <Music2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">
            {track ? formatName(track.name) : "No track yet"}
            {activeTrack?.explicit && <ExplicitBadge />}
          </p>
          <p className="text-[11px] text-white/45">
            {track
              ? track.kind === "upload"
                ? "Uploaded track"
                : track.kind === "builtin"
                  ? `${playing ? "Playing" : "Paused"}${activeTrack ? ` · ${activeTrack.artist}${activeTrack.duration ? ` · ${activeTrack.duration}` : ""}` : ""}`
                  : "Spotify link saved"
              : "Press a track below to start the music"}
          </p>
        </div>
        {track && track.kind !== "spotify" && (
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onPlayTap}
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ background: `${accent}33`, color: accent }}
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

      {/* SEARCH — like a music-app playlist header */}
      <div className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4">
        <Search className="size-4 shrink-0 text-white/40" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search songs or artists…"
          aria-label="Search music"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="shrink-0 text-white/40 transition-colors hover:text-white/80"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* TRACK LIST — playlist rows: cover, title, artist · duration, round play button */}
      <div>
        <p className="mb-2 text-[10px] font-black tracking-[0.22em] text-white/40 uppercase">
          Tap a track to play
        </p>
        <div className="space-y-2">
          {visibleTracks.map((item) => {
            const active = activeBuiltinId === item.id;
            const isPlaying = active && playing;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => tapBuiltin(item.id, item.name)}
                className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-transform active:scale-[0.98]"
                style={{
                  borderColor: active ? accent : "rgba(255,255,255,0.12)",
                  background: active ? `${accent}12` : "rgba(255,255,255,0.03)",
                  boxShadow: active ? `0 0 20px ${accent}30` : "none",
                }}
              >
                <span
                  className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                  style={{ background: coverGradient(item.id) }}
                >
                  <Music2 className="size-4 text-white/85" />
                  {isPlaying && <span className="absolute inset-0 bg-black/45" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center truncate text-[14px] font-bold text-white">
                    {item.name}
                    {item.explicit && <ExplicitBadge />}
                  </span>
                  <span className="block truncate text-[11px] text-white/45">
                    {item.artist}
                    {item.duration ? ` • ${item.duration}` : ""}
                  </span>
                </span>
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: isPlaying ? accent : "rgba(255,255,255,0.1)",
                    color: isPlaying ? "#000" : "#fff",
                  }}
                >
                  {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                </span>
              </button>
            );
          })}
          {visibleTracks.length === 0 && (
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/40">
              No songs match “{query}”.
            </p>
          )}
        </div>
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
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed text-sm font-black transition-transform active:scale-[0.98]"
        style={{ borderColor: `${accent}66`, color: accent, background: `${accent}0a` }}
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
        Built-in tracks are generated live in the app — original piano, amapiano and lofi grooves,
        so they're royalty-free and work offline. For artist songs (Chris Brown and more), upload
        them or paste a Spotify link. Your music keeps playing across app screens.
      </p>
    </div>
  );
}
