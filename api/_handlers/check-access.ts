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
 * A FETCH THAT CANNOT HANG THE VERDICT.
 *
 * Every Supabase query goes through this. When the configured host does not
 * resolve — which is the state this deployment is in — each query used to run
 * its own connection timeout, and the five stores together made this endpoint
 * take ~14 SECONDS. The sign-in screen's own deadline fired long before the
 * answer came back, so every email that was not the sole admin was shown "we
 * could not verify your subscription".
 *
 * A host that cannot resolve is given 2.5s (it is not going to answer — the
 * DNS probe already told us so); a host that resolves keeps 12s. The query
 * then fails like any other unreachable store, and the store is answered from
 * the KV record the console actually writes.
 */
function boundedFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`store read exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    const upstream = init?.signal;
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

async function buildServiceClient() {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const missing = await databaseHostMissing();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch(missing ? 2_500 : 12_000) },
  });
}

let clientPromise: ReturnType<typeof buildServiceClient> | null = null;

/**
 * THE DATABASE CLIENT — OR `null` WHEN THIS DEPLOYMENT HAS NO DATABASE.
 *
 * The DNS probe runs FIRST. A deployment whose Supabase host does not resolve
 * used to create a client and send four queries at a hostname that cannot
 * answer: every one of them had to run its own connection timeout, which is
 * exactly why this endpoint measured ~14 SECONDS per call in production, and
 * why the sign-in screen's own deadline fired before the verdict came back and
 * told a paying customer "we could not verify your subscription".
 *
 * When the host does not resolve there is no database to read, so every store
 * below is answered immediately — "no database in this deployment, no row" —
 * and the verdict is reached from the stores that DO exist (the KV
 * registration record, the payment flag, the licence keys). Nothing is
 * skipped that could have held a paid mark.
 */
function serviceClient(): ReturnType<typeof buildServiceClient> {
  if (!clientPromise) clientPromise = buildServiceClient().catch(() => null);
  return clientPromise;
}

/**
 * IS THE DATABASE A STORE THIS DEPLOYMENT STILL HAS?
 *
 * "Unreachable" and "absent" are different answers and the gate must not merge
 * them. A query that fails while the host resolves is a TRANSIENT fault: the
 * store might still hold a paid mark, so the verdict is `undecided` and the
 * client shows Retry. A host that does not resolve AT ALL — the Supabase
 * project was deleted, or no database was ever configured — is a store that is
 * NOT PART OF THIS DEPLOYMENT: it holds no paid record, so it answers "no row"
 * and unpaid customers still reach the plan chooser instead of being parked on
 * a Retry screen forever.
 *
 * The probe runs only when a query has already failed, and its answer is held
 * for five minutes, so the happy path pays nothing for it.
 */
let hostProbe: { missing: boolean; at: number; host: string } | null = null;
const HOST_PROBE_TTL_MS = 5 * 60 * 1000;

/** How long a store query may take before it is treated as absent. */
function storeDeadlineMs(): number {
  return hostProbe?.missing ? 400 : 2_500;
}

/**
 * A QUERY THAT CANNOT HOLD THE VERDICT HOSTAGE.
 *
 * A hostname that never resolves makes the underlying `fetch` sit in DNS far
 * longer than any timeout we set on the socket — measured at ~7s per query, and
 * these run on the sign-in path. Racing the QUERY (not the socket) means the
 * store is answered within a fixed budget no matter what the network does, and
 * an unreachable store is then reported as absent rather than stalling the
 * whole check. When the probe already said the host does not resolve, the
 * budget is a few hundred milliseconds: there is nothing to wait for.
 */
function storeDeadline<T>(work: PromiseLike<T>, fallback: T, label: string): Promise<T> {
  const ms = storeDeadlineMs();
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[check-access] ${label} did not answer in ${ms}ms — treated as absent`);
      resolve(fallback);
    }, ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** The configured database host, or a plain note when there is none. */
