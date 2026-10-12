/** GET/POST /api/mentor-status — the MENTOR PORTAL's approval read, from Upstash KV.

THE BUG THIS CLOSES
The admin console writes every decision to the Upstash registration store
(`eamp:registrations`, via /api/admin-approve — see AGENTS.md: registrations,
approval state, payment flags and licence limits live in KV). The mentor
portal's sign-in (portalSignIn) and its dashboard poll (portalGetAccount),
however, were still reading approval from the Supabase `mentor_approvals`
TABLE — a table nothing writes to any more. So an approved mentor kept
signing in to "pending", and the dashboard's five-second poll kept writing
that stale "pending" back over the correct decision on every tick.

This endpoint answers the portal's question from the SAME KV record the
admin console writes:
    { email }  →  { ok, found, status, licenseLimit, displayName, … }

CONTRACT
- `found: false`  — KV is reachable and holds no record for this email.
                    The caller may fall back to older sources.
- 503            — KV could not be consulted (unconfigured / unreachable).
                   The caller must NOT treat this as "pending"; it should
                   keep whatever it already knows.
- The password hash/salt NEVER leave the server (toPublic strips them).
*/
import { getRegistration, parseBody, toPublic, type ApiRequest, type ApiResponse } from "./_registry.js";

function normEmail(input: unknown): string {
  if (typeof input !== "string") return "";
  const value = input.trim();
  return value.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : "";
}

function queryEmail(request: ApiRequest & { url?: string }): string {
  const url = typeof request.url === "string" ? request.url : "";
  const query = new URLSearchParams(url.split("?", 2)[1] ?? "");
  return normEmail(query.get("email"));
}

function bodyEmail(request: ApiRequest): string {
  const body = parseBody(request);
  return normEmail(body["email"]);
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const email = method === "POST" ? bodyEmail(request) : queryEmail(request);
  if (!email) {
    response.status(400).json({ ok: false, error: "email is required" });
    return;
  }

  try {
    const record = await getRegistration(email);
    if (!record) {
      // Reachable KV, no record — the caller decides whether to fall back.
      response.status(200).json({ ok: true, found: false });
      return;
    }
    const pub = toPublic(record);
    response.status(200).json({
      ok: true,
      found: true,
      status: pub.status,
      licenseLimit: pub.licenseLimit,
      firstName: pub.firstName,
      displayName: pub.displayName,
      username: pub.username,
      whatsapp: pub.whatsapp,
      createdAt: pub.createdAt,
    });
  } catch (error) {
    console.error("[mentor-status]", error);
    // 503, NOT "pending": an unreachable store must never be read as a
    // missing decision — that is exactly how stale "pending" overwrote
    // real approvals.
    response.status(503).json({ ok: false, error: "Registration storage is unavailable" });
  }
}
