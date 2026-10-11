import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { HostRobotKey } from "@/lib/supabase";

export type GenerateRobotKeyResult =
  | { ok: true; key_code: string; ea_id: string | null; mentor_id: string | null }
  | { ok: false; error: string };

export async function generateRobotKey(
  email: string,
  eaId?: string,
  mentorId?: string,
): Promise<GenerateRobotKeyResult> {
  if (!supabaseConfigured || !supabase) {
    return { ok: false, error: "Robot keys are not configured" };
  }
  const code = `EA-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const { data, error } = await supabase
    .from("host_robot_keys")
    .insert({
      key_code: code,
      ea_id: eaId || null,
      mentor_id: mentorId || null,
      is_used: false,
      used_by_email: null,
    })
    .select()
    .single() as unknown as { data: HostRobotKey | null; error: { message: string } | null };

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "No robot key was created" };
  }
  return { ok: true, key_code: data.key_code, ea_id: data.ea_id, mentor_id: data.mentor_id };
}
