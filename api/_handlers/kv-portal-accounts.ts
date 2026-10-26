/**
 * /api/kv/portal-accounts — the portal's own account + payment record, read on
 * the SERVER from Upstash KV.
 *
 * WHY THIS ROUTE EXISTS
 * The reactivation check used to read the portal's payment flag from the
 * browser with `VITE_KV_REST_HOST` / `VITE_KV_API_KEY` — variables that were
 * never set, and which are the wrong (client-side, public) kind anyway. Every
 * read therefore failed with a bare `TypeError: Failed to fetch`.
 *
 * Vercel has had the REAL server variables since 6 Oct: `KV_REST_API_URL`,
 * `KV_REST_API_TOKEN` (plus the read-only token), `KV_URL`, `KV_REDIS_URL`.
 * They are read here, in the serverless function, and never leave it. The
 * browser calls this route; no KV credential is ever shipped to the client.
 *
 * CONTRACT
 *   GET  ?email=…  → { ok, configured, reachable, registered, paid, paidAt,
 *                      variables: { urlVar, tokenVar }, detail }
 *   POST { email, paid }  → admin-only write of the same KV flag
 *
 * `detail` ALWAYS names the server variable that was used (or the one that is
 * missing), so the diagnostics line says
 *   "portal accounts: KV via KV_REST_API_URL, reachable"
 * instead of "Failed to fetch".
 */
import {
  adminFromRequest,
  getRegistration,
  kvRead,
  normalizeEmail,
  parseBody,
  saveRegistration,
  storeConfigInfo,
  type ApiRequest,
  type ApiResponse,
} from "./_registry.js";

type PortalAnswer = {
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  registered: boolean;
  paid: boolean;
  paidAt: string | null;
  variables: { urlVar: string | null; tokenVar: string | null };
  detail: string;
};

function queryEmail(request: ApiRequest & { url?: string }): string {
  const raw = typeof request.url === "string" ? request.url : "";
  const query = new URLSearchParams(raw.split("?", 2)[1] ?? "");
  return normalizeEmail(query.get("email"));
}

async function readRecord(email: string, variables: { urlVar: string | null; tokenVar: string | null }): Promise<PortalAnswer> {
  if (!variables.urlVar || !variables.tokenVar) {
    // A DEPLOYMENT FACT, not a network failure. Named precisely.
    const missing = [!variables.urlVar ? "KV_REST_API_URL" : null, !variables.tokenVar ? "KV_REST_API_TOKEN" : null]
      .filter(Boolean)
      .join(" / ");
    return {
      ok: false,
      configured: false,
      reachable: false,
      registered: false,
      paid: false,
      paidAt: null,
      variables,
      detail: `${missing} missing on server`,
    };
  }

  try {
    // The read-only token is used when it is the one present, so a diagnostic
    // read needs no write rights.
    const raw = await kvRead(["HGET", "eamp:registrations", email]);
    const via = `KV via ${variables.urlVar}, reachable`;
    if (typeof raw !== "string") {
      return {
        ok: true,
        configured: true,
        reachable: true,
        registered: false,
        paid: false,
        paidAt: null,
        variables,
        detail: `${via} · no account`,
      };
    }
    let record: { isPaid?: boolean; paidAt?: string | null } = {};
    try {
      record = JSON.parse(raw) as { isPaid?: boolean; paidAt?: string | null };
    } catch {
      /* corrupt record — treated as no payment */
    }
    const paidAt = typeof record.paidAt === "string" && record.paidAt ? record.paidAt : null;
    const paid = record.isPaid === true && paidAt !== null;
    return {
      ok: true,
      configured: true,
      reachable: true,
      registered: true,
      paid,
      paidAt,
      variables,
      detail: `${via} · ${paid ? `paid${paidAt ? ` at ${paidAt}` : ""}` : "not paid"}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      configured: true,
      reachable: false,
      registered: false,
      paid: false,
      paidAt: null,
      variables,
      detail: `KV via ${variables.urlVar} → ${message}`,
    };
  }
}

export default async function handler(request: ApiRequest & { url?: string }, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const method = request.method ?? "GET";
  const variables = storeConfigInfo();

  if (method === "GET") {
    const email = queryEmail(request);
    if (!email) {
      response.status(400).json({ ok: false, error: "email is required" });
      return;
    }
    const answer = await readRecord(email, variables);
    response.status(200).json(answer);
    return;
  }

  if (method === "POST") {
    const admin = adminFromRequest(request);
    if (!admin) {
      response.status(403).json({ ok: false, error: "Admin only" });
      return;
    }
    const body = parseBody(request);
    const email = normalizeEmail(body["email"]);
    const paid = body["paid"] === true;
    if (!email) {
      response.status(400).json({ ok: false, error: "email is required" });
      return;
    }
    if (!variables.urlVar || !variables.tokenVar) {
      response.status(503).json({ ok: false, error: "KV_REST_API_URL / KV_REST_API_TOKEN are not set on the server" });
      return;
    }
    try {
      const existing = await getRegistration(email);
      if (!existing) {
        response.status(404).json({ ok: false, error: "No portal account for that email" });
        return;
      }
      const paidAt = paid ? new Date().toISOString() : null;
      await saveRegistration({ ...existing, isPaid: paid, paidAt });
      const answer = await readRecord(email, variables);
      response.status(200).json({ ...answer, updatedBy: admin });
    } catch (error) {
      console.error("[kv-portal-accounts] write failed", error);
      response.status(503).json({ ok: false, error: "Portal account storage is unavailable" });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ ok: false, error: "Method not allowed" });
}
