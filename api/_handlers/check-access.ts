/**
 * POST /api/check-access — THE access decision, and it reads ONE store.
 *
 * Upstash KV (KV_REST_API_URL / KV_REST_API_TOKEN) is the only authority for
 * portal accounts, payment status, licence keys, device bindings and
 * reactivation. There is no second store to fall back to and no "any store
 * that says paid" rule to reconcile:
 *
 *   • KV reachable and the record says paid          → paid
 *   • KV reachable, record says revoked / rejected   → revoked / rejected
 *   • KV reachable, no record or no payment          → unpaid
 *   • KV UNREACHABLE                                 → undecided + retryable
 *
 * The last line is the important one. An unreachable store is NOT evidence of
 * non-payment: it answers `unavailable: true` with a 503, and the client turns
 * that into "try again" instead of the plan chooser. A paying customer must
 * never be told they are unpaid because a read failed.
 *
 * The device binding is answered in the SAME response (same KV record), so a
 * route guard needs one round trip: it learns the payment verdict and whether
 * this email is bound to another device at once.
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

const ALLOWED_METHODS: Array<"GET" | "POST"> = ["GET", "POST"];

function normEmail(input: unknown): string {
  if (typeof input !== "string") return "";
  const value = input.trim();
  return value.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : "";
}

function parseBody(request: ApiRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
}

function queryEmail(request: ApiRequest): string {
  const url = typeof request.url === "string" ? request.url : "";
  const query = new URLSearchParams(url.split("?", 2)[1] ?? "");
  return normEmail(query.get("email"));
}

function bodyEmail(request: ApiRequest): string {
  return normEmail(parseBody(request)["email"]);
}

function bodyDeviceId(request: ApiRequest): string | null {
  const value = parseBody(request)["deviceId"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * ONE LOG LINE PER STORE READ — `store`, `reachable` and `result` on every
 * call, so a blocked sign-in can be diagnosed from the deployment logs without
 * guessing which read threw. `result` is always paid / unpaid / null / error.
 */
function storeLog(input: {
  store: string;
  email: string;
  reachable: boolean;
  result: "paid" | "unpaid" | "null" | "error";
  detail?: string;
}): void {
  const line = [
    `store=${input.store}`,
    `email=${input.email}`,
    `reachable=${input.reachable ? "yes" : "no"}`,
    `result=${input.result}`,
  ];
  if (input.detail) line.push(`detail=${input.detail}`);
  console.warn("[ACCESS_CHECK]", line.join(" "));
}

type Binding = { deviceEmail: string | null; deviceId: string | null };

type AccessAnswer = {
  ok: boolean;
  isPaid: boolean;
  status: "admin" | "paid" | "revoked" | "rejected" | "unpaid" | "undecided";
  paidAt?: string;
  deviceBinding?: Binding | null;
  deviceMatches?: boolean;
  unavailable?: boolean;
  error?: string;
  unreadable?: string[];
};

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method && !ALLOWED_METHODS.includes(request.method as "GET" | "POST")) {
    response.setHeader("Allow", ALLOWED_METHODS.join(", "));
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const email = request.method === "POST" ? bodyEmail(request) : queryEmail(request);
  if (!email) {
    response.status(400).json({ ok: false, error: "email is required" });
    return;
  }
  const deviceId = request.method === "POST" ? bodyDeviceId(request) : null;

  const { isAdminEmail, getRegistration, storeConfigured } = await import("./_registry.js");

  // ADMIN BYPASS — subscription only, exactly as before. It is a role check on
  // a fixed list plus ADMIN_EMAILS, not a store read, so it still answers when
  // the store is down.
  if (isAdminEmail(email)) {
    storeLog({ store: "admin-list", email, reachable: true, result: "paid" });
    response.status(200).json({ ok: true, isPaid: true, status: "admin" } satisfies AccessAnswer);
    return;
  }

  if (!storeConfigured()) {
    storeLog({ store: "kv", email, reachable: false, result: "error", detail: "KV not configured" });
    response.status(503).json({
      ok: false,
      isPaid: false,
      status: "undecided",
      unavailable: true,
      error: "Access storage is not configured — try again",
    } satisfies AccessAnswer);
    return;
  }

  let record: Awaited<ReturnType<typeof getRegistration>>;
  try {
    record = await getRegistration(email);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    storeLog({ store: "kv", email, reachable: false, result: "error", detail });
    // UNREACHABLE IS NOT UNPAID. 503 + unavailable → the client shows a retry
    // message and never the plan chooser.
    response.status(503).json({
      ok: false,
      isPaid: false,
      status: "undecided",
      unavailable: true,
      error: "Access check could not reach the store — try again",
      unreadable: [`kv → ${detail}`],
    } satisfies AccessAnswer);
    return;
  }

  const answer = decide(record, email);
  storeLog({
    store: "kv",
    email,
    reachable: true,
    result: answer.isPaid ? "paid" : record ? "unpaid" : "null",
    detail: record ? `status=${record.status}` : "no record",
  });

  // THE DEVICE BINDING, FROM THE SAME RECORD — no second read.
  const binding: Binding = { deviceEmail: record?.deviceId ? email : null, deviceId: record?.deviceId ?? null };
  answer.deviceBinding = binding;
  if (deviceId) answer.deviceMatches = binding.deviceId === deviceId;

  response.status(200).json(answer);
}

/**
 * THE WHOLE DECISION, FROM ONE KV RECORD.
 *
 * `isPaid && paidAt` is the owner's "Mark paid" write. `isPaid === false &&
 * paidAt === null` is the revocation marker ("Mark unpaid") — a deliberate
 * decision, so it answers revoked rather than floating down to unpaid.
 */
function decide(record: { isPaid: boolean; paidAt: string | null; status: string } | null, email: string): AccessAnswer {
  if (!record) return { ok: true, isPaid: false, status: "unpaid" };
  if (record.isPaid && record.paidAt) {
    return { ok: true, isPaid: true, status: "paid", paidAt: record.paidAt };
  }
  if (record.isPaid === false && record.paidAt === null) {
    return { ok: true, isPaid: false, status: "revoked" };
  }
  if (record.status === "rejected") return { ok: true, isPaid: false, status: "rejected" };
  // A record that exists but carries no payment: genuinely unpaid.
  void email;
  return { ok: true, isPaid: false, status: "unpaid" };
}