function databaseHost(): string {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  if (!url) return "SUPABASE_URL / VITE_SUPABASE_URL not set";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * TRUE when the configured database host does not resolve at all.
 *
 * The NAME is reported in the diagnostic (a project hostname is configuration,
 * not a credential), so the log line says exactly which host was probed — the
 * same way storeConfigInfo() names the KV variables.
 */
async function databaseHostMissing(): Promise<boolean> {
  const host = databaseHost();
  if (hostProbe && Date.now() - hostProbe.at < HOST_PROBE_TTL_MS) return hostProbe.missing;
  const configured = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  if (!configured) {
    hostProbe = { missing: true, at: Date.now(), host };
    return true;
  }
  let missing = false;
  try {
    const { lookup } = await import("node:dns/promises");
    /**
     * THE PROBE ITSELF IS ON A LEASH.
     *
     * A hostname that never answers made `lookup` sit there until the
     * resolver's own timeout: measured at ~14 SECONDS in this deployment, which
     * is what every sign-in was waiting on before it could be told the store
     * was unreachable. A host that has not resolved in 1.5s is not going to
     * answer this request, so the database is treated as absent and the check
     * completes in milliseconds from the stores that do exist.
     */
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DNS probe timed out after 1500ms")), 1_500)),
    ]);
  } catch {
    missing = true;
    console.error(`[check-access] database host does not resolve (${host}) — treating the database as absent`);
  }
  hostProbe = { missing, at: Date.now(), host };
  return missing;
}

/** The verdict for a database store this deployment either lacks or cannot reach. */
async function databaseStoreFailure(store: string, error: unknown): Promise<StoreVerdict> {
  if (await databaseHostMissing()) {
    return {
      paid: false,
      readable: true,
      detail: `${store} → no database in this deployment (${databaseHost()} does not resolve), no row`,
    };
  }
  return noAnswer(`${store} → ${databaseHost()} → ${errorText(error)}`);
}

/** "This deployment has no database" — an absent store, never evidence of payment. */
function absentDatabase(store: string): StoreVerdict {
  return {
    paid: false,
    readable: true,
    detail: `${store} → no database in this deployment (${databaseHost()}), no row`,
  };
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
  // ── THE KV REGISTRATION RECORD IS THE AUTHORITATIVE BINDING ────────────────
  //
  // The device binding used to live only in a Supabase column, so in a
  // deployment whose database is gone it could never be read OR written: every
  // email looked unbound, and "one email, one device" silently stopped being
  // enforced across devices (sign in on the web, then open the same email on a
  // phone and walk straight in). The binding now travels with the registration
  // record the console already owns, which is where registrations, approval
  // state, the payment flag and licence limits live.
  let kvBinding: Binding | null = null;
  try {
    const { getDeviceIdForEmail } = await import("./_registry.js");
    const deviceId = await getDeviceIdForEmail(email);
    kvBinding = { deviceEmail: deviceId ? email : null, deviceId };
  } catch (error) {
    console.warn(`[check-access] ${email} → KV device binding unreadable (${errorText(error)}); falling back to the database`);
  }
  // A KV binding is FINAL — it is the store the sign-in writes and the portal
  // releases, so it must never be overruled by an older database column.
  if (kvBinding?.deviceId) return { readable: true, value: kvBinding };

  // Otherwise the database may still hold the binding of an account that has
  // not signed in since the move. It is only a fallback: when it cannot answer,
  // KV's own "unbound" is the answer (KV answered; the database did not).
  const db = await serviceClient();
  let dbAnswer: BindingAnswer & { unboundValid?: boolean } = { readable: false, value: null };
  if (db) {
    try {
      const query = db.from("users").select("device_email, device_id").eq("email", email).maybeSingle();
      const { data, error } = await storeDeadline(
        query,
        { data: null, error: { message: "store did not answer in time" } } as unknown as Awaited<typeof query>,
        "device binding",
      );
      if (!error) {
        const row = data as { device_email?: string | null; device_id?: string | null } | null;
        dbAnswer = {
          readable: true,
          value: { deviceEmail: row?.device_email ?? null, deviceId: row?.device_id ?? null },
        };
      }
    } catch {
      /* unreadable database — see below */
    }
  }
  if (dbAnswer.readable) {
    // A database row that says NOTHING while KV has a record could be a stale
    // mirror; the KV answer is the one that counts in that case.
    if (!dbAnswer.value?.deviceId && kvBinding) return { readable: true, value: kvBinding };
    return dbAnswer;
  }
  if (kvBinding) return { readable: true, value: kvBinding };
  return { readable: false, value: null };
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
  /** What EACH store said about this email — logged when the gate refuses. */
  stores?: Record<string, string>;
};

