import { createServerFn } from "@tanstack/react-start";

/**
 * MetaApi (metaapi.cloud) platform integration — ONE master token for everyone.
 *
 * The master token lives ONLY on the server (env / built-in fallback). The
 * frontend never sees it and never calls MetaApi directly — it calls the server
 * functions below (this stack's edge functions), which attach the token.
 *
 * Master token resolution: METAAPI_TOKEN in process.env — the ONLY source.
 * The value is trimmed (no stray spaces/newlines) and sent under the
 * "auth-token" header (never Authorization/Bearer). When it is missing the
 * functions fail fast with an explicit "METAAPI_TOKEN missing" message
 * instead of probing a dead baked-in token.
 *
 * Endpoints (verified live against MetaApi's official API):
 * - List accounts:   GET  https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts
 * - Create/connect:  POST /users/current/accounts
 *                    { login, password, name, server, platform: "mt5",
 *                      magic, region?, type: "cloud-g2" }
 *                    Broker settings detection/connection validation can take
 *                    time — the API may answer 200 with a "please retry in N
 *                    seconds" message; the caller repeats the same request.
 * - Account detail:  GET /users/current/accounts/{accountId}  (state, connectionStatus…)
 * - Delete:          DELETE /users/current/accounts/{accountId}
 * - Trade:           POST https://mt-client-api-v1.<region>.agiliumtrade.ai/users/current/accounts/{accountId}/orders
 *                    { actionType: "ORDER_TYPE_BUY"|"ORDER_TYPE_SELL",
 *                      symbol, volume, comment }  (market order — no price)
 */

const PROVISIONING_BASE = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

/** Client API hosts per region (the trade execution plane). */
export const CLIENT_API_HOSTS: Record<string, string> = {
  "new-york": "https://mt-client-api-v1.new-york.agiliumtrade.ai",
  london: "https://mt-client-api-v1.london.agiliumtrade.ai",
  singapore: "https://mt-client-api-v1.singapore.agiliumtrade.ai",
  "hong-kong": "https://mt-client-api-v1.hong-kong.agiliumtrade.ai",
  moscow: "https://mt-client-api-v1.moscow.agiliumtrade.ai",
  frankfurt: "https://mt-client-api-v1.frankfurt.agiliumtrade.ai",
  sydney: "https://mt-client-api-v1.sydney.agiliumtrade.ai",
  "san-francisco": "https://mt-client-api-v1.san-francisco.agiliumtrade.ai",
  "sao-paulo": "https://mt-client-api-v1.sao-paulo.agiliumtrade.ai",
  mumbai: "https://mt-client-api-v1.mumbai.agiliumtrade.ai",
  "tokyo-1": "https://mt-client-api-v1.tokyo-1.agiliumtrade.ai",
};

/**
 * Strips whitespace and quote wrappers that env settings screens sometimes add
 * — a token pasted with a trailing newline or quotes is otherwise rejected by
 * MetaApi with 401 even though it is valid.
 */
function cleanKey(raw: string | undefined | null): string {
  return (raw ?? "")
    .trim()
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "");
}

/**
 * The platform master token — read from the environment ONLY (trimmed).
 * A stale token baked into source is what produced silent 401s before: when
 * no METAAPI_TOKEN is configured the app must say so instead of probing a
 * dead built-in key.
 */
function candidateTokens(): string[] {
  const env = typeof process !== "undefined" ? (process?.env ?? {}) : {};
  const token = cleanKey(env["METAAPI_TOKEN"]);
  if (token.length > 0) {
    // Masked fingerprint (sha256, first 10 hex chars) — lets support prove
    // WHICH token the running process holds without ever printing the secret.
    try {
      const { createHash } = require("node:crypto") as typeof import("node:crypto");
      const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 10);
      console.log("[metaapi] METAAPI_TOKEN fingerprint:", fingerprint, "len", token.length);
    } catch {
      // logging must never break the flow
    }
    return [token];
  }
  return [];
}

type MaResponse = { status: number; payload?: unknown; retryAfterSeconds?: number };

/** True when the payload is a MetaApi billing block (auth PASSED, plan empty). */
function isBillingBlock(payload: unknown): boolean {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return /top up your account|insufficient (funds|credits)|no trading credits|billing.*required|upgrade.*plan/i.test(
    raw,
  );
}

/** True when MetaApi rejected our authorization (the platform's master token). */
function isAuthRejected(status: number, payload: unknown): boolean {
  // A 403 Forbidden billing block means the request reached MetaApi with VALID
  // auth — the plan is simply out of credits. Classifying it as a token
  // rejection produced the false "invalid token" banner and hid the real fix.
  if (isBillingBlock(payload)) return false;
  if (status === 401 || status === 403) return true;
  const raw = JSON.stringify(payload ?? {}).toLowerCase();
  return raw.includes("unauthorizederror") || raw.includes("invalid auth-token");
}

/**
 * True when MetaApi blocked the operation because the platform's MetaApi plan
 * has no trading credits left (the free trial ran out). MetaApi answers with
 * a ForbiddenError — "To allow trading account deployment please top up your
 * account." — and undeploys hosted accounts until the account is topped up.
 * This MUST surface to the user immediately: no amount of retrying executes
 * a single trade while the provider plan is blocked.
 */
function billingBlockMessage(payload: unknown): string | undefined {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const blocked =
    /top up your account|insufficient (funds|credits)|upgrade.*plan|billing.*required/i.test(raw);
  if (!blocked) return undefined;
  return (
    "MetaApi (the trade-execution provider) blocked this action: the platform's MetaApi plan has no trading credits left. " +
    "The account owner must top up / upgrade the MetaApi account at app.metaapi.cloud — after that trades execute again without any app change."
  );
}

/** Human-readable message from a MetaApi error payload. */
function maError(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const record = payload as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (Array.isArray(record.errors) && record.errors.length > 0)
      return record.errors.map((item) => String(item)).join(", ");
  }
  return undefined;
}

/** The token MetaApi last accepted — avoids re-probing every call. */
let workingToken: string | null = null;

/**
 * Runs `run` with the first candidate token MetaApi accepts. A stale or
 * half-pasted value under one env name can no longer block the flow — every
 * candidate is tried until one passes. 401/403 advance to the next candidate.
 */
async function withMasterToken(
  run: (token: string) => Promise<MaResponse>,
): Promise<
  { kind: "ok"; response: MaResponse } | { kind: "missing" } | { kind: "rejected"; status: number }
