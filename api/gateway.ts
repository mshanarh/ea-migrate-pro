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
 * HOW THE ROUTING WORKS
 * ──────────────────────
 * A rewrite in vercel.json sends every `/api/*` request here as
 *     /api/gateway?__path=/<original-path>
 * (the original query string is carried over by Vercel untouched), and this
 * dispatcher looks up `__path` in ROUTES below. A plain, bracket-free
 * filename is deliberate: bracketed catch-all names (api/[...slug].ts) are
 * not reliably recognised as function routes on this deployment, and a
 * silently unrouted function answers with the SPA shell — the exact symptom
 * this file exists to end.
 *
 * Every public URL stays byte-for-byte identical — the Whop webhook
 * (/api/whop-payment), the MT5 EA's WebRequest target (/api/trade-notify,
 * whitelisted in the traders' terminals), the app's access gate
 * (/api/check-access) and the mentor portal's approval read
 * (/api/mentor-status). The handler code lives in `api/_handlers/`
 * (underscore directories are never built as functions), so the whole API
 * surface counts as ONE deployment function.
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
  account: () => import("./_handlers/account.js"),
  activation: () => import("./_handlers/activation.js"),
  "admin-approve": () => import("./_handlers/admin-approve.js"),
  "admin-backfill": () => import("./_handlers/admin-backfill.js"),
  "admin-users": () => import("./_handlers/admin-users.js"),
  "bridge-config": () => import("./_handlers/bridge-config.js"),
  // The Fundamentals calendar. It lives here rather than in a TanStack server
  // function because this deployment serves /api and NOT /_serverFn — the
  // calendar could never load in production until it moved (see
  // api/_handlers/calendar.ts).
  calendar: () => import("./_handlers/calendar.js"),
  "check-access": () => import("./_handlers/check-access.js"),
  "device-binding": () => import("./_handlers/device-binding.js"),
  "device/register": () => import("./_handlers/device/register.js"),
  "ea-media": () => import("./_handlers/ea-media.js"),
  "generate-robot-key": () => import("./_handlers/generate-robot-key.js"),
  "kv/portal-accounts": () => import("./_handlers/kv-portal-accounts.js"),
  licenses: () => import("./_handlers/licenses.js"),
  "mentor-status": () => import("./_handlers/mentor-status.js"),
  notifications: () => import("./_handlers/notifications.js"),
  ping: () => import("./_handlers/ping.js"),
  portal: () => import("./_handlers/portal.js"),
  reactivate: () => import("./_handlers/reactivate.js"),
  register: () => import("./_handlers/register.js"),
  "trade-notify": () => import("./_handlers/trade-notify.js"),
  "whop-payment": () => import("./_handlers/whop-payment.js"),
};

/**
 * RUNTIME AND COLD-START COST — EXPLICIT, AND DELIBERATELY MINIMAL.
 *
 * Every handler under /api runs on the NODE runtime (nothing here is an edge
 * function, and no handler opts out of it), which is what lets them use
 * `node:crypto`, the KV REST client and the Supabase service-role key.
 *
 * The whole API surface is ONE function on purpose: Vercel's Hobby plan caps a
 * deployment at 12 functions (see the note above), so the smallest possible
 * configuration for the hot endpoints (`check-access`, `ping`) is not a second
 * function — that trade was already made and is what the ROUTES table below
 * exists for. What keeps each invocation cheap instead:
 *   • handlers are lazily imported, so a `ping` never loads `activation`,
 *   • /api/check-access keeps one Supabase client per instance and reads the
 *     payment ledger + device binding in a single round trip (see
 *     api/_handlers/check-access.ts),
 *   • the KV client is a plain REST fetch with a 10s deadline — no per-call
 *     client construction anywhere in the request path.
 * No `maxDuration` is pinned: the longest handlers (activation, ea-media) are
 * bounded by their own timeouts, and capping the whole function would break
 * them to save nothing on the fast ones.
 */
export const config = { runtime: "nodejs" };

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  const url = request.url ?? "";
  const search = url.split("?", 2)[1] ?? "";
  const forwarded = new URLSearchParams(search).get("__path");
  // The rewrite passes the ORIGINAL path in `__path`; the fallback keeps the
  // dispatcher working when the function is reached directly (e.g. in dev).
  const path = forwarded ?? url.split("?", 2)[0] ?? "";
  const slug = path
    .replace(/^\/api\/?/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const load = ROUTES[slug];
  if (!load) {
    response.status(404).json({ ok: false, error: "Unknown API route" });
    return;
  }
  const route = await load();
  return route.default(request, response);
}
