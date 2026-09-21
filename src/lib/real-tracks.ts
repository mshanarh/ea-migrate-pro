/**
 * Real-recording resolver for the songs playlist.
 *
 * The songs in Settings → Music are real artist songs, so the app resolves
 * each one against Apple's public iTunes Search API and plays the OFFICIAL
 * 30-second preview stream (the real recording, real artist, real album art).
 * No API key, no login, fully legal — Apple hosts the preview files.
 *
 * Results are cached in localStorage per song so the network is only hit once
 * per track per device, and repeated taps start instantly.
 */

export type RealTrackInfo = {
  /** Direct m4a stream URL of the official preview (30s). */
  previewUrl: string;
  /** Real album artwork (square JPEG, upscaled from Apple's 100x100). */
  artworkUrl: string;
  /** Artist name as Apple lists it — may refine what we display. */
  artistName: string;
  /** Full song length in mm:ss (the preview itself is 30s). */
  durationLabel: string;
  /** Link to the song on Apple Music. */
  trackViewUrl: string;
};

const CACHE_KEY = "eamp.music.realtracks.v1";

let cache: Record<string, RealTrackInfo> = {};
let cacheLoaded = false;

function loadCache() {
  if (cacheLoaded || typeof window === "undefined") return;
  cacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) cache = JSON.parse(raw) as Record<string, RealTrackInfo>;
  } catch {
    cache = {};
  }
}

function saveCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* cache is best-effort */
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Looks up the official preview for a song. `artistHint` narrows the search.
 * Returns null when Apple has no match (e.g. underground/Spotify-only drops).
 */
export async function resolveRealTrack(
  title: string,
  artistHint: string,
): Promise<RealTrackInfo | null> {
  loadCache();
  const key = `${title}|${artistHint}`.toLowerCase();
  const cached = cache[key];
  if (cached) return cached;

  try {
    const term = encodeURIComponent(`${title} ${artistHint}`);
    const response = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=5`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{
        previewUrl?: string;
        artworkUrl100?: string;
        artistName?: string;
        trackName?: string;
        trackTimeMillis?: number;
        trackViewUrl?: string;
      }>;
    };

    const wanted = title
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .trim();
    const artistWanted = artistHint.split(/[,/]/)[0]?.trim().toLowerCase() ?? "";
    const best = (data.results ?? []).find((item) => {
      if (!item.previewUrl) return false;
      const name = (item.trackName ?? "").toLowerCase();
      const artist = (item.artistName ?? "").toLowerCase();
      const nameMatch =
        name.includes(wanted) || wanted.includes(name.replace(/\(.*?\)/g, "").trim());
      const artistMatch =
        !artistWanted || artist.includes(artistWanted) || artistWanted.includes(artist);
      return nameMatch && artistMatch;
    });

    const hit = best ?? (data.results ?? []).find((item) => item.previewUrl);
    if (!hit?.previewUrl) return null;

    const info: RealTrackInfo = {
      previewUrl: hit.previewUrl,
      // Upscale Apple's 100px artwork to a crisper 300px square.
      artworkUrl: (hit.artworkUrl100 ?? "").replace("/100x100", "/300x300"),
      artistName: hit.artistName ?? artistHint,
      durationLabel: formatDuration(hit.trackTimeMillis),
      trackViewUrl: hit.trackViewUrl ?? "",
    };
    cache[key] = info;
    saveCache();
    return info;
  } catch {
    return null;
  }
}

/** Synchronous cache peek so the UI can show real artwork instantly on revisit. */
export function peekRealTrack(title: string, artistHint: string): RealTrackInfo | null {
  loadCache();
  return cache[`${title}|${artistHint}`.toLowerCase()] ?? null;
}
