import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(key: string, value: string): void;
};

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
  eaId: z.string().trim().optional(),
  mentorId: z.string().trim().optional(),
});

function createKeyCode() {
  return `EA-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const parsed = bodySchema.safeParse(typeof request.body === "string" ? (JSON.parse(request.body) as unknown) : request.body);
  if (!parsed.success) {
    response.status(400).json({ ok: false, error: "email is required and must be a valid inbox" });
    return;
  }

  const { email, eaId, mentorId } = parsed.data;
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !serviceRole) {
    response.status(503).json({ ok: false, error: "Robot key storage is not configured" });
    return;
  }

  const client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let eaNotFoundError = false;
  if (eaId) {
    const eaRes = await client.from("eas").select("id").eq("id", eaId).maybeSingle();
    const eaError = (eaRes as unknown as { error?: { message: string } }).error;
    if (eaError) {
      console.error("[generate-robot-key] ea lookup failed:", eaError.message);
      response.status(503).json({ ok: false, error: "Could not verify the Expert Advisor" });
      return;
    }
    if (!(eaRes as unknown as { data?: { id: string } }).data?.id) {
      eaNotFoundError = true;
    }
  }
  if (eaNotFoundError) {
    response.status(400).json({ ok: false, error: "That Expert Advisor was not found" });
    return;
  }

  const code = createKeyCode();
  const mentorIdValue = mentorId || null;

  const insertRes = await client.from("host_robot_keys").insert({
    key_code: code,
    ea_id: eaId || null,
    mentor_id: mentorIdValue,
    is_used: false,
    used_by_email: null,
  }).select().single();

  const typedInsert = insertRes as unknown as {
    data: { key_code: string; ea_id: string | null; mentor_id: string | null } | null;
    error: { message: string } | null;
  };

  if (typedInsert.error) {
    console.error("[generate-robot-key] insert failed:", typedInsert.error.message);
    response.status(500).json({ ok: false, error: "Could not create the robot key" });
    return;
  }
  if (!typedInsert.data || !typedInsert.data.key_code) {
    response.status(500).json({ ok: false, error: "Could not create the robot key" });
    return;
  }

  response.status(201).json({ ok: true, key_code: typedInsert.data.key_code, ea_id: typedInsert.data.ea_id, mentor_id: typedInsert.data.mentor_id });
}
