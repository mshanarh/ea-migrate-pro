/**
 * THE ROBOT VIDEO, RESOLVED BY LICENCE KEY.
 *
 * The video belongs to the KEY, not to a device and not to the mentor's
 * session. `GET /api/licenses` action `ea-config` answers with the record for
 * the key the robot already holds, and that record carries either
 *
 *   video   — a playable source (http(s) URL, or a small data URL), or
 *   videoId — `ea-<eaId>`, the `ea_videos` media row holding the bytes.
 *
 * THE ANSWER IS TRI-STATE ON PURPOSE, because the toast is a claim:
 *
 *   found       — the server knows this key's video and it was resolved.
 *   none        — the server ANSWERED and this key's EA has no video. Only
 *                 this case may tell the trader "your mentor can upload one".
 *   unavailable — the store could not be asked / the media row could not be
 *                 read. That is a retryable ERROR, never a "no video" claim.
 *
 * The resolved value is always something the media layer already understands:
 * a data URL, an http(s) URL, or an `idb-video:` reference (an oversized data
 * URL is stashed locally so localStorage never takes the hit).
 */
import { loadEaVideoFromCloud } from "@/lib/ea-video-cloud";
import { fetchEaConfigsInKv } from "@/lib/license-cloud";
import { travelSizedVideo } from "@/lib/media-store";

export type RobotVideoLookup =
  | { status: "found"; video: string; from: "record" | "store" }
  | { status: "none" }
  | { status: "unavailable"; error: string };

/** The playable local form of a video source, or null when it cannot be kept. */
async function stash(source: string): Promise<string | null> {
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return source;
  const sized = await travelSizedVideo(source);
  return sized ?? null;
}

/**
 * ASK THE SERVER FOR THIS KEY'S VIDEO.
 *
 * Never throws: every failure is `unavailable` with a human reason, so the
 * caller can offer a Retry instead of pretending the mentor uploaded nothing.
 */
export async function lookupRobotVideoForKey(key: string | undefined): Promise<RobotVideoLookup> {
  const clean = (key ?? "").trim().toUpperCase();
  if (!clean) {
    // No key at all means no robot licenced — nothing to look up, and nothing
    // the server could confirm either way.
    return { status: "none" };
  }
  const answer = await fetchEaConfigsInKv([clean]);
  if (!answer.enabled || !answer.ok) {
    return {
      status: "unavailable",
      error: answer.error ?? "The licence server could not be reached.",
    };
  }
  const config = answer.configs.find((entry) => entry.key.trim().toUpperCase() === clean);
  if (!config) {
    // The store answered honestly: it holds no record for this key (an
    // unactivated or invalid key), so it can have no video.
    return { status: "none" };
  }
  if (typeof config.video === "string" && config.video.trim() && !config.video.startsWith("idb-video:")) {
    const video = await stash(config.video.trim());
    if (video) return { status: "found", video, from: "record" };
  }
  if (typeof config.videoId === "string" && config.videoId.trim()) {
    const dataUrl = await loadEaVideoFromCloud(config.videoId.trim());
    if (!dataUrl) {
      return {
        status: "unavailable",
        error: `The video record for this key (${config.videoId}) could not be read.`,
      };
    }
    const video = await stash(dataUrl);
    if (!video) {
      return { status: "unavailable", error: "The video could not be stored on this device." };
    }
    return { status: "found", video, from: "store" };
  }
  // The record exists and carries no video pointer at all — the mentor has not
  // linked one. This is the ONE honest "no video" answer.
  return { status: "none" };
}
