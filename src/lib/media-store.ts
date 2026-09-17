/**
 * IndexedDB-backed storage for the mentors' EA videos.
 *
 * Why: videos are saved as base64 data URLs inside localStorage today, and
 * localStorage caps at ~5MB — a 50MB video becomes a ~67MB string, so
 * "Save Changes" throws a quota error and nothing persists. Blobs in IndexedDB
 * get hundreds of MB, and object URLs play back with zero decode delay (fixing
 * the "double-tap HOME before the video plays" problem in the app).
 *
 * localStorage only ever holds a tiny reference: `idb-video:<id>`.
 */

const DB_NAME = "eamp-media";
const STORE = "videos";
const REF_PREFIX = "idb-video:";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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
  return REF_PREFIX + id;
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
  return blob ? URL.createObjectURL(blob) : null;
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
}
