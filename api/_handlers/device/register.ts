/**
 * POST /api/device/register — { email, fcm_token, device_name }.
 * Upserts on fcm_token (unique): re-registering the same device refreshes the
 * row; a second device simply adds another row for the same email. Both are
 * "upsert token for email" — see supabase/trade-notifications.sql.
 * Service-role only: the anon key has no policy on device_tokens.
 */
import { createClient } from "@supabase/supabase-js";

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(key: string, value: string): void;
};

function body(request: ApiRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (request.body ?? {}) as Record<string, unknown>;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const input = body(request);
  const email = String(input["email"] ?? "").trim().toLowerCase();
  const token = String(input["fcm_token"] ?? "").trim();
  const deviceName = String(input["device_name"] ?? "").trim().slice(0, 120) || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !token) {
    response.status(400).json({ ok: false, error: "email and fcm_token are required" });
    return;
  }
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !serviceRole) {
    response.status(503).json({ ok: false, error: "Device storage is not configured" });
    return;
  }
  try {
    const db = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await db
      .from("device_tokens")
      .upsert({ email, fcm_token: token, device_name: deviceName }, { onConflict: "fcm_token" });
    if (error) throw new Error(error.message);
    response.status(200).json({ ok: true });
  } catch (error) {
    console.error("[device-register]", error);
    response.status(500).json({ ok: false, error: "Could not save this device" });
  }
}
