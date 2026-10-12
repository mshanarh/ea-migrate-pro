/** POST /api/check-access — server-side email payment/access check.

THE BUG THIS CLOSES
Browser-side access checks used to import `../../api/_registry` directly, which
pulls in the KV client that reads `process.env` in a browser bundle. In that
environment `process.env` is undefined, so the whole check errorred out at
build/routing time and the fallback land was checkout — paid people kept getting
shipped to Choose Plan. This endpoint does the same decision server-side, where
`KV_REST_API_URL`, `KV_REST_API_TOKEN` and the Supabase service-role key are all
real, and the browser only ever reads one JSON answer.

One endpoint, one contract, both access paths (the cloud gate and the
registration gate in `registerWithEmail`) call it. If it is missing or cold, the
old behaviour stands and people still get shipped to plans — nothing here makes
anything worse, it only makes the paid path actually work.
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
  const body = parseBody(request);
  return normEmail(body["email"]);
}

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

  try {
    const answer = await resolveAccess(email);
    response.status(200).json(answer);
  } catch (error) {
    console.error("[check-access]", error);
    response.status(503).json({ ok: false, error: "Access check is unavailable" });
  }
}

async function resolveAccess(email: string) {
  // Server-side only now — this file never ships KV client code to the browser.
  const { isAdminEmail, getRegistration } = await import("./_registry.js");

  if (isAdminEmail(email)) {
    return { ok: true, isPaid: true, status: "admin" };
  }

  const record = await getRegistration(email);
  if (record) {
    if (record.isPaid && record.paidAt) {
      return { ok: true, isPaid: true, status: "paid", paidAt: record.paidAt };
    }
    if (record.isPaid === false && record.paidAt === null) {
      return { ok: true, isPaid: false, status: "revoked" };
    }
    if (record.status === "rejected") {
      return { ok: true, isPaid: false, status: "rejected" };
    }
    return { ok: true, isPaid: false, status: "unpaid" };
  }

  // Fallback: the same payment ledger the console reads, when KV has no record.
  const paid = await paidEmailInSupabase(email);
  if (paid) {
    return { ok: true, isPaid: true, status: "paid", paidAt: paid };
  }

  return { ok: true, isPaid: false, status: "unpaid" };
}

async function paidEmailInSupabase(email: string): Promise<string | null> {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !key) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await db
    .from("paid_emails")
    .select("paid_at")
    .eq("email", email)
    .neq("paid_at", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  const paidAt = data["paid_at"];
  return typeof paidAt === "string" && paidAt.length > 0 ? paidAt : null;
}