> {
  const tokens = candidateTokens();
  if (tokens.length === 0) return { kind: "missing" };
  if (workingToken && tokens.includes(workingToken)) {
    const response = await run(workingToken);
    if (!isAuthRejected(response.status, response.payload)) return { kind: "ok", response };
    workingToken = null; // no longer accepted (rotated?) — re-probe all candidates
  }
  let lastStatus = 0;
  for (const token of tokens) {
    const response = await run(token);
    if (!isAuthRejected(response.status, response.payload)) {
      workingToken = token;
      return { kind: "ok", response };
    }
    lastStatus = response.status || lastStatus;
  }
  return { kind: "rejected", status: lastStatus };
}

/** fetch with JSON parsing and a hard timeout — the client API can hang for minutes when cold. */
export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; payload?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // empty body is fine
    }
    return payload === undefined
      ? { status: response.status }
      : { status: response.status, payload };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warms the account's broker connection by polling the client API's
 * account-information endpoint — MetaApi connects lazily, on first use, and
 * cold accounts answer trade requests with 504/"530"-style rejections.
 * Returns status 200 with account info once warm, 504-shaped payload on timeout.
 */
async function warmAccountConnection(
  token: string,
  accountId: string,
  region: string | undefined,
  budgetMs: number,
): Promise<MaResponse> {
  const hosts =
    region && CLIENT_API_HOSTS[region]
      ? [CLIENT_API_HOSTS[region]]
      : Object.values(CLIENT_API_HOSTS);
  const deadline = Date.now() + budgetMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    for (const host of hosts) {
      const result = await fetchJson(
        `${host}/users/current/accounts/${encodeURIComponent(accountId)}/account-information`,
        { headers: { "auth-token": token, Accept: "application/json" } },
        15_000,
      );
      if (result.status === 200) return { status: 200, payload: result.payload };
      if (result.status === 404) continue; // wrong region host — try the next one
      // 504/5xx → not connected yet; keep polling until the budget runs out
    }
    const waitMs = attempt <= 2 ? 5_000 : 10_000;
    if (Date.now() + waitMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { status: 504, payload: { message: "Broker connection is still starting." } };
}

/** Exactly 32 hex chars — MetaApi's required transaction-id format (UUID without dashes). */
function newTransactionId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    let id = "";
    for (let index = 0; index < 32; index += 1) id += Math.floor(Math.random() * 16).toString(16);
    return id;
  }
}

