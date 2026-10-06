/** GET /api/admin-users — every registration for the admin console. */
import { adminFromRequest, listRegistrations, type ApiRequest, type ApiResponse } from "./_registry.js";

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!adminFromRequest(request)) {
    response.status(403).json({ ok: false, error: "Admin access required" });
    return;
  }
  try {
    const users = await listRegistrations();
    response.status(200).json({ ok: true, users });
  } catch (error) {
    console.error("[admin-users]", error);
    response.status(503).json({ ok: false, error: "Registration storage is unavailable" });
  }
}
