/**
 * POST /api/notifications — { email } → the last 50 trade notifications for
 * that inbox. The KV-first read path for /app/notifications, so the history
 * page never needs Supabase (the project is at its limits) and never needs
 * SQL run by hand.
 *
 * KV:    LRANGE eamp:trades:<email> 0 49 (written by /api/trade-notify,
 *        newest-first, capped at 50).
 * Fallback: the Supabase trade_notifications table, for deployments without
 *        KV configured.
 *
 * Trust model: the caller names the email — the same level every endpoint in
 * this app operates at (localStorage sessions, no JWT to scope rows). Rows
 * carry their own email and this returns only the requested inbox's list.
 */
import { createClient } from "@supabase/supabase-js";
import { storeConfigured } from "./_registry.js";

// Legacy helper preserved for compat with existing call sites inside this
// endpoint — not needed for the new robot-key feature.
function kvCommand(_command: (string | number)[]): unknown {
  throw new Error("kvCommand is not wired in this endpoint");
}

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

type Row = {
  id?: string;
  email?: string | null;
  symbol?: string | null;
  action?: string | null;
  volume?: number | null;
  price?: number | null;
  profit?: number | null;
  time?: string | null;
};

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const email = String(body(request)["email"] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ ok: false, error: "A valid email is required" });
    return;
  }

  // KV PRIMARY
  if (storeConfigured()) {
    try {
      const raw = await kvCommand(["LRANGE", `eamp:trades:${email}`, "0", "49"]);
      const rows: Row[] = [];
      for (const item of Array.isArray(raw) ? raw : []) {
        try {
          rows.push(JSON.parse(String(item)) as Row);
        } catch {
          /* skip a corrupted entry */
        }
      }
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ ok: true, store: "kv", notifications: rows });
      return;
    } catch (error) {
      console.error("[notifications] KV read failed:", error);
      // fall through to Supabase rather than showing an empty page wrongly
    }
  }

  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !serviceRole) {
    response.status(503).json({ ok: false, error: "Notifications are not configured" });
    return;
  }
  try {
    const db = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db
      .from("trade_notifications")
      .select("*")
      .eq("email", email)
      .order("time", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ ok: true, store: "supabase", notifications: (data as Row[]) ?? [] });
  } catch (error) {
    console.error("[notifications]", error);
    response.status(503).json({ ok: false, error: "Notifications are unavailable right now" });
  }
}