/** Runs one MetaApi provisioning request. */
export async function maFetch(
  token: string,
  path: string,
  init: { method?: string; json?: unknown; transactionId?: string } = {},
): Promise<MaResponse> {
  const headers: Record<string, string> = {
    "auth-token": token,
    Accept: "application/json",
  };
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    // Provisioning writes want a stable transaction id so in-progress broker
    // settings detection can be polled with the same id.
    headers["transaction-id"] = init.transactionId ?? newTransactionId();
  }
  try {
    const response = await fetch(`${PROVISIONING_BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // empty body is fine
    }
    const retryAfter = response.headers.get("retry-after");
    let retryAfterSeconds: number | undefined;
    if (retryAfter) {
      const asDate = Date.parse(retryAfter);
      retryAfterSeconds = Number.isFinite(asDate)
        ? Math.max(5, Math.round((asDate - Date.now()) / 1000))
        : Number.parseInt(retryAfter, 10) || undefined;
    }
    return retryAfterSeconds === undefined
      ? { status: response.status, payload }
      : { status: response.status, payload, retryAfterSeconds };
  } catch {
    return { status: 0 };
  }
}

export type MtFailureCode = "key_missing" | "key_rejected" | "failed";

/** Defensive only — this makes the missing env var explicit for the user. */
export function missingKeyMessage(): string {
  return "METAAPI_TOKEN is missing in the server environment — add it once in Settings → Environment (it is trimmed automatically), then Connect works instantly.";
}

/** The token is present but MetaApi rejected it. */
function rejectedKeyMessage(status: number): string {
  return `MetaApi rejected the platform's access token (HTTP ${status}). The token is set but invalid, expired, or lacks permissions — generate a new one in the MetaApi dashboard and update the server setting.`;
}

export type MaAccount = {
  id?: string;
  /** The provisioning API returns the account id as `_id` on list/detail payloads. */
  _id?: string;
  login?: string;
  name?: string;
  server?: string;
  platform?: string;
  state?: string;
  connectionStatus?: string;
  region?: string;
  reliability?: string;
  magic?: number;
  type?: string;
  statusMessage?: string;
};

/** The account id arrives as `id` on some payloads and `_id` on others. */
function accountIdOf(account: MaAccount | undefined | null): string | undefined {
  return account?.id ?? account?._id ?? undefined;
}

/**
 * Demo accounts are first-class: MetaApi hosts them exactly like live ones.
 * The platform has no explicit live/demo flag, so the kind is inferred from
 * the broker server name (the industry convention — demo/trial/contest
 * servers are named that way on every major broker).
 */
export function accountKindFor(server: string, login?: string): "live" | "demo" {
  const text = `${server} ${login ?? ""}`.toLowerCase();
  return /demo|trial|contest|practice|virtual|simulated|ptr\b|"test"/.test(text) ? "demo" : "live";
}

export type MtConnectRequest = {
  /** The user's own MT5 account number — any login works, nothing is hardcoded. */
  login: string;
  password: string;
  server: string;
  /** Shown in the MetaApi dashboard, e.g. the app user's email. */
  alias?: string;
  /** MT5 by default; MT4 also supported by the platform. */
  platform?: "mt4" | "mt5";
  /** The type the user picked in the app (Standard, ECN, Demo…) — stored, not sent. */
  accountType?: string;
};

export type MtFailure = { ok: false; code: MtFailureCode; message: string };

export type MtConnectResult =
  | { ok: true; accountId: string; environment?: string; kind?: "live" | "demo" }
  | MtFailure;

export type MtDisconnectRequest = { accountId: string };
export type MtDisconnectResult = { ok: true; message: string } | MtFailure;

export type MtStatusRequest = { accountId: string };
export type MtStatusResult =
  | {
      ok: true;
      connected: boolean;
      balance?: number;
      equity?: number;
      currency?: string;
      environment?: string;
      statusMessage?: string;
    }
  | MtFailure;

export type LiveTradeRequest = {
  /** The END USER's MetaApi account id (their connected MT5). */
  accountId: string;
  eaName: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: string;
  /** Stop-loss price — attached to the order when provided. */
  stopLoss?: string;
  /** Take-profit price — attached to the order when provided. */
  takeProfit?: string;
  /** Account region returned at connect time — picks the trade API host. */
  region?: string;
};

export type LiveTradeResult = { ok: true; message: string; orderId?: string } | MtFailure;

/**
 * Connect the END USER's MT5 account under the platform's MetaApi account.
 * MetaApi validates credentials and detects broker settings during creation;
 * detection can take 30–120s and the API asks the caller to retry — handled
 * here automatically (up to ~4 minutes total) so the user just presses once.
 */
export const connectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtConnectRequest) => data)
  .handler(async ({ data }): Promise<MtConnectResult> => {
    const login = data.login.trim();
    const password = data.password;
    const server = data.server.trim();
    if (!login || !password || !server)
      return {
        ok: false,
        code: "failed",
        message: "Enter your login, password and server before connecting.",
      };

    const body = {
      login,
      password,
      name: (data.alias ?? login).slice(0, 100),
      server,
      platform: data.platform ?? "mt5",
      magic: 100001,
      type: "cloud-g2",
      region: "new-york",
    };

    const platform = body.platform as string;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Current connection state + region of a hosted account. */
    const inspectAccount = async (
      accountId: string,
    ): Promise<{ status: string; state?: string | undefined; region?: string | undefined }> => {
      const detail = await withMasterToken((token) =>
        maFetch(token, `/users/current/accounts/${encodeURIComponent(accountId)}`),
      );
      if (detail.kind === "ok" && detail.response.status === 200) {
        const account = detail.response.payload as MaAccount | undefined;
        return {
          status: String(account?.connectionStatus ?? ""),
          state: account?.state,
          region: account?.region,
        };
      }
      return { status: "" };
    };

    const deleteHosted = (accountId: string) =>
      withMasterToken((token) =>
        maFetch(token, `/users/current/accounts/${encodeURIComponent(accountId)}`, {
          method: "DELETE",
        }),
      );

    /**
     * Creates a hosted copy of this login on MetaApi with the requested
     * infrastructure type, retrying while broker settings are detected.
     * First-time broker validation takes 60–90s and MetaApi answers early
     * polls with 202 "retry in N seconds" — the deadline honors that instead
     * of giving up mid-validation (the copy keeps building either way; a
     * repeat press continues it).
     */
    const createHosted = async (
      type: "cloud-g2" | "cloud-g1",
    ): Promise<{ id?: string; error?: string }> => {
      const transactionId = newTransactionId();
      const deadline = Date.now() + 90_000;
      for (;;) {
        const outcome = await withMasterToken((token) =>
          maFetch(token, "/users/current/accounts", {
            method: "POST",
            json: { ...body, type },
            transactionId,
          }),
        );
        if (outcome.kind === "missing") return { error: "missing" };
        if (outcome.kind === "rejected") return { error: "rejected" };
        const { status, payload } = outcome.response;
        const account = payload as (MaAccount & { message?: string }) | undefined;
        const createdId = accountIdOf(account);
        if (status >= 200 && status < 300 && createdId) return { id: createdId };
        const message = maError(payload);
        const retryMatch = /retry in (\d+) seconds/i.exec(message ?? "");
        if (retryMatch && Date.now() < deadline) {
          await sleep(Math.min(Number(retryMatch[1]) + 2, 15) * 1000);
          continue;
        }
        if (status === 202 && Date.now() < deadline) {
          await sleep(10_000);
          continue;
        }
        return { error: message || `HTTP ${status}` };
      }
    };

    const connectOk = (accountId: string, region?: string): MtConnectResult => {
      const kind = accountKindFor(server, login);
      return { ok: true, accountId, ...(region ? { environment: region } : {}), kind };
    };

    // Reuse an already-hosted copy of this exact login+server instead of
    // creating a duplicate when Connect is pressed twice. A copy that is
    // still attaching to the broker (first-time validation can take a
    // couple of minutes) is WAITED ON here — never deleted — so a retry
    // continues where the last attempt left off. Stale duplicates beyond
    // the chosen copy are removed so the platform's MetaApi slots don't
    // fill up. Some brokers refuse MetaApi's G2 terminal; in that case the
    // hosted copy is rebuilt on the G1 infrastructure, which different
    // broker stacks accept.
    const listOutcome = await withMasterToken((token) => maFetch(token, "/users/current/accounts"));
    if (listOutcome.kind === "ok" && Array.isArray(listOutcome.response.payload)) {
      const matchIds = (listOutcome.response.payload as MaAccount[])
        .filter(
          (account) =>
            String(account.login ?? "") === login &&
            account.server === server &&
            (account.platform ?? "mt5") === platform,
        )
        .map(accountIdOf)
        .filter((accountId): accountId is string => Boolean(accountId));
      if (matchIds.length > 0) {
        const states = await Promise.all(
          matchIds.map(async (accountId) => ({ accountId, ...(await inspectAccount(accountId)) })),
        );
        const live = states.find((state) => state.status === "CONNECTED");
        const pending =
          states.find((state) => state.state === "DEPLOYED" && state.status !== "CONNECTED") ??
          states[0];
        const keep = live?.accountId ?? pending?.accountId;
        // Keep the one copy being reused/waited on; delete every other duplicate.
        for (const accountId of matchIds) {
          if (accountId !== keep) await deleteHosted(accountId);
        }
        if (live) return connectOk(live.accountId, live.region);
        if (keep) {
          // The copy exists but hasn't attached yet. Nudge it with a deploy
          // (best-effort — an already-deployed copy may refuse) and give it a
          // patient window to come up. This is the "it was taking time" case:
          // the previous press already did the hard part; this one waits it out.
          await withMasterToken((token) =>
            maFetch(token, `/users/current/accounts/${encodeURIComponent(keep)}/deploy`, {
              method: "POST",
            }),
          ).catch(() => undefined);
          const region = states.find((state) => state.accountId === keep)?.region;
          const warm = await withMasterToken((token) =>
            warmAccountConnection(token, keep, region, 75_000),
          );
          if (warm.kind === "ok" && warm.response.status === 200) {
            return connectOk(keep, region);
          }
          // Still not up after the patient window — fall through to a rebuild
          // on the other infrastructure type, but leave this copy in place so
          // a later retry can keep waiting on it.
        }
      }
    }

    type BuildOutcome =
      | { ok: true; accountId: string; environment?: string }
      | { ok: false; accountId?: string; message?: string };

    const buildAndSettle = async (type: "cloud-g2" | "cloud-g1"): Promise<BuildOutcome> => {
      const created = await createHosted(type);
      if (created.error === "missing")
        return { ok: false, message: missingKeyMessage() };
      if (created.error === "rejected")
        return { ok: false, message: rejectedKeyMessage(401) };
      if (!created.id) {
        const billing = billingBlockMessage(created.error);
        if (billing) return { ok: false, message: billing };
        return {
          ok: false,
          message: created.error
            ? `MetaApi could not connect the account: ${created.error}. Check the login, password and exact server name (e.g. Headway-Demo).`
            : "MetaApi is still detecting this broker's connection settings — press Connect Account again in a minute and it will link instantly.",
        };
      }
      const createdId = created.id;
      // Give the terminal a real window to attach to the broker. Poking the
      // client API both triggers MetaApi's lazy terminal attach and proves
      // the broker connection is live (provisioning status alone can lag).
      // First attach commonly needs 60–90s — one full patient window here;
      // if the broker refuses this infrastructure type, the G1 rebuild gets
      // its own window instead of double-waiting on a doomed one.
      await sleep(8_000);
      const { region } = await inspectAccount(createdId);
      const poke = await withMasterToken((token) =>
        warmAccountConnection(token, createdId, region, 75_000),
      );
      const pokeOk = poke.kind === "ok" && poke.response.status === 200;
      if (pokeOk) return connectOk(createdId, region);
      return { ok: false, accountId: createdId };
    };

    // First choice: G2 (recommended infrastructure). If its terminal can't
    // attach to this broker, rebuild the very same login on G1.
    const g2 = await buildAndSettle("cloud-g2");
    if (g2.ok) return connectOk(g2.accountId, g2.environment);
    // The provider refused to even create/host the copy (e.g. the plan is out
    // of trading credits) — retrying on G1 cannot help, report the real reason.
    if (!g2.accountId && g2.message && billingBlockMessage(g2.message)) {
      return { ok: false, code: "failed", message: g2.message };
    }

    const g2Id = g2.accountId;
    const g1 = await buildAndSettle("cloud-g1");
    if (g1.ok) {
      // G1 works — remove the dead G2 copy so no duplicate lingers.
      if (g2Id) await deleteHosted(g2Id);
      return connectOk(g1.accountId, g1.environment);
    }

    // Neither terminal attached inside the connect window. Keep ONE copy (the
    // status check redeploys it and trades wait for the connection) but report
    // the truth: after two infrastructure rebuilds the broker's server is not
    // accepting cloud trading terminals — the user must know, not see a fake
    // "Connected" state that then never executes a single trade. A provider
    // billing block also ends the flow immediately with its exact reason.
    if (g2Id) await deleteHosted(g2Id);
    if (g1.accountId) {
      const billing = g1.message ? billingBlockMessage(g1.message) : undefined;
      return {
        ok: false,
        code: "failed",
        message:
          billing ||
          g1.message ||
          "The broker's server did not accept the cloud trading terminal (tried both infrastructure types). Double-check the password and exact server name (e.g. Headway-Demo). If they are right, this broker server blocks cloud terminals — try the same broker's live or demo server, or another broker. Your details are saved; press Connect again in a few minutes in case the broker was briefly offline.",
      };
    }
    return {
      ok: false,
      code: "failed",
      message:
        g1.message ||
        "MetaApi could not connect the account. Check the login, password and exact server name (e.g. Headway-Demo).",
    };
  });

