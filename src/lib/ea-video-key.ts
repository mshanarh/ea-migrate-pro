/**
 * THE MENTOR → LICENCE-KEY VIDEO LINK.
 *
 * A mentor's robot video lives in the `ea_videos` media store (browser-direct,
 * anon key) as a base64 MP4 row. That row is what every device can read — but
 * until now NOTHING tied it to the licence key, so an activated robot had no
 * way to find it: the home screen only ever read `robot.video` from local state,
 * which the mentor's upload never reached. The card then honestly (and wrongly)
 * said "No robot video yet".
 *
 * This module turns the mentor's upload into the two values the licence record
 * carries (see api/_handlers/licenses.ts):
 *
 *   videoId — `ea-<eaId>`, the `ea_videos` row holding the bytes (the normal
 *             case: a real MP4 is far too big for the licence store),
 *   video   — a small playable source, used verbatim when it already is one
 *             (an http(s) URL, or a tiny clip under INLINE_VIDEO_MAX_CHARS).
 *
 * The upload is idempotent per device: the row id is derived from the EA, and a
 * marker remembers which local reference produced it, so saving an EA again
 * does not re-upload megabytes.
 */
import { loadEaVideoFromCloud, saveEaVideoToCloud } from "@/lib/ea-video-cloud";
import { loadVideoUrl } from "@/lib/media-store";

/** Same ceiling the media store already enforces for cloud travel. */
const CLOUD_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

/** A source this small is cheaper to carry inline than to fetch as a row. */
const INLINE_VIDEO_MAX_CHARS = 200_000;

const MARKER_PREFIX = "eamp.ea-video.sync:";

/** The stable media-store row id for one EA's robot video. */
export function eaVideoRowId(eaId: string | undefined): string | null {
  const clean = (eaId ?? "").trim();
  return clean ? `ea-${clean}` : null;
}

function readMarker(rowId: string): string | null {
  try {
    return window.localStorage.getItem(`${MARKER_PREFIX}${rowId}`);
  } catch {
    return null;
  }
}

function writeMarker(rowId: string, ref: string): void {
  try {
    window.localStorage.setItem(`${MARKER_PREFIX}${rowId}`, ref);
  } catch {
    /* storage blocked — the row still exists, the next save just re-checks it */
  }
}

/** The video behind a local reference, as a data URL the media store can hold. */
async function asDataUrl(video: string): Promise<string | null> {
  if (video.startsWith("data:")) return video;
  if (/^https?:\/\//i.test(video)) return null; // already a URL — nothing to copy
  const url = await loadVideoUrl(video);
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size > CLOUD_VIDEO_MAX_BYTES) {
      console.warn(
        `[ea-video] video is ${(blob.size / (1024 * 1024)).toFixed(1)} MB — over the 20 MB limit for the key link; ` +
          "the robot card will have no video until a smaller MP4 is uploaded",
      );
      return null;
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * WHAT THE LICENCE RECORD SHOULD CARRY FOR THIS EA'S VIDEO.
 *
 * `{}` means the EA has no video (or it could not be linked — the console says
 * which). The caller merges the result into the issue / update-ea request, so
 * every key for this EA resolves the video from then on.
 */
export async function cloudVideoPointer(ea: {
  id?: string | undefined;
  video?: string | undefined;
}): Promise<{ video?: string; videoId?: string }> {
  const video = ea.video?.trim();
  if (!video) return {};
  // A URL plays as-is in the WebView — no media row required.
  if (/^https?:\/\//i.test(video)) return { video };
  // A tiny inline clip is simpler than a second round trip.
  if (video.startsWith("data:") && video.length <= INLINE_VIDEO_MAX_CHARS) return { video };

  const rowId = eaVideoRowId(ea.id);
  if (!rowId) {
    console.warn("[ea-video] the EA has no id — the video cannot be linked to its keys");
    return {};
  }
  const existing = await loadEaVideoFromCloud(rowId);
  if (existing && readMarker(rowId) === video) return { videoId: rowId };

  const dataUrl = await asDataUrl(video).catch(() => null);
  if (!dataUrl) return existing ? { videoId: rowId } : {};
  if (await saveEaVideoToCloud(rowId, dataUrl)) {
    writeMarker(rowId, video);
    return { videoId: rowId };
  }
  console.warn("[ea-video] the video could not be stored for this EA's keys");
  return existing ? { videoId: rowId } : {};
}
