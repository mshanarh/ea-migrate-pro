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

/**
 * ONE SUPABASE CLIENT PER FUNCTION INSTANCE — not one per request.
 *
 * `createClient` was built inside `paidEmailInSupabase`, so every access check
 * constructed a fresh client on the hottest path the app has. The client is
 * cheap to reuse and costly to rebuild, and this endpoint runs on every route
 * guard, so it is created once and kept for the life of the instance.
 * `null` = unconfigured (or the package could not be loaded).
 */
async function buildServiceClient() {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

let clientPromise: ReturnType<typeof buildServiceClient> | null = null;

function serviceClient(): ReturnType<typeof buildServiceClient> {
  if (!clientPromise) clientPromise = buildServiceClient().catch(() => null);
  return clientPromise;
}

/** The device binding for this email — the same column the app reads today. */
type Binding = { deviceEmail: string | null; deviceId: string | null };
type BindingAnswer = { readable: boolean; value: Binding | null };

/**
 * WHY THIS LIVES IN THE PAYMENT CHECK
 * ────────────────────────────────────
 * The route guards used to ask TWO servers in sequence: /api/check-access for
 * the ledger verdict, then Supabase for `users.device_id`, then Supabase again
 * to write the binding. Three to four round trips before a screen could paint.
 * The binding is now answered inside this same call, so one POST decides
 * everything.
 *
 * `readable: false` (unconfigured, error, missing column) means the key is
 * OMITTED from the response rather than sent as `null`: the client must be able
 * to tell "the cloud says unbound" from "the cloud could not answer", and it
 * falls back to its own read in the second case — exactly the behaviour it has
 * today, so a database hiccup can never sign anybody out.
 */
async function readDeviceBinding(email: string): Promise<BindingAnswer> {
  const db = await serviceClient();
  if (!db) return { readable: false, value: null };
  try {
    const { data, error } = await db
      .from("users")
      .select("device_email, device_id")
      .eq("email", email)
      .maybeSingle();
    if (error) return { readable: false, value: null };
    const row = data as { device_email?: string | null; device_id?: string | null } | null;
    return {
      readable: true,
      value: { deviceEmail: row?.device_email ?? null, deviceId: row?.device_id ?? null },
    };
  } catch {
    return { readable: false, value: null };
  }
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
  const deviceId = request.method === "POST" ? bodyDeviceId(request) : null;

  try {
    const answer = await resolveAccess(email, deviceId);
    response.status(200).json(answer);
  } catch (error) {
    console.error("[check-access]", error);
    response.status(503).json({ ok: false, error: "Access check is unavailable" });
  }
}

/** The caller's device id — optional; only used to answer `deviceMatches`. */
function bodyDeviceId(request: ApiRequest): string | null {
  const body = parseBody(request);
  const value = body["deviceId"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type AccessAnswer = Record<string, unknown> & {
  ok: boolean;
  isPaid: boolean;
  status: string;
  paidAt?: string;
};

async function resolveAccess(email: string, deviceId: string | null): Promise<AccessAnswer> {
  // Server-side only now — this file never ships KV client code to the browser.
  const { isAdminEmail, getRegistration } = await import("./_registry.js");

  let answer: AccessAnswer | null = null;
  if (isAdminEmail(email)) {
    answer = { ok: true, isPaid: true, status: "admin" };
  } else {
    /**
     * THE STORE'S EXPLICIT WORD WINS — paid, revoked and rejected are the
     * owner's decisions and are never second-guessed below.
     *
     * A FAILED READ IS NOT A VERDICT. `getRegistration` throws when the KV REST
     * call times out, and that used to fail this whole endpoint (the client
     * reads the failure as "unpaid" and bounces a paying customer to
     * checkout). A timeout therefore falls THROUGH to the proven fallbacks
     * instead of deciding anything.
     */
    let record: Awaited<ReturnType<typeof getRegistration>> = null;
    try {
      record = await getRegistration(email);
    } catch (error) {
      console.warn("[check-access] registration store unavailable:", error);
    }
    if (record) {
      if (record.isPaid && record.paidAt) {
        answer = { ok: true, isPaid: true, status: "paid", paidAt: record.paidAt };
      } else if (record.isPaid === false && record.paidAt === null) {
        answer = { ok: true, isPaid: false, status: "revoked" };
      } else if (record.status === "rejected") {
        answer = { ok: true, isPaid: false, status: "rejected" };
      }
      // A record that simply has no payment (or an unreadable store) is not a
      // refusal — fall through to the ledger and the claimed-key proof below.
    }
    if (!answer) {
      // Fallback 1: the same payment ledger the console reads.
      const paid = await paidEmailInSupabase(email);
      if (paid) {
        answer = { ok: true, isPaid: true, status: "paid", paidAt: paid };
      } else {
        // Fallback 1b: read the Supabase `users` row for `license_key`.
        // This is holder-bound proof: the column is only written after the
        // single-use claim and paid check succeeded for THIS account.
        // If KV was absent or unreadable and paid_emails has no row, the license_key
        // from the users table IS the payment proof for key customers.
        const db = await serviceClient();
        let licenseKeyProof = false;
        let deviceMismatch = false;
        if (db) {
          try {
            const { data, error } = await db
              .from("users")
              .select("license_key, device_id")
              .eq("email", email)
              .maybeSingle();
            if (!error && data) {
              const row = data as { license_key?: string | null; device_id?: string | null };
              const key = typeof row.license_key === "string" ? row.license_key.trim() : "";
              if (key) {
                // If the row has a device_id and the request carries a deviceId,
                // require them to match; a mismatch answers unpaid.
                if (row.device_id && deviceId && row.device_id !== deviceId) {
                  deviceMismatch = true;
                } else {
                  licenseKeyProof = true;
                }
              }
            }
          } catch {
            // DB read failure — continue to next fallback.
          }
        }
        if (deviceMismatch) {
          answer = { ok: true, isPaid: false, status: "unpaid" };
        } else if (licenseKeyProof) {
          // license_key IS the payment proof — even when KV and paid_emails
          // both cannot answer, a set license_key means the account is paid.
          answer = { ok: true, isPaid: true, status: "paid" };
        } else if (await claimedLicenseKeyProof(email, deviceId)) {
          // Fallback 2: A CLAIMED LICENCE KEY IS PROOF OF ACCESS.
          //
          // api/activation.ts writes `users.license_key` only after the paid
          // check AND the single-use claim succeeded for THIS account, so the
          // column is holder-bound server-side proof — never something a browser
          // can set. Without this, a customer who just activated a key is
          // answered "unpaid" here (their money lives in the key, not in the
          // ledger) and is sent back to the email + code form.
          answer = { ok: true, isPaid: true, status: "paid" };
        } else {
          answer = { ok: true, isPaid: false, status: "unpaid" };
        }
      }
    }
  }

  // THE BINDING, IN THE SAME ANSWER — see readDeviceBinding above. The keys are
  // only added when the read succeeded, so an unreadable database can never be
  // mistaken for "this email is unbound".
  const binding = await readDeviceBinding(email);
  if (binding.readable) {
    answer["deviceBinding"] = binding.value;
    if (deviceId) {
      answer["deviceMatches"] = binding.value?.deviceId === deviceId;
    }
  }
  return answer;
}

/**
 * DOES THIS ACCOUNT HOLD A CLAIMED LICENCE KEY?
 *
 * Reads the same `users` row the binding comes from and treats a non-empty
 * `license_key` as proof of access — see the call site for why it cannot be
 * forged. The device rule is the existing one: when the row is bound to a
 * device and the caller names a different one, the account is activated on
 * another phone and must be answered unpaid.
 */
async function claimedLicenseKeyProof(email: string, requestDeviceId: string | null): Promise<boolean> {
  const db = await serviceClient();
  if (!db) return false;
  try {
    const { data, error } = await db
      .from("users")
      .select("license_key, device_id")
      .eq("email", email)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { license_key?: string | null; device_id?: string | null };
    const key = typeof row.license_key === "string" ? row.license_key.trim() : "";
    if (!key) return false;
    if (row.device_id && requestDeviceId && row.device_id !== requestDeviceId) return false;
    return true;
  } catch {
    return false;
  }
}

async function paidEmailInSupabase(email: string): Promise<string | null> {
  const db = await serviceClient();
  if (!db) return null;

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