/** GET /accounts — lists this platform's connected accounts (diagnostics). */
export const listMtAccounts = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true; accounts: MaAccount[] } | MtFailure> => {
    const outcome = await withMasterToken((token) => maFetch(token, "/users/current/accounts"));
    if (outcome.kind === "missing")
      return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected")
      return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };
    const { status, payload } = outcome.response;
    if (status < 200 || status >= 300 || !Array.isArray(payload)) {
      return {
        ok: false,
        code: "failed",
        message: maError(payload) || `Could not list accounts (HTTP ${status}).`,
      };
    }
    return { ok: true, accounts: payload as MaAccount[] };
  },
);

/** GET /accounts/{accountId} — live connection state for the user's account. */
export const getMtAccountStatus = createServerFn({ method: "POST" })
  .validator((data: MtStatusRequest) => data)
  .handler(async ({ data }): Promise<MtStatusResult> => {
    const outcome = await withMasterToken((token) =>
      maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`),
    );
    if (outcome.kind === "missing")
      return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected")
      return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

    const { status, payload } = outcome.response;
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        code: "failed",
        message: maError(payload) || `Account not found (HTTP ${status}).`,
      };
    }
    const account = payload as MaAccount;

    // Stay connected until the user presses Disconnect: if MetaApi undeployed
    // the account for any reason, bring it straight back up. When the provider
    // refuses (e.g. the plan is out of trading credits), say so instead of
    // showing a green "Connected" state that can never execute a trade.
    let deployBlock: string | undefined;
    if (account.state !== "DEPLOYED") {
      const deployOutcome = await withMasterToken((token) =>
        maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}/deploy`, {
          method: "POST",
        }),
      );
      if (
        deployOutcome.kind === "ok" &&
        deployOutcome.response.status >= 400 &&
        deployOutcome.response.status < 500
      ) {
        const billing = billingBlockMessage(deployOutcome.response.payload);
        if (billing) deployBlock = billing;
      }
    }
    const connected = account.state === "DEPLOYED" && !deployBlock;

    // The status type carries statusMessage — reuse it to deliver the provider's
    // refusal text to the MetaTrader page instead of a fake green state.
    const statusMessages = [
      ...(deployBlock ? [deployBlock] : []),
      ...(account.statusMessage ? [account.statusMessage] : []),
    ].join(" ");

    // Best-effort balance read within a short budget; the trade path waits longer.
    let balance: number | undefined;
    let equity: number | undefined;
    let currency: string | undefined;
    if (connected) {
      const warmOutcome = await withMasterToken((token) =>
        warmAccountConnection(token, data.accountId, account.region, 20_000),
      );
      if (warmOutcome.kind === "ok" && warmOutcome.response.status === 200) {
        const info = warmOutcome.response.payload as
          { balance?: number; equity?: number; currency?: string } | undefined;
        balance = info?.balance;
        equity = info?.equity;
        currency = info?.currency;
      }
    }

    return {
      ok: true,
      connected,
      ...(balance !== undefined ? { balance } : {}),
      ...(equity !== undefined ? { equity } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(statusMessages ? { statusMessage: statusMessages } : {}),
      ...(account.region ? { environment: account.region } : {}),
    };
  });

