/**
 * MENTOR → LICENCE-KEY VIDEO LINK — the one that actually lands.
 *
 * WHAT WAS BROKEN (measured in production): the first version copied the MP4
 * into a Supabase `ea_videos` row and only logged a console warning when that
 * failed. On the real deployment it failed — the mentor's blob was no longer on
 * the device and the upload went nowhere — so `Save Changes` wrote the licence
 * record with NO pointer at all (`ea-config` answered key + eaId + eaName +
 * symbols + image + updatedAt, and no video).
 *
 * WHAT THIS DOES NOW: the bytes go into the SAME Upstash KV store that holds the
 * licence records (the store that demonstrably answers), base64-chunked so no
 * single request comes near the KV body limit, and then ONE `video-link` call
 * writes the pointer onto EVERY key of the EA (idempotent: the same call twice
 * changes nothing).
 *
 * EVERY OUTCOME IS RETURNED — `none`, `linked` (with how many keys), or
 * `failed` (with a sentence the mentor can act on). Nothing is ever silent, and
 * a missing local file tells the mentor to re-attach the MP4.
 */
import { linkEaVideoInKv, putEaVideoChunkInKv } from "@/lib/license-cloud";
import { loadVideoUrl } from "@/lib/media-store";

/** Same ceiling the media store already enforces for cloud travel. */
const CLOUD_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

/** A source this small is cheaper to carry inline than to chunk. */
const INLINE_VIDEO_MAX_CHARS = 200_000;

/** Under the server's 600 000-character cap and Upstash's ~1 MB body limit. */
const CHUNK_CHARS = 500_000;

/** The server refuses more chunks than this (64 × 500 KB ≈ 32 MB). */
const MAX_CHUNKS = 64;

export type EaVideoLinkResult =
  | { status: "none" }
  | {
      status: "linked";
      keysLinked: number;
      keysForMentor: number;
      chunks: number;
      bytes: number;
      inline: boolean;
    }
  | { status: "failed"; error: string };

/** The video behind a local reference, as a data URL the store can carry. */
async function asDataUrl(video: string): Promise<string | null> {
  if (video.startsWith("data:")) return video;
  if (/^https?:\/\//i.test(video)) return null; // a URL travels as itself
  // `idb-video:` (and anything else the media layer understands): resolve the
  // blob — this also restores it from the cloud backup when the local copy was
  // evicted, which is the difference between "linked" and "re-attach the file".
  const url = await loadVideoUrl(video);
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size > CLOUD_VIDEO_MAX_BYTES) {
      console.warn(
        `[ea-video] video is ${(blob.size / (1024 * 1024)).toFixed(1)} MB — over the 20 MB limit for the key link`,
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
 * LINK THIS EA'S VIDEO TO EVERY KEY OF THAT EA.
 *
 * Call it after an EA save or a key issue; the reply is what the portal shows.
 */
export async function linkEaVideo(ea: {
  mentorEmail: string;
  id?: string | undefined;
  name?: string | undefined;
  video?: string | undefined;
}): Promise<EaVideoLinkResult> {
  const mentorEmail = (ea.mentorEmail ?? "").trim().toLowerCase();
  if (!mentorEmail) {
    return { status: "failed", error: "No mentor account is signed in — the video was NOT linked." };
  }
  const video = ea.video?.trim();
  if (!video) return { status: "none" };

  const inline =
    /^https?:\/\//i.test(video) || (video.startsWith("data:") && video.length <= INLINE_VIDEO_MAX_CHARS);

  if (inline) {
    const reply = await linkEaVideoInKv({
      mentorEmail,
      ...(ea.id ? { eaId: ea.id } : {}),
      ...(ea.name ? { eaName: ea.name } : {}),
      video,
    });
    if (!reply.enabled) {
      return {
        status: "failed",
        error: `The licence store could not be reached — the video was NOT linked${reply.error ? ` (${reply.error})` : ""}.`,
      };
    }
    if (!reply.ok) {
      return { status: "failed", error: reply.error ?? "The video could not be linked." };
    }
    const keysLinked = reply.keysLinked ?? 0;
    if (keysLinked === 0) {
      return {
        status: "failed",
        error: `The video is stored, but no licence key is linked to this EA yet (${reply.keysForMentor ?? 0} key(s) on this account). Generate a key for this EA, then press Save Changes again.`,
      };
    }
    return { status: "linked", keysLinked, keysForMentor: reply.keysForMentor ?? keysLinked, chunks: 0, bytes: video.length, inline: true };
  }

  const dataUrl = await asDataUrl(video).catch(() => null);
  if (!dataUrl) {
    return {
      status: "failed",
      error:
        "The video file is not on this device any more, so it could NOT be linked. Open Edit EA, attach the MP4 again and press Save Changes.",
    };
  }
  if (!ea.id) {
    return { status: "failed", error: "This EA has no id — the video cannot be linked to its keys." };
  }

  const total = Math.max(1, Math.ceil(dataUrl.length / CHUNK_CHARS));
  if (total > MAX_CHUNKS) {
    return {
      status: "failed",
      error: `That video is too large to store for a key (${(dataUrl.length / (1024 * 1024)).toFixed(1)} MB of base64). Use an MP4 under 20 MB.`,
    };
  }
  for (let index = 0; index < total; index += 1) {
    const chunk = dataUrl.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS);
    const put = await putEaVideoChunkInKv({ mentorEmail, eaId: ea.id, index, total, data: chunk });
    if (!put.enabled) {
      return {
        status: "failed",
        error: `The upload stopped at part ${index + 1} of ${total}: the licence store could not be reached. The video was NOT linked.`,
      };
    }
    if (!put.ok) {
      return {
        status: "failed",
        error: `The upload stopped at part ${index + 1} of ${total}: ${put.error ?? "the store refused that part"}. The video was NOT linked.`,
      };
    }
  }

  const reply = await linkEaVideoInKv({
    mentorEmail,
    eaId: ea.id,
    ...(ea.name ? { eaName: ea.name } : {}),
    chunks: total,
    bytes: dataUrl.length,
  });
  if (!reply.enabled) {
    return {
      status: "failed",
      error: `The video was uploaded in ${total} part(s) but the link could not be written — the licence store did not answer${reply.error ? ` (${reply.error})` : ""}. Try Save Changes again.`,
    };
  }
  if (!reply.ok) {
    return { status: "failed", error: reply.error ?? "The video could not be linked." };
  }
  const keysLinked = reply.keysLinked ?? 0;
  if (keysLinked === 0) {
    return {
      status: "failed",
      error: `The video is stored (${total} part(s)), but no licence key is linked to this EA yet (${reply.keysForMentor ?? 0} key(s) on this account). Generate a key for this EA, then press Save Changes again.`,
    };
  }
  return {
    status: "linked",
    keysLinked,
    keysForMentor: reply.keysForMentor ?? keysLinked,
    chunks: total,
    bytes: dataUrl.length,
    inline: false,
  };
}
