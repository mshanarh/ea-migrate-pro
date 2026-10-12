/**
 * /api/ping — the smallest possible Vercel function: no imports, no env, no DB.
 *
 * WHY IT EXISTS
 * ─────────────
 * In the 2026-10 outage BOTH real functions answered
 *
 *     500  x-vercel-error: FUNCTION_INVOCATION_FAILED
 *
 * while every build reported success, and nothing in this repository can read
 * Vercel's function logs — so there was no way to tell "this platform cannot
 * run ANY function" from "our handler crashes on load". That single missing
 * experiment is what this file is:
 *
 *     GET /api/ping  →  {"ok":true,...}   the platform is healthy; the fault
 *                                         is inside a real handler
 *     GET /api/ping  →  500               the deployment pipeline itself is
 *                                         broken; look at the deploy, not the code
 *
 * It carries no secret, exposes nothing but the Node version, and answers GET
 * (and HEAD) only, so a link prefetch can never do anything but say hello.
 */
type ApiRequest = { method?: string };
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  response.status(200).json({ ok: true, node: process.versions.node });
}