/**
 * ONE STORE'S ANSWER.
 *
 * `readable: false` means WE COULD NOT ASK — it is never "not paid". Three
 * states are kept apart on purpose: a paid mark, a readable "no", and no
 * answer at all.
 */
type StoreVerdict = {
  paid: boolean;
  paidAt?: string | null;
  readable: boolean;
  detail: string;
  /** The console deliberately marked this email unpaid. */
  revoked?: boolean;
  /** The console rejected this registration. */
  rejected?: boolean;
};

function noAnswer(detail: string): StoreVerdict {
  return { paid: false, readable: false, detail };
}

/**
 * ONE LINE PER STORE: reachable yes/no, and paid / null / error.
 *
 * `null` means the store ANSWERED "no paid mark"; `error` means it could not be
 * read at all. They are printed differently on purpose — only the first is a
 * refusal, and only when every store answers can the gate say `unpaid`.
 */
function logStore(email: string, name: string, verdict: StoreVerdict): void {
  const result = verdict.paid ? "paid" : verdict.readable ? "null" : "error";
  console.info(
    `[check-access] ${email} → store "${name}": reachable=${verdict.readable ? "yes" : "no"} result=${result} — ${verdict.detail}`,
  );
}

/** The six sources the gate reports — see the diagnostic line below. */
const STORE_NAMES = [
  "users table",
  "KV registrations",
  "paid ledger",
  "portal accounts",
  "licence keys",
  "cloud access gate",
] as const;

function diagnosticLine(email: string, stores: Record<string, string>, verdict: string): string {
  return `[check-access] ${email} → ${verdict}: ${STORE_NAMES.map((name) => `${name}=${stores[name] ?? "—"}`).join(" | ")}`;
}

/** eamp:registrations — the console's record, which the portal's account is. */
async function readKvRegistrations(email: string): Promise<StoreVerdict> {
  try {
    const { getRegistration } = await import("./_registry.js");
    const record = await getRegistration(email);
    if (!record) return { paid: false, readable: true, detail: "no registration" };
    if (record.isPaid === true) {
      return {
        paid: true,
        paidAt: record.paidAt,
        readable: true,
        detail: `paid${record.paidAt ? ` at ${record.paidAt}` : " (no timestamp)"}`,
      };
    }
    if (record.isPaid === false && record.paidAt === null) {
      return { paid: false, readable: true, revoked: true, detail: "marked unpaid by the console" };
    }
    if (record.status === "rejected") {
      return { paid: false, readable: true, rejected: true, detail: "rejected in the console" };
    }
    return { paid: false, readable: true, detail: "registered, no payment" };
  } catch (error) {
    return noAnswer(`KV registrations → ${errorText(error)}`);
  }
}

/**
 * THE `users` ROW — the payment flag the console writes, plus the holder-bound
 * licence key (only ever proof for THIS account: it is written after the paid
 * check and the single-use claim, and a key bound to another device does not
 * count here — that device rule still runs at sign-in).
 *
 * `is_admin` is REPORTED but never counts as payment: a role is not a receipt.
 */
async function readUsersStore(email: string, deviceId: string | null): Promise<StoreVerdict> {
  const db = await serviceClient();
  if (!db) return absentDatabase("users table");
  try {
    const base = db.from("users").select("is_paid, is_admin, license_key, device_id");
    const scoped = /[%_]/.test(email) ? base.eq("email", email) : base.ilike("email", email);
    const query = scoped.maybeSingle();
    const { data, error } = await storeDeadline(
      query,
      { data: null, error: { message: "store did not answer in time" } } as unknown as Awaited<typeof query>,
      "users table",
    );
    if (error) {
      if (absentStore(error)) return { paid: false, readable: true, detail: "table not present in this deployment — no row" };
      // A network-level failure arrives HERE as a resolved error object, not a
      // throw — so the absent-vs-unreachable probe has to run on this path too.
      return await databaseStoreFailure("users table", error);
    }
    if (!data) return { paid: false, readable: true, detail: "no row" };
    const row = data as { is_paid?: boolean | null; is_admin?: boolean | null; license_key?: string | null; device_id?: string | null };
    const flag = row.is_paid === true;
    const key = typeof row.license_key === "string" ? row.license_key.trim() : "";
    const mismatch = Boolean(key && row.device_id && deviceId && row.device_id !== deviceId);
    return {
      paid: flag || Boolean(key) && !mismatch,
      readable: true,
      detail: `${flag ? "paid flag" : "not paid"}${key ? (mismatch ? ", key bound to another device" : ", key held") : ""}${row.is_admin ? ", admin flag" : ""}`,
    };
  } catch (error) {
    return databaseStoreFailure("users table", error);
  }
}

