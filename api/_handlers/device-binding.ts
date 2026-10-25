/**
 * POST /api/device-binding — the ONE-EMAIL-ONE-DEVICE rule, server-side.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The binding used to be read and written by the BROWSER straight into a
 * Supabase column. In this deployment that database host does not resolve, so
 * every read answered "unbound" and every write threw `TypeError: Failed to
 * fetch`:
 *
 *   • device enforcement stopped existing — the same email signed in on the web
 *     and then opened on a phone without being asked for reactivation;
 *   • the portal's Re-activate Client action failed with a raw network error
 *     and never released anything.
 *
 * The binding now lives in the KV registration record (`eamp:registrations`,
 * field `deviceId`) — the same store AGENTS.md names for registrations,
 * approval state, payment and licence limits — and only the server touches it.
 *
 * ACTIONS
 *   read → { ok, bound, deviceId }        — who holds this email right now
 *   bind → { ok, bound, deviceId, boundToOtherDevice }
 *
 * `bind` NEVER steals a binding: an email already held by a different device is
 * refused, and the client shows "Contact admin for reactivation". An email that
 * has never been bound binds to this device.
 */
import { getDeviceIdForEmail, normalizeEmail, setDeviceIdForEmail, storeConfigured } from "./_registry.js";

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

function body(request: ApiRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const input = body(request);
  const email = normalizeEmail(input["email"]);
  const deviceId = typeof input["deviceId"] === "string" ? input["deviceId"].trim() : "";
  const action = input["action"] === "bind" ? "bind" : "read";

  if (!EMAIL_RE.test(email)) {
    response.status(400).json({ ok: false, error: "a valid email is required" });
    return;
  }
  if (action === "bind" && !deviceId) {
    response.status(400).json({ ok: false, error: "deviceId is required to bind" });
    return;
  }
  if (!storeConfigured()) {
    // UNCONFIGURED, NOT UNBOUND — the caller must be able to tell the two apart
    // so an unreadable store can never be mistaken for "nobody owns this".
    response.status(503).json({ ok: false, unavailable: true, error: "Device storage is not configured" });
    return;
  }

  try {
    const current = await getDeviceIdForEmail(email);

    if (action === "read") {
      console.info(
        `[device-binding] ${email} → read: ${current ? (current === deviceId ? "this device" : "another device") : "unbound"} (${current ? current.slice(0, 8) + "…" : "none"})`,
      );
      response.status(200).json({
        ok: true,
        bound: Boolean(current),
        deviceId: current,
        thisDevice: current === deviceId,
        boundToOtherDevice: Boolean(current && current !== deviceId),
      });
      return;
    }

    if (current === deviceId) {
      response.status(200).json({ ok: true, bound: true, deviceId: current, boundToOtherDevice: false });
      return;
    }
    if (current) {
      console.warn(`[device-binding] ${email} → bind REFUSED: already held by ${current.slice(0, 8)}…`);
      response.status(200).json({
        ok: false,
        bound: true,
        deviceId: current,
        boundToOtherDevice: true,
        error: "Contact admin for reactivation",
      });
      return;
    }

    await setDeviceIdForEmail(email, deviceId);
    console.info(`[device-binding] ${email} → bound to ${deviceId.slice(0, 8)}…`);
    response.status(200).json({ ok: true, bound: true, deviceId, boundToOtherDevice: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[device-binding] ${email} → ${action} failed: ${detail}`);
    response.status(503).json({ ok: false, unavailable: true, error: `Device storage error: ${detail}` });
  }
}
