/**
 * GET/POST /api/bridge-config — THE TRADING BRIDGE'S CURRENT ADDRESS.
 *
 * WHY THIS EXISTS
 * The bridge is published through a cloudflared quick tunnel: every restart of
 * `cloudflared` mints a new hostname. The app used to carry that hostname as a
 * build-time constant (`src/lib/bridge-client.ts`), so the moment the tunnel
 * changed, every quote, candle and order request failed with "Failed to fetch"
 * while the bridge was perfectly online — and the only fix was a code change and
 * a redeploy.
 *
 * The address now lives in the same Upstash KV store as registrations
 * (AGENTS.md: registrations, approval, payment flag and licence limits live
 * there) under `eamp:settings:bridge-url`. The admin console writes it, and the
 * app reads it at start-up through this endpoint, so re-pointing the app at a
 * new tunnel is a console edit with no deploy and no reinstall.
 *
 * CONTRACT
 *   GET  → { ok: true, url }   `url: null` means an admin has not chosen one
 *                              yet, and the app keeps its own default.
 *   POST { url }  → { ok: true, url }   ADMIN ONLY (x-admin-email header, the
 *                              same check /api/admin-users uses).
 *   503 `unavailable: true` — KV is not configured or unreachable; the caller
 *                              must keep the address it already has and say so
 *                              rather than pointing anybody at nothing.
 *
 * Nothing about trading logic, analysis or execution changes here — only the
 * host those requests are sent to.
 */
import {
  adminFromRequest,
  kvCommand,
  parseBody,
  storeConfigured,
  type ApiRequest,
  type ApiResponse,
} from "./_registry.js";

const BRIDGE_URL_KEY = "eamp:settings:bridge-url";

/** Only a plain http(s) origin is ever stored — no paths, no schemes on trial. */
function validBridgeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (!parsed.hostname) return "";
    return raw;
  } catch {
    return "";
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!storeConfigured()) {
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: "Bridge settings storage is not configured on the server.",
    });
    return;
  }

  try {
    if (method === "GET") {
      const saved = await kvCommand(["GET", BRIDGE_URL_KEY]);
      const url = validBridgeUrl(saved);
      response.status(200).json({ ok: true, url: url || null });
      return;
    }

    const admin = adminFromRequest(request);
    if (!admin) {
      response.status(403).json({ ok: false, error: "Only an administrator can change the bridge URL." });
      return;
    }
    const url = validBridgeUrl(parseBody(request)["url"]);
    if (!url) {
      response.status(400).json({ ok: false, error: "Enter a full http(s) address, e.g. https://example.trycloudflare.com" });
      return;
    }
    await kvCommand(["SET", BRIDGE_URL_KEY, url]);
    console.info(`[bridge-config] ${admin} set the bridge URL to ${url}`);
    response.status(200).json({ ok: true, url, setBy: admin });
  } catch (error) {
    console.error("[bridge-config]", error);
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: "Bridge settings storage is unavailable. Please try again.",
    });
  }
}
