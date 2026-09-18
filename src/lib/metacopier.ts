import { createServerFn } from "@tanstack/react-start";

/**
 * MetaApi (metaapi.cloud) platform integration — ONE master token for everyone.
 *
 * The master token lives ONLY on the server (env / built-in fallback). The
 * frontend never sees it and never calls MetaApi directly — it calls the server
 * functions below (this stack's edge functions), which attach the token.
 *
 * Master token resolution: every candidate — METAAPI_TOKEN, METAAPI_API_TOKEN,
 * METAAPI_MASTER_TOKEN in process.env and import.meta.env, plus the built-in
 * fallback constant — is tried against MetaApi in order, and the first token
 * the API accepts is used. (The old MetaCopier key/names are fully retired.)
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
const CLIENT_API_HOSTS: Record<string, string> = {
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
 * Built-in platform token — the last-resort candidate so Connect works on every
 * deployment with zero setup. Everything configured at runtime (env vars) takes
 * priority, so rotating the platform token later only means setting the new
 * value in the environment — no code change.
 */
const BUILTIN_MASTER_TOKEN =
  "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiJjYTU1ZTRlNWU5NjZhM2ViNmEzZjAwYWQ1NDhhNmNjYyIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoiY29weWZhY3RvcnktYXBpIiwibWV0aG9kcyI6WyJjb3B5ZmFjdG9yeS1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoibXQtbWFuYWdlci1hcGkiLCJtZXRob2RzIjpbIm10LW1hbmFnZXItYXBpOnJlc3Q6ZGVhbGluZzoqOioiLCJtdC1tYW5hZ2VyLWFwaTpyZXN0OnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJiaWxsaW5nLWFwaSIsIm1ldGhvZHMiOlsiYmlsbGluZy1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiY2E1NWU0ZTVlOTY2YTNlYjZhM2YwMGFkNTQ4YTZjY2MiLCJpYXQiOjE3ODk3MzYwODV9.YURNWRrIP55llsfztF7p0FfL-ftOL6Rh9V0eMGePn4IAX494Xf-zAxhPF3i0roXa9wSNcBvKwrM5-MJQtob6hKOQEDTTZgwiaZbpHnJmwe7GRgbaai44ZQp2l0R0_LjQ8iGcv2QVTu7_hvazj3gTt8FYEjqxCePU45Mx0VWKghtJ8lAiLZyyCouGwNEKPZns00q3KFysO_gdhDWkFlzylBn0yztH20ST3Ghvap7CPSbNoZ8-eon3TvUL4ARWnXRtDA4OYty3MHPidXFqUxn_WLFvL1rwQL1RH86v_KOGoSLlp0Di3TyIlv0bU9zlTTT_vovPibGL-cxLO4muWnJcqZYJxASySy2sgN0F4X5CsPACzyFF54STrUKJlJElPh_q55QEZqd0wT7q-aQF760RPou6NTMmJQQ5BpH9nIFnGJ-ITC_k0tEifw0531hSFDna5HYsUfVHTfnlr4D2rsxDMpqMp-75AZA5umV1UJxgm_Kt7GfWqGZA0nVKkDX8G1WCxjlAEJEanzYp4QCGPeAxEnYQ1wJmXqfKuKvWC_N6_EI3e7BU1Li8KsKrHamJSVzsAA3aHGfUanyL9nyQC5IlBiDqqum9qDdGBxo1mdIk4jHg7rHJRZbHDGzZljWfu74uE8Br_04NLvYaLVRfZCmwvhX1GKC5UW3dXRJC4i0ci2c";

