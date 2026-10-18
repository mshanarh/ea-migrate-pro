/**
 * EA VIDEO BACKUP — BROWSER ↔ SUPABASE (anon key), no server functions.
 *
 * The three `syncSaveEaVideo / syncLoadEaVideo / syncDeleteEaVideo` helpers
 * this complements are `createServerFn` routes, and the deployed site is a
 * STATIC client build — those routes 404 in production, so
 * `backupVideoToCloud` never saved a byte and `loadVideoUrl`'s restore path
 * never worked on any device but the mentor's own. This module does the same
 * three operations on the `ea_videos` table straight from the browser — the
 * pattern `portal-cloud.ts` established for portal_accounts — and
 * supabase/schema.sql grants that table full anon access
 * (`for all to anon … using (true)`), so no service-role key is involved.
 *
 * Every call is guarded by `portalCloudConfigured()` (the same check the
 * portal uses) and warns on failure: a silently-dropped backup is exactly
 * what made the app report "no video uploaded" for a video that existed.
 */
import { portalCloudConfigured } from "@/lib/portal-cloud";

const TABLE = "ea_videos";

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();

type Client = import("@supabase/supabase-js").SupabaseClient;
let client: Client | null = null;

async function db(): Promise<Client | null> {
  if (!portalCloudConfigured()) {
    console.warn("[media] ea_videos: Supabase is not configured — video backup skipped");
    return null;
  }
  if (!client) {
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Upsert a video backup row. `true` only when the row was actually written. */
export async function saveEaVideoToCloud(videoId: string, dataUrl: string): Promise<boolean> {
  const cleanId = videoId.trim();
  if (!cleanId || !dataUrl) return false;
  const supabase = await db();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { video_id: cleanId, data_url: dataUrl, updated_at: new Date().toISOString() },
        { onConflict: "video_id" },
      );
    if (error) {
      console.warn("[media] ea_videos upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[media] ea_videos upsert threw:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Read a backup's data URL, or `null` when there is none / it cannot be read. */
export async function loadEaVideoFromCloud(videoId: string): Promise<string | null> {
  const cleanId = videoId.trim();
  if (!cleanId) return null;
  const supabase = await db();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data_url")
      .eq("video_id", cleanId)
      .maybeSingle();
    if (error) {
      console.warn("[media] ea_videos read failed:", error.message);
      return null;
    }
    const row = data as { data_url?: unknown } | null;
    return typeof row?.data_url === "string" && row.data_url ? row.data_url : null;
  } catch (error) {
    console.warn("[media] ea_videos read threw:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Delete a backup row. `true` only when the row is gone (or never existed). */
export async function deleteEaVideoFromCloud(videoId: string): Promise<boolean> {
  const cleanId = videoId.trim();
  if (!cleanId) return true;
  const supabase = await db();
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(TABLE).delete().eq("video_id", cleanId);
    if (error) {
      console.warn("[media] ea_videos delete failed:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[media] ea_videos delete threw:", error instanceof Error ? error.message : error);
    return false;
  }
}
