import { useSyncExternalStore } from "react";
import { deleteAudioBlob } from "@/lib/media-store";

/**
 * Relaxation-music state for the app.
 *
 * - The user uploads any audio file from their phone (mp3, m4a, wav, ogg…).
 *   It is stored as a Blob in IndexedDB (via media-store) and only the tiny
 *   `idb-audio:<id>` reference is persisted in localStorage.
 * - A direct Spotify playlist / track / album link can also be saved — it is
 *   shown in the player pill and opens in a new tab (browsers do not allow
 *   embedding the Spotify web player without an SDK session, so a tap-out is
 *   the reliable cross-device behaviour).
 * - `playing` is deliberately NOT persisted: autoplay policies block sound on
 *   page load, so playback always starts from an explicit user tap.
 */

export type TrackSource =
  | { kind: "builtin"; id: string; name: string }
  | { kind: "preview"; id: string; name: string; url: string }
  | { kind: "upload"; ref: string; name: string }
  | { kind: "spotify"; url: string; name: string };

type MusicState = {
  track: TrackSource | null;
  playing: boolean;
  volume: number;
};

const KEY = "eamp.music.v1";

const initial: MusicState = { track: null, playing: false, volume: 0.6 };

let state: MusicState = initial;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<MusicState>;
      state = {
        track: (saved.track as MusicState["track"]) ?? null,
        // Autoplay policies: never restore "playing" across reloads.
        playing: false,
        volume: typeof saved.volume === "number" ? saved.volume : initial.volume,
      };
    }
  } catch {
    /* ignore malformed data */
  }
}

function persist() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify({ track: state.track, volume: state.volume }));
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: MusicState = { ...initial, playing: false };

export function useMusic() {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
}

export function setUploadedTrack(ref: string, name: string) {
  load();
  state = { ...state, track: { kind: "upload", ref, name } };
  persist();
}

export function setSpotifyTrack(url: string, name: string) {
  load();
  state = { ...state, track: { kind: "spotify", url, name } };
  persist();
}

/** Selects one of the built-in generated tracks (Settings → Music grid). */
export function setBuiltinTrack(id: string, name: string) {
  load();
  state = { ...state, track: { kind: "builtin", id, name } };
  persist();
}

/** Selects a real-recording preview (official Apple Music 30s stream). */
export function setPreviewTrack(id: string, name: string, url: string) {
  load();
  state = { ...state, track: { kind: "preview", id, name, url } };
  persist();
}

export function setMusicPlaying(playing: boolean) {
  load();
  state = { ...state, playing };
  listeners.forEach((listener) => listener());
}

export function setMusicVolume(volume: number) {
  load();
  state = { ...state, volume };
  persist();
}

export async function removeMusicTrack() {
  load();
  const current = state.track;
  if (current?.kind === "upload") await deleteAudioBlob(current.ref);
  state = { ...state, track: null, playing: false };
  persist();
}