/** DELETE /accounts/{accountId} — removes the user's hosted connection. */
export const disconnectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtDisconnectRequest) => data)
  .handler(async ({ data }): Promise<MtDisconnectResult> => {
    const outcome = await withMasterToken((token) =>
      maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`, {
        method: "DELETE",
      }),
    );
    if (outcome.kind === "missing")
      return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected")
      return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };
    const { status, payload } = outcome.response;
    if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
      return {
        ok: false,
        code: "failed",
        message: maError(payload) || `Could not remove the account (HTTP ${status}).`,
      };
    }
    return { ok: true, message: "MT5 account disconnected." };
  });

/** POST {clientApi}/users/current/accounts/{accountId}/orders — market order. */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    if (!data.accountId)
      return {
        ok: false,
        code: "failed",
        message: "No connected MT5 account. Link your account on the MetaTrader page first.",
      };

    const volume = Math.max(Number.parseFloat(data.lotSize) || 0, 0.01);
    const stopLoss =
      data.stopLoss !== undefined && data.stopLoss !== ""
        ? Number.parseFloat(data.stopLoss)
        : undefined;
    const takeProfit =
      data.takeProfit !== undefined && data.takeProfit !== ""
        ? Number.parseFloat(data.takeProfit)
        : undefined;
    // MT5 caps the order comment at 31 characters. Keep the " - Ea migrate"
    // suffix intact and truncate the robot name instead.
    const commentSuffix = " - Ea migrate";
    const nameBudget = Math.max(0, 31 - commentSuffix.length);
    const shortName =
      data.eaName.length > nameBudget ? data.eaName.slice(0, nameBudget).trimEnd() : data.eaName;
    const body: Record<string, unknown> = {
      actionType: data.direction === "SELL" ? "ORDER_TYPE_SELL" : "ORDER_TYPE_BUY",
      symbol: data.symbol,
      volume,
      comment: `${shortName}${commentSuffix}`,
    };
    if (stopLoss !== undefined && Number.isFinite(stopLoss) && stopLoss > 0)
      body["stopLoss"] = stopLoss;
    if (takeProfit !== undefined && Number.isFinite(takeProfit) && takeProfit > 0)
      body["takeProfit"] = takeProfit;

    // Resolve the account's region (its API host depends on it) and make sure
    // it is deployed. Cold accounts reject orders with 504/"530"-style errors,
    // so warm the broker connection BEFORE placing the order.
    let region = data.region;
    const detail = await withMasterToken((token) =>
      maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`),
    );
    if (detail.kind === "ok" && detail.response.status === 200) {
      const account = detail.response.payload as MaAccount | undefined;
      region = account?.region ?? region;
      if (account && account.state !== "DEPLOYED") {
        const deployOutcome = await withMasterToken((token) =>
          maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}/deploy`, {
            method: "POST",
          }),
        );
        if (
          deployOutcome.kind === "ok" &&
          deployOutcome.response.status >= 400 &&
          deployOutcome.response.status < 500
        ) {
          // MetaApi itself refused the deployment (billing block, account
          // removed, no copy…) — that reason must reach the user verbatim.
          const billing = billingBlockMessage(deployOutcome.response.payload);
          if (billing) return { ok: false, code: "failed", message: billing };
          const reason = maError(deployOutcome.response.payload);
          if (reason)
            return {
              ok: false,
              code: "failed",
              message: `The trade provider refused to start this account: ${reason}`,
            };
        }
      }
    }

    // Serverless-safe warm budget: the function dies after ~60s on Vercel, so
    // waiting longer here means the order is NEVER sent. Cold brokers are
    // handled by the client's persistent retry loop instead.
    const warmOutcome = await withMasterToken((token) =>
      warmAccountConnection(token, data.accountId, region, 30_000),
    );
    if (warmOutcome.kind === "missing")
      return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (warmOutcome.kind === "rejected")
      return { ok: false, code: "key_rejected", message: rejectedKeyMessage(warmOutcome.status) };
    if (warmOutcome.kind === "ok" && warmOutcome.response.status === 504) {
      const billing = billingBlockMessage(warmOutcome.response.payload);
      if (billing) return { ok: false, code: "failed", message: billing };
    }

    // The client API host depends on the region the account was deployed to;
    // fall back to the known hosts when the region is unknown.
    const hosts =
      region && CLIENT_API_HOSTS[region]
        ? [CLIENT_API_HOSTS[region]]
        : Object.values(CLIENT_API_HOSTS);
    let lastMessage =
      "Your robot is starting — the broker connection is still opening for your account. Execute retries automatically until it opens.";
    for (const host of hosts) {
      const outcome = await withMasterToken(async (token) =>
        fetchJson(
          `${host}/users/current/accounts/${encodeURIComponent(data.accountId)}/trade`,
          {
            method: "POST",
            headers: {
              "auth-token": token,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
          },
          40_000,
        ),
      );
      if (outcome.kind === "missing")
        return { ok: false, code: "key_missing", message: missingKeyMessage() };
      if (outcome.kind === "rejected")
        return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

      const { status, payload } = outcome.response;
      if (status >= 200 && status < 300) {
        const result = payload as
          | { stringCode?: string; message?: string; orderId?: string; positionId?: string }
          | undefined;
        const accepted =
          result?.stringCode === "TRADE_RETCODE_DONE" ||
          result?.stringCode === "TRADE_RETCODE_PLACED";
        if (result?.stringCode && !accepted) {
          // The broker itself rejected the order (market closed, invalid
          // stops, not enough money…) — surface its real reason.
          const humanized = result.stringCode
            .replace(/^TRADE_RETCODE_/, "")
            .replace(/_/g, " ")
            .toLowerCase();
          lastMessage =
            result.message && result.message !== "Request rejected"
              ? `Broker rejected the order: ${result.message}`
              : `Broker rejected the order (${humanized}).`;
          break;
        }
        return {
          ok: true,
          message: `${data.direction} ${volume} ${data.symbol} executed`,
          ...(result?.orderId || result?.positionId
            ? { orderId: result.orderId ?? result.positionId }
            : {}),
        };
      }
      if (status === 504 || status === 0) continue; // connection went cold — try the next host
      if (status === 404) {
        lastMessage =
          "The trading endpoint is not available for this account — reconnect your MT5 account on the MetaTrader page.";
        break;
      }
      lastMessage = maError(payload) || `Order rejected (HTTP ${status}).`;
      break;
    }
    return { ok: false, code: "failed", message: lastMessage };
  });

/* ------------------------------------------------------------------ */
/* Market analysis — real candles → indicators → signal with SL/TP    */
/* ------------------------------------------------------------------ */

export type ScannerAnalysisRequest = {
  accountId: string;
  symbol: string;
  /** Higher timeframe for trend (e.g. "1h"); "15m"/"5m" for the entry leg. */
  timeframe?: string;
  region?: string;
};

export type ScannerAnalysis = {
  symbol: string;
  timeframe: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  signal: "BUY" | "SELL" | "NO TRADE";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  /** True only when the scan has a live bid/ask snapshot and can be executed. */
  executionReady: boolean;
  atr: number;
  rsi: number;
  /** Human-readable reasons behind the signal, newest thinking last. */
  reasons: string[];
  /** Structured scan log lines (shown as the narrated steps). */
  readouts: { label: string; value: string; bullish: boolean | null }[];
};

function buildUnavailableScannerAnalysis(
  symbol: string,
  timeframe: string,
  reason: string,
): ScannerAnalysis {
  return {
    symbol,
    timeframe,
    bias: "NEUTRAL",
    signal: "NO TRADE",
    confidence: 0,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: "—",
    executionReady: false,
    atr: 0,
    rsi: 50,
    reasons: [
      reason,
      "No conditional setup can be calculated until the broker returns candle history.",
    ],
    readouts: [
      { label: "Market data", value: "Unavailable", bullish: null },
      { label: "Live price", value: "—", bullish: null },
      { label: "Signal", value: "NO TRADE", bullish: null },
    ],
  };
}

type Candle = { time: string; open: number; high: number; low: number; close: number };

/** EMA over closing prices (seeded with an SMA for stability). */
function ema(values: number[], period: number): number {
  if (values.length < period) return values.at(-1) ?? 0;
  const k = 2 / (period + 1);
  let running = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1)
    running = (values[index] ?? running) * k + running * (1 - k);
  return running;
}

/** Wilder's RSI. */
function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const previous = closes[index - 1] ?? 0;
    const change = (closes[index] ?? previous) - previous;
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const previous = closes[index - 1] ?? 0;
    const change = (closes[index] ?? previous) - previous;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Average True Range — volatility in price units. */
function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1]?.close;
    if (!current || previousClose === undefined) continue;
    trs.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
      ),
    );
  }
  const slice = trs.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

/** Most recent swing high/low over a lookback window. */
function swings(candles: Candle[], lookback = 20): { high: number; low: number } {
  const slice = candles.slice(-lookback);
  return {
    high: slice.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY),
    low: slice.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY),
  };
}

function roundToTick(price: number, reference: number): number {
  const magnitude = Math.abs(reference);
  const decimals = magnitude >= 1000 ? 2 : magnitude >= 10 ? 3 : magnitude >= 1 ? 4 : 5;
  const factor = 10 ** decimals;
  return Math.round(price * factor) / factor;
}

/* ── Public feed fallback ────────────────────────────────────────────
   The broker's market-data API only answers while MetaApi's cloud terminal
   is attached to the broker. When it isn't (cold/offline terminal), the
   scanner still needs a factual price reference — these helpers read real
   candles from a free public chart feed via a symbol mapping. */

const PUBLIC_SYMBOL_RULES: [RegExp, string][] = [
  [/^(XAU|GOLD)/, "GC=F"],
  [/^(XAG|SILVER)/, "SI=F"],
  [/^(XPT|PLATIN)/, "PL=F"],
  [/^(XPD|PALLAD)/, "PA=F"],
  [/WTI|USOIL|USCRUDE|XTIUSD|CRUDE/, "CL=F"],
  [/BRENT|UKOIL|UKCRUDE|XTBUSD/, "BZ=F"],
  [/NATGAS|NATURALGAS|NGAS/, "NG=F"],
  [/NAS100|USTEC|US100|USTECH|NDX100|NQ100|TECH100|HW100|^100$/, "NQ=F"],
  [/US30|DJ30|DOW30|WALLSTREET|WS30|^DOW$|^30$/, "YM=F"],
  [/US500|SPX500|SP500|GSPC|^SPX$|^500$/, "ES=F"],
  [/GER40|GER30|GERMANY40|GERMANY30|DAX40|DAX30|DE40|^DAX$/, "^GDAXI"],
  [/UK100|FTSE100|^FTSE$/, "^FTSE"],
  [/JP225|JPN225|NIKKEI225|JAPAN225|^NIKKEI$/, "^N225"],
  [/HK50|HANGSENG|^HSI$/, "^HSI"],
  [/AUS200|ASX200/, "^AXJO"],
  [/EU50|EURO50|STOXX50/, "^STOXX50E"],
  [/BTC|XBT/, "BTC-USD"],
  [/ETH/, "ETH-USD"],
  [/SOL/, "SOL-USD"],
  [/XRP/, "XRP-USD"],
  [/DOGE/, "DOGE-USD"],
  [/ADA/, "ADA-USD"],
];

const FX_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "CNH", "SEK",
  "NOK", "TRY", "ZAR", "MXN", "SGD", "HKD", "PLN",
]);

/** Maps a broker symbol (HW_100, XAUUSD.pro, BTCUSD.m, EURUSD…) to a public ticker. */
function publicSymbolFor(raw: string): string | undefined {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return undefined;
  for (const [pattern, ticker] of PUBLIC_SYMBOL_RULES) {
    if (pattern.test(cleaned)) return ticker;
  }
  if (FX_CURRENCIES.has(cleaned.slice(0, 3)) && FX_CURRENCIES.has(cleaned.slice(3)))
    return `${cleaned}=X`;
  return undefined;
}

/** Yahoo chart intervals (no native 4h — the 1h series is aggregated instead). */
function publicTimeframe(timeframe: string): { interval: string; range: string; agg: number } {
  switch (timeframe) {
    case "5m":
      return { interval: "5m", range: "5d", agg: 1 };
    case "15m":
      return { interval: "15m", range: "1mo", agg: 1 };
    case "4h":
      return { interval: "1h", range: "6mo", agg: 4 };
    case "1d":
      return { interval: "1d", range: "2y", agg: 1 };
    default:
      return { interval: "1h", range: "3mo", agg: 1 };
  }
}

function aggregateCandles(source: Candle[], group: number): Candle[] {
  if (group <= 1) return source;
  const merged: Candle[] = [];
  for (let start = source.length % group; start + group <= source.length; start += group) {
    const chunk = source.slice(start, start + group);
    merged.push({
      time: chunk[0]?.time ?? "",
      open: chunk[0]?.open ?? 0,
      high: Math.max(...chunk.map((candle) => candle.high)),
      low: Math.min(...chunk.map((candle) => candle.low)),
      close: chunk.at(-1)?.close ?? 0,
    });
  }
  return merged;
}

/** Fetches real candles for a symbol from the public chart feed. */
async function fetchPublicCandles(symbol: string, timeframe: string): Promise<Candle[]> {
  const publicSymbol = publicSymbolFor(symbol);
  if (!publicSymbol) return [];
  const { interval, range, agg } = publicTimeframe(timeframe);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(publicSymbol)}?interval=${interval}&range=${range}`,
        {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6_000),
        },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        chart?: {
          result?: {
            timestamp?: number[];
            indicators?: {
              quote?: {
                open?: (number | null)[];
                high?: (number | null)[];
                low?: (number | null)[];
                close?: (number | null)[];
              }[];
            };
          }[];
        };
      };
      const result = payload.chart?.result?.[0];
      const stamps = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0];
      if (!quote || stamps.length === 0) continue;
      const candles: Candle[] = [];
      for (let index = 0; index < stamps.length; index += 1) {
        const stamp = stamps[index];
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        if (stamp === undefined) continue;
        if (open == null || high == null || low == null || close == null) continue;
        candles.push({ time: new Date(stamp * 1000).toISOString(), open, high, low, close });
      }
      return aggregateCandles(candles, agg).slice(-120);
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Analyzes real market data for a symbol using the connected MT5 account:
 * trend (EMA21/50), momentum (RSI14), volatility (ATR14) and swing structure
 * → direction, entry at market, SL beyond the recent swing, TP at ≥2R.
 */