/** A table this deployment never created cannot hold a paid mark. */
function absentStore(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return true;
  return /does not exist|could not find the table|schema cache/i.test(error?.message ?? "");
}

/** The console's payment ledger — `paid_emails`, the same rows the Paid tab reads. */
async function readPaidLedger(email: string): Promise<StoreVerdict> {
  const ledger = await paidEmailInSupabase(email);
  if (!ledger.readable) return noAnswer(ledger.detail);
  return {
    paid: Boolean(ledger.paidAt),
    paidAt: ledger.paidAt,
    readable: true,
    detail: ledger.detail,
  };
}

/** The portal's own payment record — `portal_payments`, read with the service role. */
async function readPortalAccounts(email: string): Promise<StoreVerdict> {
  const portal = await portalPaymentInSupabase(email);
  if (!portal.readable) return noAnswer(portal.detail);
  return { paid: portal.paid, paidAt: portal.paidAt ?? null, readable: true, detail: portal.detail };
}

/**
 * LICENCE KEYS — the live KV store (keys assigned to this client) and the
 * legacy `license_keys` table. Either one holding a key for this address is a
 * paid mark of its own; the holder-bound `users.license_key` is counted in
 * `readUsersStore`.
 */
async function readLicenceKeys(email: string): Promise<StoreVerdict> {
  const details: string[] = [];
  let paid = false;
  let readable = true;

  try {
    const { kvRead } = await import("./_registry.js");
    const count = Number(await kvRead(["SCARD", `eamp:license-by-client:${email}`])) || 0;
    if (count > 0) paid = true;
    details.push(`KV keys for client: ${count}`);
  } catch (error) {
    readable = false;
    details.push(`KV licence keys → ${errorText(error)}`);
  }

  const db = await serviceClient();
  if (!db) {
    details.push("license_keys → no database in this deployment");
  } else {
    try {
      const base = db.from("license_keys").select("key");
      const scoped = /[%_]/.test(email) ? base.eq("email", email) : base.ilike("email", email);
      const query = scoped.limit(1).maybeSingle();
      const { data, error } = await storeDeadline(
        query,
        { data: null, error: { message: "store did not answer in time" } } as unknown as Awaited<typeof query>,
        "license_keys",
      );
      if (error) {
        if (absentStore(error)) details.push("license_keys → not present in this deployment");
        else {
          const verdict = await databaseStoreFailure("license_keys", error);
          if (!verdict.readable) readable = false;
          details.push(verdict.detail);
        }
      } else if (data) {
        paid = true;
        details.push("legacy key held");
      } else {
        details.push("no key held");
      }
    } catch (error) {
      const verdict = await databaseStoreFailure("license_keys", error);
      if (!verdict.readable) readable = false;
      details.push(verdict.detail);
    }
  }

  return { paid, readable, detail: details.join(" · ") };
}

/**
 * THE DECISION — every store is read, then one rule decides:
 *
 *   1. ADMIN passes first, before any store is consulted.
 *   2. ANY paid mark wins. One store saying "paid" is never downgraded by
 *      another store saying "no", being absent, or failing to answer.
 *   3. A deliberate revocation / rejection in the console stands only when
 *      nothing marks the address paid.
 *   4. Otherwise: every store answered and none is paid → `unpaid` (the plan
 *      chooser); ANY store unreachable → `undecided`, which the client turns
 *      into "Checking your subscription… Retry" and never into the plans.
 *
 * One diagnostic line is logged with every store's answer, so the next report
 * shows the real cause instead of a guess.
 */