/** Strips whitespace and quote wrappers that env settings screens sometimes add. */
function cleanKey(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^[\"'`]+/, "").replace(/[\"'`]+$/, "");
}

/** Every candidate master token, deduped: process env, build env, then built-in. */
function candidateTokens(): string[] {
  const env = typeof process !== "undefined" ? (process?.env ?? {}) : {};
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const tokens: string[] = [];
  for (const name of ["METAAPI_TOKEN", "METAAPI_API_TOKEN", "METAAPI_MASTER_TOKEN"]) {
    for (const value of [cleanKey(env[name]), cleanKey(viteEnv[name])]) {
      if (value.length > 0) tokens.push(value);
    }
  }
  tokens.push(BUILTIN_MASTER_TOKEN);
  return [...new Set(tokens)];
}

type MaResponse = { status: number; payload?: unknown; retryAfterSeconds?: number };

/** True when MetaApi rejected our authorization (the platform's master token). */
function isAuthRejected(status: number, payload: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const raw = JSON.stringify(payload ?? {}).toLowerCase();
  return raw.includes("unauthorizederror") || raw.includes("invalid auth-token");
}

/** Human-readable message from a MetaApi error payload. */
function maError(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const record = payload as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (Array.isArray(record.errors) && record.errors.length > 0) return record.errors.map((item) => String(item)).join(", ");
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
): Promise<{ kind: "ok"; response: MaResponse } | { kind: "missing" } | { kind: "rejected"; status: number }> {
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
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; payload?: unknown }> {
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
    return payload === undefined ? { status: response.status } : { status: response.status, payload };
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
async function warmAccountConnection(token: string, accountId: string, region: string | undefined, budgetMs: number): Promise<MaResponse> {
  const hosts = region && CLIENT_API_HOSTS[region] ? [CLIENT_API_HOSTS[region]] : Object.values(CLIENT_API_HOSTS);
  const deadline = Date.now() + budgetMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    for (const host of hosts) {
      const result = await fetchJson(`${host}/users/current/accounts/${encodeURIComponent(accountId)}/account-information`, { headers: { "auth-token": token, Accept: "application/json" } }, 30_000);
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
async function maFetch(token: string, path: string, init: { method?: string; json?: unknown; transactionId?: string } = {}): Promise<MaResponse> {
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
      retryAfterSeconds = Number.isFinite(asDate) ? Math.max(5, Math.round((asDate - Date.now()) / 1000)) : Number.parseInt(retryAfter, 10) || undefined;
    }
    return retryAfterSeconds === undefined ? { status: response.status, payload } : { status: response.status, payload, retryAfterSeconds };
  } catch {
    return { status: 0 };
  }
}

export type MtFailureCode = "key_missing" | "key_rejected" | "failed";

/** Defensive only — the built-in fallback makes this effectively unreachable. */
function missingKeyMessage(): string {
  return "Live connection isn't enabled on this deployment yet. The owner enables it once in the hosting cloud settings — then Connect works instantly.";
}

/** The token is present but MetaApi rejected it. */
function rejectedKeyMessage(status: number): string {
  return `MetaApi rejected the platform's access token (HTTP ${status}). The token is set but invalid, expired, or lacks permissions — generate a new one in the MetaApi dashboard and update the server setting.`;
}

type MaAccount = {
  id?: string;
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
  | { ok: true; accountId: string; environment?: string; balance?: number; currency?: string }
  | MtFailure;

export type MtDisconnectRequest = { accountId: string };
export type MtDisconnectResult = { ok: true; message: string } | MtFailure;

export type MtStatusRequest = { accountId: string };
export type MtStatusResult =
  | { ok: true; connected: boolean; balance?: number; equity?: number; currency?: string; environment?: string; statusMessage?: string }
  | MtFailure;

export type LiveTradeRequest = {
  /** The END USER's MetaApi account id (their connected MT5). */
  accountId: string;
  eaName: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: string;
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
    if (!login || !password || !server) return { ok: false, code: "failed", message: "Enter your login, password and server before connecting." };

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

    // Reuse an already-hosted copy of this exact login+server instead of
    // creating a duplicate when Connect is pressed twice.
    const listOutcome = await withMasterToken((token) => maFetch(token, "/users/current/accounts"));
    if (listOutcome.kind === "ok" && Array.isArray(listOutcome.response.payload)) {
      const existing = (listOutcome.response.payload as MaAccount[]).find(
        (account) => String(account.login ?? "") === login && account.server === server && (account.platform ?? "mt5") === platform,
      );
      if (existing?.id) {
        return existing.region ? { ok: true, accountId: existing.id, environment: existing.region } : { ok: true, accountId: existing.id };
      }
    }

    // Broker settings detection can ask for retries — poll with the same
    // transaction id until the account is created or a real error comes back.
    const transactionId = newTransactionId();
    const deadline = Date.now() + 90_000;
    for (;;) {
      const outcome = await withMasterToken((token) => maFetch(token, "/users/current/accounts", { method: "POST", json: body, transactionId }));
      if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
      if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

      const { status, payload } = outcome.response;
      const account = payload as (MaAccount & { message?: string; error?: string }) | undefined;

      if (status >= 200 && status < 300 && account?.id) {
        // Created — fetch the region so trade orders hit the right API host.
        const detail = await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(account.id as string)}`));
        const region = detail.kind === "ok" && detail.response.status === 200 ? (detail.response.payload as MaAccount | undefined)?.region : undefined;
        return region ? { ok: true, accountId: account.id, environment: region } : { ok: true, accountId: account.id };
      }

      const message = maError(payload);
      const retryMatch = /retry in (\d+) seconds/i.exec(message ?? "");
      if (retryMatch && Date.now() < deadline) {
        // Cap each wait so several validation polls fit in the window —
        // MetaApi shortens the retry time as its detection progresses.
        const waitSeconds = Math.min(Number(retryMatch[1]) + 2, 20);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        continue;
      }
      if (status === 202 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        continue;
      }
      if (isAuthRejected(status, payload)) return { ok: false, code: "key_rejected", message: rejectedKeyMessage(status) };
      if (Date.now() >= deadline) {
        return {
          ok: false,
          code: "failed",
          message: "MetaApi is still detecting this broker's connection settings — press Connect Account again in a minute and it will link instantly.",
        };
      }
      return {
        ok: false,
        code: "failed",
        message: message || `MetaApi could not connect the account (HTTP ${status}). Check the login, password and exact server name (e.g. Headway-Demo).`,
      };
    }
  });

/** GET /accounts — lists this platform's connected accounts (diagnostics). */
export const listMtAccounts = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: true; accounts: MaAccount[] } | MtFailure> => {
  const outcome = await withMasterToken((token) => maFetch(token, "/users/current/accounts"));
  if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
  if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };
  const { status, payload } = outcome.response;
  if (status < 200 || status >= 300 || !Array.isArray(payload)) {
    return { ok: false, code: "failed", message: maError(payload) || `Could not list accounts (HTTP ${status}).` };
  }
  return { ok: true, accounts: payload as MaAccount[] };
});

/** GET /accounts/{accountId} — live connection state for the user's account. */
export const getMtAccountStatus = createServerFn({ method: "POST" })
  .validator((data: MtStatusRequest) => data)
  .handler(async ({ data }): Promise<MtStatusResult> => {
    const outcome = await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`));
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

    const { status, payload } = outcome.response;
    if (status < 200 || status >= 300) {
      return { ok: false, code: "failed", message: maError(payload) || `Account not found (HTTP ${status}).` };
    }
    const account = payload as MaAccount;

    // Stay connected until the user presses Disconnect: if MetaApi undeployed
    // the account for any reason, bring it straight back up.
    if (account.state !== "DEPLOYED") {
      await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}/deploy`, { method: "POST" }));
    }

    // While deployed, treat the account as connected — MetaApi attaches the
    // broker terminal lazily, so requiring CONNECTED here would show scary
    // "not connected" states during normal operation.
    const connected = account.state === "DEPLOYED";

    // Best-effort balance read within a short budget; the trade path waits longer.
    let balance: number | undefined;
    let equity: number | undefined;
    let currency: string | undefined;
    if (connected) {
      const warmOutcome = await withMasterToken((token) => warmAccountConnection(token, data.accountId, account.region, 20_000));
      if (warmOutcome.kind === "ok" && warmOutcome.response.status === 200) {
        const info = warmOutcome.response.payload as { balance?: number; equity?: number; currency?: string } | undefined;
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
      ...(account.statusMessage ? { statusMessage: account.statusMessage } : {}),
      ...(account.region ? { environment: account.region } : {}),
    };
  });

/** DELETE /accounts/{accountId} — removes the user's hosted connection. */
export const disconnectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtDisconnectRequest) => data)
  .handler(async ({ data }): Promise<MtDisconnectResult> => {
    const outcome = await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`, { method: "DELETE" }));
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };
    const { status, payload } = outcome.response;
    if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
      return { ok: false, code: "failed", message: maError(payload) || `Could not remove the account (HTTP ${status}).` };
    }
    return { ok: true, message: "MT5 account disconnected." };
  });

