/**
 * IndexedDB-backed storage for the mentors' EA videos and the user's own
 * relaxation music.
 *
 * Why: videos are saved as base64 data URLs inside localStorage today, and
 * localStorage caps at ~5MB — a 50MB video becomes a ~67MB string, so
 * "Save Changes" throws a quota error and nothing persists. Blobs in IndexedDB
 * get hundreds of MB, and object URLs play back with zero decode delay (fixing
 * the "double-tap HOME before the video plays" problem in the app).
 *
 * localStorage only ever holds a tiny reference: `idb-video:<id>` for videos
 * and `idb-audio:<id>` for music tracks.
 */

const DB_NAME = "eamp-media";
const STORE = "videos";
const AUDIO_STORE = "audio";
const IMAGE_STORE = "images";
const REF_PREFIX = "idb-video:";
const AUDIO_REF_PREFIX = "idb-audio:";
const IMAGE_REF_PREFIX = "idb-image:";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(AUDIO_STORE)) request.result.createObjectStore(AUDIO_STORE);
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) request.result.createObjectStore(IMAGE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

/** Saves the raw file and returns the tiny reference string for localStorage. */
export async function saveVideoBlob(file: Blob): Promise<string> {
  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not store the video"));
  });
  db.close();
  // Best-effort cloud backup so the upload survives storage evictions and
  // other devices. Fire-and-forget: the local save already succeeded.
  void backupVideoToCloud(id, file);
  return REF_PREFIX + id;
}

/** Copies an uploaded video into the cloud store (no-op when unconfigured). */
async function backupVideoToCloud(id: string, file: Blob): Promise<void> {
  try {
    const { syncSaveEaVideo } = await import("@/lib/account-sync.server");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
    await syncSaveEaVideo({ data: { videoId: id, dataUrl } });
  } catch {
    /* offline or cloud not configured — the local copy still works */
  }
}

/** Loads the blob for a reference and hands back a playback-ready object URL. */
export async function loadVideoUrl(ref: string): Promise<string | null> {
  if (!ref.startsWith(REF_PREFIX)) return null; // plain data URL or http URL
  const id = ref.slice(REF_PREFIX.length);
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load the video"));
  });
  db.close();
  if (blob) return URL.createObjectURL(blob);
  // Local blob evicted — silently restore it from the cloud backup (if any)
  // so the mentor never has to re-upload. Restored blobs are re-cached locally.
  try {
    const { syncLoadEaVideo } = await import("@/lib/account-sync.server");
    const backup = await syncLoadEaVideo({ data: { videoId: id } });
    if (!backup.enabled || !backup.dataUrl) return null;
    const response = await fetch(backup.dataUrl);
    const restored = await response.blob();
    const db2 = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db2.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(restored, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db2.close();
    return URL.createObjectURL(restored);
  } catch {
    return null;
  }
}

/** Deletes the blob behind a reference (call when a video is replaced/removed). */
export async function deleteVideoBlob(ref: string | undefined): Promise<void> {
  if (!ref || !ref.startsWith(REF_PREFIX)) return;
  const id = ref.slice(REF_PREFIX.length);
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
  // Remove the cloud backup too — only an explicit delete/replace reaches here.
  try {
    const { syncDeleteEaVideo } = await import("@/lib/account-sync.server");
    await syncDeleteEaVideo({ data: { videoId: id } });
  } catch {
    /* ignore */
  }
}

/* ── Cross-device travel helpers ─────────────────────────────────────────── */

/** Largest video inlined into the cloud mirror (an ~8 MB data URL row). */
const CLOUD_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
/** Data URLs above this size never ride inside localStorage robots — they are
 * stashed in IndexedDB and the robot keeps a tiny `idb-video:` ref instead. */
const INLINE_VIDEO_MAX_CHARS = 768 * 1024;

/**
 * Turns a local IndexedDB video REF into a self-contained data URL so the
 * cloud portal record carries playable media to every other device. Bare
 * refs mean nothing off this device — this is why the robot picture used to
 * arrive everywhere while the video never played. Data URLs and http URLs
 * already travel and pass straight through; oversized blobs return
 * undefined (the image still travels).
 */
export async function inlineVideoForCloud(video: string | undefined): Promise<string | undefined> {
  if (!video) return undefined;
  if (!video.startsWith(REF_PREFIX)) return video;
  try {
    const url = await loadVideoUrl(video);
    if (!url) return undefined;
    try {
      const blob = await (await fetch(url)).blob();
      if (blob.size > CLOUD_VIDEO_MAX_BYTES) return undefined;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(blob);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return undefined;
  }
}

/**
 * Makes a cloud-sourced video safe to keep in the app's localStorage robots:
 * small data URLs pass through, big ones are stashed in IndexedDB behind a
 * tiny ref so persist() never hits the quota wall. Refs and http URLs pass
 * through untouched.
 */
export async function travelSizedVideo(video: string | undefined): Promise<string | undefined> {
  if (!video || !video.startsWith("data:")) return video;
  if (video.length <= INLINE_VIDEO_MAX_CHARS) return video;
  try {
    const blob = await (await fetch(video)).blob();
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not store the video"));
    });
    db.close();
    return REF_PREFIX + id;
  } catch {
    return undefined;
  }
}

/* ── Music tracks (uploaded audio) — same pattern as the video store ─────── */

/** Saves an audio file and returns the tiny reference string for localStorage. */
export async function saveAudioBlob(file: Blob): Promise<string> {
  const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not store the audio"));
  });
  db.close();
  return AUDIO_REF_PREFIX + id;
}

/** Loads the audio blob for a reference and hands back a playback-ready object URL. */
export async function loadAudioUrl(ref: string): Promise<string | null> {
  if (!ref.startsWith(AUDIO_REF_PREFIX)) return null; // plain http(s) URL passes through
  const id = ref.slice(AUDIO_REF_PREFIX.length);
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readonly");
    const request = tx.objectStore(AUDIO_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load the audio"));
  });
  db.close();
  return blob ? URL.createObjectURL(blob) : null;
}

/** Deletes the audio blob behind a reference (call when a track is removed). */
export async function deleteAudioBlob(ref: string | undefined): Promise<void> {
  if (!ref || !ref.startsWith(AUDIO_REF_PREFIX)) return;
  const id = ref.slice(AUDIO_REF_PREFIX.length);
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/* ── Brand images (custom app logo) — same pattern, one more store ─────── */

/** Saves an image file and returns the tiny reference string for localStorage. */
export async function saveImageBlob(file: Blob): Promise<string> {
  const id = `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not store the image"));
  });
  db.close();
  return IMAGE_REF_PREFIX + id;
}

/** Loads the image blob for a reference and hands back a display-ready object URL. */
export async function loadImageUrl(ref: string): Promise<string | null> {
  if (!ref.startsWith(IMAGE_REF_PREFIX)) return null; // plain http(s)/path passes through
  const id = ref.slice(IMAGE_REF_PREFIX.length);
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load the image"));
  });
  db.close();
  return blob ? URL.createObjectURL(blob) : null;
}

/** Deletes the image blob behind a reference (call when the logo is reset). */
export async function deleteImageBlob(ref: string | undefined): Promise<void> {
  if (!ref || !ref.startsWith(IMAGE_REF_PREFIX)) return;
  const id = ref.slice(IMAGE_REF_PREFIX.length);
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}