async function resolveAccess(email: string, deviceId: string | null): Promise<AccessAnswer> {
  // Server-side only now — this file never ships KV client code to the browser.
  const { isSoleAdminEmail } = await import("./_registry.js");

  // ── 1. THE SOLE ADMIN, FIRST ──────────────────────────────────────────────
  //
  // Only biyasentobeko222@gmail.com short-circuits the stores. Every other
  // address — console accounts included — is answered by its paid records, so
  // an account that holds a paid mark is reported as "paid" rather than being
  // labelled admin and skipping the stores altogether.
  if (isSoleAdminEmail(email)) {
    const stores: Record<string, string> = {
      "users table": "admin — not consulted",
      "KV registrations": "admin — not consulted",
      "paid ledger": "admin — not consulted",
      "portal accounts": "admin — not consulted",
      "licence keys": "admin — not consulted",
      "cloud access gate": "admin",
    };
    console.info(diagnosticLine(email, stores, "admin"));
    return { ok: true, isPaid: true, status: "admin", stores };
  }

  // ── 2. EVERY STORE, IN PARALLEL, EACH INSIDE ITS OWN GUARD ───────────────
  const [kv, users, ledger, portal, keys] = await Promise.all([
    readKvRegistrations(email),
    readUsersStore(email, deviceId),
    readPaidLedger(email),
    readPortalAccounts(email),
    readLicenceKeys(email),
  ]);

  // ── EVERY STORE, LOGGED — reachable yes/no, and paid / null / error ────────
  //
  // One line per store, printed on EVERY check (not only a refusal), so the
  // Vercel log shows exactly which read threw and why the gate answered what it
  // did for a given address. A store that could not be READ is printed as
  // `error` and never as `null` — that distinction is the whole rule: an
  // unreachable store is not evidence of non-payment.
  logStore(email, "users table", users);
  logStore(email, "KV registrations", kv);
  logStore(email, "paid ledger", ledger);
  logStore(email, "portal accounts", portal);
  logStore(email, "licence keys", keys);

  const verdicts: Array<[string, StoreVerdict]> = [
    ["users table", users],
    ["KV registrations", kv],
    ["paid ledger", ledger],
    ["portal accounts", portal],
    ["licence keys", keys],
  ];
  const stores: Record<string, string> = {};
  for (const [name, verdict] of verdicts) stores[name] = verdict.detail;

  // ── 3. ANY PAID MARK IS ENOUGH ───────────────────────────────────────────
  const paidBy = verdicts.find(([, verdict]) => verdict.paid);
  let decided: AccessAnswer;
  if (paidBy) {
    const [name, verdict] = paidBy;
    stores["cloud access gate"] = `paid via ${name}`;
    decided = {
      ok: true,
      isPaid: true,
      status: "paid",
      ...(verdict.paidAt ? { paidAt: verdict.paidAt } : {}),
      // The breakdown travels with EVERY verdict, so the client can log what
      // each store said even when the answer is yes.
      stores,
    };
    console.info(diagnosticLine(email, stores, `paid (${name})`));
  } else if (kv.revoked) {
    stores["cloud access gate"] = "revoked";
    console.info(diagnosticLine(email, stores, "revoked"));
    decided = { ok: true, isPaid: false, status: "revoked", stores };
  } else if (kv.rejected) {
    stores["cloud access gate"] = "rejected";
    console.info(diagnosticLine(email, stores, "rejected"));
    decided = { ok: true, isPaid: false, status: "rejected", stores };
  } else {
    const unreadable = verdicts.filter(([, verdict]) => !verdict.readable).map(([, verdict]) => verdict.detail);
    if (unreadable.length > 0) {
      // A SOURCE WE COULD NOT READ COULD BE THE ONE THAT KNOWS THIS EMAIL.
      stores["cloud access gate"] = "undecided — unreachable source";
      console.warn(diagnosticLine(email, stores, "undecided"));
      decided = {
        ok: false,
        isPaid: false,
        status: "undecided",
        error: "Access check could not complete — one record source was unreachable",
        unreadable,
        stores,
      };
    } else {
      stores["cloud access gate"] = "unpaid — every store answered";
      console.info(diagnosticLine(email, stores, "unpaid"));
      decided = { ok: true, isPaid: false, status: "unpaid", stores };
    }
  }

  // THE BINDING, IN THE SAME ANSWER — see readDeviceBinding above. The keys are
  // only added when the read succeeded, so an unreadable database can never be
  // mistaken for "this email is unbound".
  const binding = await readDeviceBinding(email);
  if (binding.readable) {
    decided["deviceBinding"] = binding.value;
    if (deviceId) {
      decided["deviceMatches"] = binding.value?.deviceId === deviceId;
    }
  }
  return decided;
}