export const getScannerAnalysis = createServerFn({ method: "POST" })
  .validator((data: ScannerAnalysisRequest) => data)
  .handler(async ({ data }): Promise<{ ok: true; analysis: ScannerAnalysis } | MtFailure> => {
    if (!data.accountId)
      return {
        ok: false,
        code: "failed",
        message: "No connected MT5 account. Link your account on the MetaTrader page first.",
      };
    const symbol = data.symbol.trim().toUpperCase();
    const timeframe = data.timeframe ?? "1h";

    // Resolve region + make sure the terminal is up.
    let region = data.region;
    const detail = await withMasterToken((token) =>
      maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`),
    );
    if (detail.kind === "missing")
      return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (detail.kind === "rejected")
      return { ok: false, code: "key_rejected", message: rejectedKeyMessage(detail.status) };
    if (detail.kind === "ok" && detail.response.status === 200) {
      const account = detail.response.payload as MaAccount | undefined;
      region = account?.region ?? region;
      if (account && account.state !== "DEPLOYED") {
        await withMasterToken((token) =>
          maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}/deploy`, {
            method: "POST",
          }),
        );
      }
    }

    const hosts =
      region && CLIENT_API_HOSTS[region]
        ? [CLIENT_API_HOSTS[region]]
        : Object.values(CLIENT_API_HOSTS);
    const regions =
      region && CLIENT_API_HOSTS[region] ? [region] : Object.keys(CLIENT_API_HOSTS);

    // Start the historical read alongside the live snapshot. History improves
    // the indicators but must never make a live signal wait on a cold endpoint.
    const historyPromise = (async (): Promise<Candle[]> => {
      const deadline = new Promise<Candle[]>((resolve) => setTimeout(() => resolve([]), 3_000));
      const request = (async (): Promise<Candle[]> => {
        for (const accountRegion of regions) {
          const historyResult = await withMasterToken((token) =>
            fetchJson(
              `https://mt-market-data-client-api-v1.${accountRegion}.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(data.accountId)}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${timeframe}/candles?limit=120`,
              { headers: { "auth-token": token, Accept: "application/json" } },
              5_000,
            ),
          );
          if (
            historyResult.kind === "ok" &&
            historyResult.response.status === 200 &&
            Array.isArray(historyResult.response.payload)
          ) {
            return historyResult.response.payload as Candle[];
          }
        }
        return [];
      })();
      return Promise.race([request, deadline]);
    })();

    // A live bid/ask is preferred for an executable setup. When a symbol is
    // available but its session is closed (common on Saturday/Sunday), use the
    // latest broker candle as a clearly conditional reference instead of
    // returning a blank result.
    const readMarketSnapshot = async () => {
      let price: { bid: number; ask: number } | undefined;
      for (const host of hosts) {
        const priceResult = await withMasterToken((token) =>
          fetchJson(
            `${host}/users/current/accounts/${encodeURIComponent(data.accountId)}/symbols/${encodeURIComponent(symbol)}/current-price?keepSubscription=true`,
            { headers: { "auth-token": token, Accept: "application/json" } },
            3_500,
          ),
        );
        if (priceResult.kind === "ok" && priceResult.response.status === 200) {
          const raw = priceResult.response.payload as { bid?: number; ask?: number } | undefined;
          if (raw?.bid && raw?.ask) price = { bid: raw.bid, ask: raw.ask };
        }
        if (price) break;
      }
      return { price };
    };

    // Warm-up is only a fallback. Connected accounts get a signal from the
    // fast path immediately; cold accounts still receive a bounded retry.
    const { price } = await readMarketSnapshot();
    let candles = await historyPromise;
    let usedPublicFeed = false;

    // When the broker returns neither a quote nor candle history (offline
    // cloud terminal), read the public market feed so the scanner always has
    // a factual reference to analyze instead of a dead end.
    let lastCandle = candles.at(-1);
    let referenceClose = price?.bid ?? lastCandle?.close ?? 0;
    if (!referenceClose || !Number.isFinite(referenceClose)) {
      const publicCandles = await fetchPublicCandles(symbol, timeframe);
      if (publicCandles.length > 0) {
        candles = publicCandles;
        usedPublicFeed = true;
        lastCandle = publicCandles.at(-1);
        referenceClose = lastCandle?.close ?? 0;
      }
    }
    if (!referenceClose || !Number.isFinite(referenceClose)) {
      return {
        ok: true,
        analysis: buildUnavailableScannerAnalysis(
          symbol,
          timeframe,
          `No market data is available for ${symbol} — the broker terminal is offline and the public feed has no data for this symbol name. Try a standard symbol like EURUSD, XAUUSD, US100 or BTCUSD.`,
        ),
      };
    }

    const hasLiveQuote = Boolean(price);
    // Use the live bid for the decision when available. On a closed session,
    // use the latest broker candle close and mark the result conditional.
    const close = referenceClose;
    const bid = price?.bid ?? close;
    const ask = price?.ask ?? close;
    const closes = candles.map((item) => item.close);
    const ema21 = closes.length >= 21 ? ema(closes, 21) : close;
    const ema50 = closes.length >= 50 ? ema(closes, 50) : close;
    const rsiValue = closes.length >= 15 ? rsi(closes) : 50;
    const atrValue =
      candles.length >= 15
        ? Math.max(atr(candles), close * 0.0015, 0.0001)
        : Math.max(close * 0.0015, 0.0001);
    const swing =
      candles.length >= 20
        ? swings(candles)
        : { high: close + atrValue * 2, low: close - atrValue * 2 };

    const trendUp = ema21 > ema50;
    const trendStrength = Math.abs(ema21 - ema50);
    const trendFactor = Math.min(trendStrength / (atrValue || 1e-9), 1);
    const priceAboveEma = close > ema21;
    const rsiBull = rsiValue > 52;
    const rsiBear = rsiValue < 48;

    // Score in [-3, +3]: trend ×2, price vs EMA, RSI momentum.
    let score = 0;
    score += (trendUp ? 2 : -2) * (0.5 + 0.5 * trendFactor);
    score += priceAboveEma ? 0.75 : -0.75;
    score += rsiValue >= 50 ? (rsiBull ? 0.6 : 0.2) : rsiBear ? -0.6 : -0.2;

    const initialBias: ScannerAnalysis["bias"] =
      score > 0.6 ? "BULLISH" : score < -0.6 ? "BEARISH" : "NEUTRAL";
    const initialSignal: ScannerAnalysis["signal"] =
      initialBias === "NEUTRAL"
        ? "NO TRADE"
        : trendUp === priceAboveEma || Math.abs(score) >= 1.5
          ? score > 0
            ? "BUY"
            : "SELL"
          : "NO TRADE";

    // A scanner result must still give the trader a directional plan when
    // candle history exists. If the normal high-probability filter is neutral,
    // use a deterministic directional tie-breaker rather than inventing a
    // price: score, price-vs-EMA, then the latest candle body.
    const candleBullish = lastCandle ? lastCandle.close >= lastCandle.open : trendUp;
    const fallbackSignal: "BUY" | "SELL" =
      score > 0
        ? "BUY"
        : score < 0
          ? "SELL"
          : priceAboveEma
            ? "BUY"
            : candleBullish
              ? "BUY"
              : "SELL";
    const signal: ScannerAnalysis["signal"] =
      initialSignal === "NO TRADE" ? fallbackSignal : initialSignal;
    const bias: ScannerAnalysis["bias"] = signal === "BUY" ? "BULLISH" : "BEARISH";
    const conditionalSetup = initialSignal === "NO TRADE" || !hasLiveQuote;

    const confidenceBase = Math.round(Math.min(95, Math.max(55, 55 + Math.abs(score) * 14)));
    const confidence = conditionalSetup ? Math.min(52, confidenceBase) : confidenceBase;
    const entry = signal === "BUY" ? ask : bid;
    // SL beyond the recent swing (buffered by 0.5 ATR), TP at ≥2R.
    const direction = signal === "SELL" ? -1 : 1;
    const swingStop = signal === "SELL" ? swing.high + atrValue * 0.5 : swing.low - atrValue * 0.5;
    const atrStop = entry - direction * atrValue * 1.5;
    const stopLoss =
      signal === "SELL" ? Math.max(swingStop, atrStop) : Math.min(swingStop, atrStop);
    const risk = Math.abs(entry - stopLoss);
    const takeProfit = entry + direction * risk * 2;

    const reasons: string[] = [];
    if (!hasLiveQuote) {
      reasons.push(
        usedPublicFeed
          ? `The broker terminal is offline, so candles came from the public market feed for ${symbol}. This conditional plan is ready to execute the moment the broker reconnects.`
          : `No current bid/ask is available for ${symbol}; this is a conditional setup from the latest broker candle and is not executable yet.`,
      );
    }
    if (candles.length >= 50) {
      reasons.push(
        `EMA21 is ${ema21 > ema50 ? "above" : "below"} EMA50 — ${trendUp ? "uptrend" : "downtrend"} structure on ${timeframe}.`,
      );
      reasons.push(
        `RSI(14) at ${rsiValue.toFixed(1)} — ${rsiValue > 60 ? "strong bullish momentum" : rsiValue > 52 ? "mild bullish momentum" : rsiValue < 40 ? "strong bearish momentum" : rsiValue < 48 ? "mild bearish momentum" : "momentum neutral"}.`,
      );
      reasons.push(
        `Price ${close > ema21 ? "holding above" : "trading below"} the EMA21 dynamic level.`,
      );
      if (conditionalSetup) {
        reasons.push(
          `ATR(14) ${atrValue.toFixed(Math.abs(close) >= 100 ? 2 : 5)} — levels are provided for planning; wait for a live quote before execution.`,
        );
      } else {
        reasons.push(
          `ATR(14) ${atrValue.toFixed(Math.abs(close) >= 100 ? 2 : 5)} — stop placed ${signal === "SELL" ? "above" : "below"} the recent swing with a 0.5 ATR buffer, target at 2R.`,
        );
      }
    } else {
      reasons.push(
        `Limited history for ${symbol} — levels are built from live price and ATR fallbacks.`,
      );
    }
    if (initialSignal === "NO TRADE") {
      reasons.push(
        `The standard filter was neutral, so direction was selected from ${score !== 0 ? "the indicator score" : "price structure"} to provide a conditional plan.`,
      );
    }

    const fmt = (value: number) =>
      value.toFixed(Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 10 ? 3 : 5);
    const readouts: ScannerAnalysis["readouts"] = [
      {
        label: "Trend (EMA 21/50)",
        value: trendUp ? "Up · Bullish" : "Down · Bearish",
        bullish: candles.length >= 50 ? trendUp : null,
      },
      {
        label: "Momentum (RSI 14)",
        value:
          closes.length >= 15
            ? `${rsiValue.toFixed(1)} ${rsiValue > 52 ? "· Bullish" : rsiValue < 48 ? "· Bearish" : "· Neutral"}`
            : "n/a",
        bullish: closes.length >= 15 ? (rsiValue > 52 ? true : rsiValue < 48 ? false : null) : null,
      },
      { label: "Volatility (ATR 14)", value: fmt(atrValue), bullish: null },
      {
        label: "Swing range (20 bars)",
        value: `${fmt(swing.low)} — ${fmt(swing.high)}`,
        bullish: null,
      },
      {
        label: hasLiveQuote
          ? "Live price (bid/ask)"
          : usedPublicFeed
            ? "Public feed close"
            : "Reference price (last close)",
        value: hasLiveQuote ? `${fmt(bid)} / ${fmt(ask)}` : fmt(close),
        bullish: null,
      },
      {
        label: "Signal",
        value: `${signal}${conditionalSetup ? " · CONDITIONAL" : ""}`,
        bullish: signal === "BUY",
      },
    ];

    return {
      ok: true,
      analysis: {
        symbol,
        timeframe,
        bias,
        signal,
        confidence,
        entry: roundToTick(entry, entry),
        stopLoss: roundToTick(stopLoss, entry),
        takeProfit: roundToTick(takeProfit, entry),
        riskReward: "1:2",
        executionReady: hasLiveQuote,
        atr: atrValue,
        rsi: rsiValue,
        reasons,
        readouts,
      },
    };
  });