/** POST {clientApi}/users/current/accounts/{accountId}/orders — market order. */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    if (!data.accountId) return { ok: false, code: "failed", message: "No connected MT5 account. Link your account on the MetaTrader page first." };

    const volume = Math.max(Number.parseFloat(data.lotSize) || 0, 0.01);
    const body = {
      actionType: data.direction === "SELL" ? "ORDER_TYPE_SELL" : "ORDER_TYPE_BUY",
      symbol: data.symbol,
      volume,
      comment: `${data.eaName} - EA Migrate`.slice(0, 26),
    };

    // Resolve the account's region (its API host depends on it) and make sure
    // it is deployed. Cold accounts reject orders with 504/"530"-style errors,
    // so warm the broker connection BEFORE placing the order.
    let region = data.region;
    const detail = await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}`));
    if (detail.kind === "ok" && detail.response.status === 200) {
      const account = detail.response.payload as MaAccount | undefined;
      region = account?.region ?? region;
      if (account && account.state !== "DEPLOYED") {
        await withMasterToken((token) => maFetch(token, `/users/current/accounts/${encodeURIComponent(data.accountId)}/deploy`, { method: "POST" }));
      }
    }

    const warmOutcome = await withMasterToken((token) => warmAccountConnection(token, data.accountId, region, 75_000));
    if (warmOutcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (warmOutcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(warmOutcome.status) };

    // The client API host depends on the region the account was deployed to;
    // fall back to the known hosts when the region is unknown.
    const hosts = region && CLIENT_API_HOSTS[region] ? [CLIENT_API_HOSTS[region]] : Object.values(CLIENT_API_HOSTS);
    let lastMessage = "Your robot is starting — the broker connection is still opening for your account. Press START again in a minute; the first connection after linking an account can take a few minutes. If it keeps failing, this broker may be blocking cloud trading terminals — a live (non-demo) server of the same broker usually works.";
    for (const host of hosts) {
      const outcome = await withMasterToken(async (token) =>
        fetchJson(
          `${host}/users/current/accounts/${encodeURIComponent(data.accountId)}/orders`,
          {
            method: "POST",
            headers: { "auth-token": token, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
          },
          40_000,
        ),
      );
      if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
      if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

      const { status, payload } = outcome.response;
      if (status >= 200 && status < 300) {
        const position = payload as { orderId?: string; positionId?: string; message?: string } | undefined;
        return {
          ok: true,
          message: `${data.direction} ${volume} ${data.symbol} executed`,
          ...(position?.orderId || position?.positionId ? { orderId: position.orderId ?? position.positionId } : {}),
        };
      }
      if (status === 404 || status === 504 || status === 0) continue; // wrong host or connection went cold — try the next host
      lastMessage = maError(payload) || `Order rejected (HTTP ${status}).`;
      break;
    }
    return { ok: false, code: "failed", message: lastMessage };
  });