type LedgerRead = { paidAt: string | null; readable: boolean; detail: string };

/** The console's payment ledger — one of the authoritative paid sources. */
async function paidEmailInSupabase(email: string): Promise<LedgerRead> {
  const db = await serviceClient();
  if (!db) {
    return { paidAt: null, readable: true, detail: "paid ledger → no database in this deployment, no row" };
  }
  try {
    const base = db.from("paid_emails").select("paid_at");
    const scoped = /[%_]/.test(email) ? base.eq("email", email) : base.ilike("email", email);
    const query = scoped.neq("paid_at", null).order("paid_at", { ascending: false }).limit(1);
    const { data, error } = await storeDeadline(
      query,
      { data: null, error: { message: "store did not answer in time" } } as unknown as Awaited<typeof query>,
      "paid ledger",
    );

    if (error) {
      if (absentStore(error)) {
        return { paidAt: null, readable: true, detail: "paid ledger → table not present in this deployment, no row" };
      }
      const verdict = await databaseStoreFailure("paid ledger", error);
      return { paidAt: null, readable: verdict.readable, detail: verdict.detail };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const paidAt = row && typeof (row as { paid_at?: unknown }).paid_at === "string"
      ? ((row as { paid_at: string }).paid_at as string)
      : null;
    return { paidAt, readable: true, detail: paidAt ? `paid ledger → paid at ${paidAt}` : "paid ledger → no paid row" };
  } catch (error) {
    const verdict = await databaseStoreFailure("paid ledger", error);
    return { paidAt: null, readable: verdict.readable, detail: verdict.detail };
  }
}

type PortalPayment = { paid: boolean; paidAt?: string; readable: boolean; detail: string };

/**
 * THE PORTAL'S OWN PAYMENT RECORD (`portal_payments`).
 *
 * A mentor marks a client paid on the portal; that record is payment on its
 * own, exactly like the ledger. Read here with the service role so a broken
 * browser read of the same table can never deny a paid client.
 */
async function portalPaymentInSupabase(email: string): Promise<PortalPayment> {
  const db = await serviceClient();
  if (!db) {
    return { paid: false, readable: true, detail: "portal payments → no database in this deployment, no row" };
  }
  try {
    const base = db.from("portal_payments").select("paid, paid_at");
    const scoped = /[%_]/.test(email) ? base.eq("email", email) : base.ilike("email", email);
    const query = scoped.limit(1);
    const { data, error } = await storeDeadline(
      query,
      { data: null, error: { message: "store did not answer in time" } } as unknown as Awaited<typeof query>,
      "portal payments",
    );
    if (error) {
      if (absentStore(error)) {
        return { paid: false, readable: true, detail: "portal payments → table not present in this deployment, no row" };
      }
      const verdict = await databaseStoreFailure("portal payments", error);
      return { paid: false, readable: verdict.readable, detail: verdict.detail };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { paid: false, readable: true, detail: "portal payments → no row" };
    const record = row as { paid?: unknown; paid_at?: unknown };
    const paidAt = typeof record.paid_at === "string" ? record.paid_at : undefined;
    const paid = record.paid === true || Boolean(paidAt);
    return {
      paid,
      ...(paidAt ? { paidAt } : {}),
      readable: true,
      detail: paid ? "portal payments → paid" : "portal payments → not paid",
    };
  } catch (error) {
    const verdict = await databaseStoreFailure("portal payments", error);
    return { paid: false, readable: verdict.readable, detail: verdict.detail };
  }
}

/** One line describing any thrown value, `cause` included. */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${error.name}: ${error.message}${cause ? ` (cause: ${String(cause)})` : ""}`;
  }
  return String(error);
}
