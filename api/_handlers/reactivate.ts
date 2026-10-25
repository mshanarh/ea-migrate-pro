/**
 * POST /api/reactivate — release a paid account's device binding, SERVER-SIDE.
 *
 * THE FAILURE THIS REPLACES
 * ─────────────────────────
 * The portal's Re-activate Client form used to update a Supabase column from
 * the BROWSER. When that database host stopped resolving, every attempt threw
 * `TypeError: Failed to fetch` at the mentor with no diagnostic — the page could
 * not release anyone, and the client stayed locked to the old device.
 *
 * The unbind now runs here, through the KV store the rest of the platform uses
 * (`KV_REST_API_URL` / `KV_REST_API_TOKEN`), and it clears ONLY the binding:
 *
 *   • payment flag (`isPaid`, `paidAt`)          → untouched
 *   • licence limit / licence keys               → untouched
 *   • subscription / approval state / EA config  → untouched
 *
 * It is admin-only (the same addresses the console trusts), and it refuses an
 * email that is neither registered nor paid, so it can never be used to open
 * the door for an address that bought nothing.
 *
 * TOKEN: the caller charges ONE reactivation token, but only after this endpoint
 * says `ok: true` — the charge is never taken against a failed unbind.
 */
import { clearDeviceIdForEmail, getRegistration, isAdminEmail, kvRead, normalizeEmail } from "./_registry.js";

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
  const admin = normalizeEmail(input["adminEmail"] ?? input["requester"]);

  if (!EMAIL_RE.test(email)) {
    response.status(400).json({ ok: false, error: "a valid email is required" });
    return;
  }
  if (!admin || !isAdminEmail(admin)) {
    console.warn(`[reactivate] refused: requester "${admin || "(missing)"}" is not an administrator`);
    response.status(200).json({ ok: false, error: "Only an administrator can reactivate accounts." });
    return;
  }

  try {
    const registration = await getRegistration(email);
    const kvLicences = Number(await kvRead(["SCARD", `eamp:license-by-client:${email}`])) || 0;
    const paid = registration?.isPaid === true || kvLicences > 0;
    const registered = Boolean(registration) || kvLicences > 0;

    console.info(
      `[reactivate] ${email} requested by ${admin} → registered=${registered ? "yes" : "no"} paid=${paid ? "yes" : "no"} ` +
        `bound=${registration?.deviceId ? "yes" : "no"}`,
    );

    if (!registered) {
      response.status(200).json({ ok: false, error: `Not reactivated — ${email} is not registered in any store.` });
      return;
    }
    if (!paid) {
      response.status(200).json({
        ok: false,
        error: `Not reactivated — ${email} is registered but not marked paid. Ask the platform admin to mark it paid first.`,
      });
      return;
    }

    // DEVICE UNBINDING ONLY — one field, nothing else in the record.
    const previous = await clearDeviceIdForEmail(email);
    const clearedAt = new Date().toISOString();
    console.info(
      `[reactivate] ${email} → device binding cleared ${previous ? `(was ${previous.slice(0, 8)}…)` : "(none was set)"} at ${clearedAt}; payment, licence and subscription untouched`,
    );
    response.status(200).json({ ok: true, clearedAt, previouslyBound: Boolean(previous), chargedTokens: 1 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[reactivate] ${email} → unbind FAILED: ${detail}`);
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: `Device storage error: ${detail}`,
    });
  }
}
