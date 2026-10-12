/**
 * ONE serverless function for the whole /api surface.
 *
 * WHY THIS FILE EXISTS — THE 12-FUNCTION HOBBY LIMIT
 * ────────────────────────────────────────────────────
 * Vercel's Hobby plan caps a deployment at 12 Serverless Functions (docs,
 * runtimes page: "For Hobby, this approach is limited to 12 Vercel Functions
 * per deployment"; the build error is "No more than 12 Serverless Functions
 * can be added to a Deployment on the Hobby plan"). This project grew to 15
 * individual files in /api, and every deployment from commit 71365c3
 * onwards FAILED on that limit — the public app silently froze on the old
 * build, which is why admin decisions (written to Upstash KV) never reached
 * users: the live /api routes answered with the SPA shell.
 *
 * This catch-all keeps EVERY public URL byte-for-byte identical — the Whop
 * webhook (/api/whop-payment), the MT5 EA's WebRequest target
 * (/api/trade-notify, whitelisted in the traders' terminals), the app's
 * access gate (/api/check-access) and the mentor portal's approval read
 * (/api/mentor-status) all still work unchanged. It only routes each request
 * to the same handler code, which now lives in `api/_handlers/` (underscore
 * directories are never built as functions, so the whole surface counts as
 * ONE deployment function).
 *
 * Adding a new endpoint: put the handler in `api/_handlers/<name>.ts` and add
 * one line to ROUTES below. Never add a new top-level file in `api/` — that
 * silently reintroduces the limit failure.
 */
type ApiRequest = {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};
type Handler = (request: ApiRequest, response: ApiResponse) => Promise<void>;
type HandlerModule = { default: Handler };

/**
 * slug → lazily-imported handler. The `.js` extensions are LOAD-BEARING —
 * this project is `"type": "module"` and Node's ESM resolver refuses
 * extensionless relative specifiers (see the long note in
 * api/_handlers/activation.ts). Lazy imports also keep each endpoint in its
 * own chunk, so one heavy handler (activation, ea-media) never loads for a
 * light one (ping).
 */
const ROUTES: Record<string, () => Promise<HandlerModule>> = {
  activation: () => import("./_handlers/activation.js"),
  "admin-approve": () => import("./_handlers/admin-approve.js"),
  "admin-backfill": () => import("./_handlers/admin-backfill.js"),
  "admin-users": () => import("./_handlers/admin-users.js"),
  "check-access": () => import("./_handlers/check-access.js"),
  "device/register": () => import("./_handlers/device/register.js"),
  "ea-media": () => import("./_handlers/ea-media.js"),
  "generate-robot-key": () => import("./_handlers/generate-robot-key.js"),
  "mentor-status": () => import("./_handlers/mentor-status.js"),
  notifications: () => import("./_handlers/notifications.js"),
  ping: () => import("./_handlers/ping.js"),
  portal: () => import("./_handlers/portal.js"),
  register: () => import("./_handlers/register.js"),
  "trade-notify": () => import("./_handlers/trade-notify.js"),
  "whop-payment": () => import("./_handlers/whop-payment.js"),
};

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  const path = (request.url ?? "").split("?", 2)[0] ?? "";
  const slug = path.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const load = ROUTES[slug];
  if (!load) {
    response.status(404).json({ ok: false, error: "Unknown API route" });
    return;
  }
  const route = await load();
  return route.default(request, response);
}
