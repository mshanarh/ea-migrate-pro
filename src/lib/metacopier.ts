import { createServerFn } from "@tanstack/react-start";

/**
 * MetaCopier platform integration — ONE master API key for everyone.
 *
 * The master key lives ONLY on the server (env / cloud secret). The frontend
 * never sees it and never calls MetaCopier directly — it calls the server
 * functions below (this stack's edge functions), which attach the key.
 *
 * Master key resolution (server-side only): every candidate —
 * METACOPIER_MASTER_KEY, METACOPIER_API_KEY, EXECUTION_API_KEY (process.env
 * and import.meta.env) plus the cloud KV key eamp:secrets:metacopier — is
 * tried against MetaCopier in order, and the first key the API accepts is
 * used. A stale or half-pasted value under one name can no longer break the
 * flow when another name holds the working key.
 *
 * Auth compatibility: MetaCopier's documented auth header is "X-API-KEY";
 * some gateway deployments instead expect a standard "Authorization: Bearer
 * <key>" header. Both are sent — extra headers are ignored by servers that
 * don't need them.
 *
 * Endpoint: verified live — the base is https://api.metacopier.io/rest/api/v1
 * (the .io host; the old .com default is a dead nginx vhost, which is why every
 * connection attempt used to fail regardless of the key). METACOPIER_API_URL /
 * EXECUTION_API_URL can pin a custom host; {host}/api/v1 is tried as fallback.
 *
 * Verified against MetaCopier's official API (js-metacopier-api SDK):
 * - Create: POST {base}/accounts
 *   { type: {id: 1 = MT5}, loginAccountNumber, loginAccountPassword,
 *     loginServer, region: {id}, alias, closeUnmanagedPositions }
 * - Types/regions enums: GET /types/accountTypes, /types/regions
 * - List:   GET /accounts
 * - Delete: DELETE /accounts/{accountId}
 * - Execute: POST /accounts/{accountId}/positions
 *   { symbol, volume, orderType: "Buy"|"Sell", openPrice: 0 (market),
 *     stopLoss, takeProfit, requestId (0-999 dedupe), comment }
 */

const MC_TYPE_MT5 = 1;

const SECRETS_KV_KEY = "eamp:secrets:metacopier";

/** Strips whitespace and quote wrappers that env settings screens sometimes add. */
function cleanKey(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^["'`]+/, "").replace(/["'`]+$/, "");
}

/** Every candidate master key, deduped: process env, build env, then cloud KV. */
async function candidateKeys(): Promise<string[]> {
  const env = typeof process !== "undefined" ? (process?.env ?? {}) : {};
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const keys: string[] = [];
  for (const name of ["METACOPIER_MASTER_KEY", "METACOPIER_API_KEY", "EXECUTION_API_KEY"]) {
    for (const value of [cleanKey(env[name]), cleanKey(viteEnv[name])]) {
      if (value.length > 0) keys.push(value);
    }
  }
  const fromKv = await masterKeyFromKv();
  if (fromKv) keys.push(fromKv);
  return [...new Set(keys)];
}

/** Fallback: the admin can store the key in the cloud KV (GET eamp:secrets:metacopier). */
async function masterKeyFromKv(): Promise<string | null> {
  const env = typeof process !== "undefined" ? (process?.env ?? {}) : {};
  const url = cleanKey(env["UPSTASH_REDIS_REST_URL"] ?? env["KV_REST_API_URL"]);
  const token = cleanKey(env["UPSTASH_REDIS_REST_TOKEN"] ?? env["KV_REST_API_TOKEN"]);
  if (url.length === 0 || token.length === 0) return null;
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/get/${encodeURIComponent(SECRETS_KV_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: unknown };
    const key = cleanKey(typeof payload.result === "string" ? payload.result : null);
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

type McResponse = { status: number; payload?: unknown };

/** The candidate key MetaCopier last accepted — avoids re-probing every call. */
let workingKey: string | null = null;

/**
 * Runs `run` with the first candidate key MetaCopier accepts. Hosts often end
 * up with a stale or half-pasted value under one key name (a truncated key
 * authenticates as 401), so the first *present* key is not trusted — every
 * candidate is tried until one passes. 401/403 advance to the next candidate;
 * any other response is handed back to the caller untouched.
 */
async function withMasterKey(
  run: (apiKey: string) => Promise<McResponse>,
): Promise<{ kind: "ok"; response: McResponse } | { kind: "missing" } | { kind: "rejected"; status: number }> {
  const keys = await candidateKeys();
  if (keys.length === 0) return { kind: "missing" };
  if (workingKey && keys.includes(workingKey)) {
    const response = await run(workingKey);
    if (response.status !== 401 && response.status !== 403) return { kind: "ok", response };
    workingKey = null; // no longer accepted (rotated?) — re-probe all candidates
  }
  let lastStatus = 0;
  for (const key of keys) {
    const response = await run(key);
    if (response.status !== 401 && response.status !== 403) {
      workingKey = key;
      return { kind: "ok", response };
    }
    lastStatus = response.status || lastStatus;
  }
  return { kind: "rejected", status: lastStatus };
}

/** Resolves the MetaCopier REST root candidates, most-likely first. */
function apiRoots(): string[] {
  const configured = (process.env["METACOPIER_API_URL"] ?? process.env["EXECUTION_API_URL"] ?? "").trim().replace(/\/+$/, "");
  const host = configured
    ? configured.replace(/\/(rest\/api\/v1|api\/v1)$/, "")
    : "https://api.metacopier.io";
  const roots = [`${host}/rest/api/v1`, `${host}/api/v1`];
  // When the admin pinned a full path, try it first.
  if (/(rest\/api\/v1|api\/v1)$/.test(configured)) roots.unshift(configured);
  return [...new Set(roots)];
}

/** Headers for a MetaCopier call — both auth header styles for compatibility. */
function authHeaders(apiKey: string, json = false): Record<string, string> {
  return {
    "X-API-KEY": apiKey,
    Authorization: `Bearer ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** Runs a MetaCopier request across root variants; returns the first JSON response. */
async function mcFetch(apiKey: string, path: string, init: { method?: string; json?: unknown } = {}): Promise<{ status: number; payload?: unknown }> {
  const roots = apiRoots();
  let lastStatus = 0;
  for (const root of roots) {
    try {
      const response = await fetch(`${root}${path}`, {
        method: init.method ?? "GET",
        headers: authHeaders(apiKey, init.json !== undefined),
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        // Provider may return an empty body.
      }
      lastStatus = response.status;
      // A 404 on one URL variant means the path shape is wrong there — try the next root.
      if (response.status === 404 && roots.length > 1) continue;
      return { status: response.status, payload };
    } catch {
      // Network error — try the next root variant.
    }
  }
  return { status: lastStatus };
}

export type MtFailureCode = "key_missing" | "key_rejected" | "failed";

/** The admin never set the master key in this runtime. Short and clean — no env details. */
function missingKeyMessage(): string {
  return "Live connection isn't enabled on this deployment yet. The owner enables it once in the hosting cloud settings — then Connect works instantly.";
}

/** The key is present but MetaCopier rejected it. */
function rejectedKeyMessage(status: number): string {
  return `MetaCopier rejected the platform's API key (HTTP ${status}). The key is set but invalid, expired, or lacks access — verify it in the MetaCopier dashboard and update the server setting.`;
}

/** True only when MetaCopier rejected our authorization (admin's master key). */
function isAuthRejected(status: number, payload: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const raw = JSON.stringify(payload ?? {}).toLowerCase();
  return raw.includes("unauthorized") || raw.includes("forbidden") || raw.includes("api key") || raw.includes("apikey");
}

type McType = { id: number; name?: string };
type McRegion = { id: number; name?: string };

/** MetaCopier validation failures arrive as { errors: ["field -> reason", …] }. */
function mcErrors(payload: unknown): string | undefined {
  const raw = (payload as { errors?: unknown } | undefined)?.errors;
  if (Array.isArray(raw) && raw.length > 0) return raw.map((item) => String(item)).join(", ");
  return undefined;
}
type McAccount = {
  id?: string;
  alias?: string;
  loginAccountNumber?: string;
  loginServer?: string;
  status?: string;
  statusMessage?: string;
  accountInformation?: { connected?: boolean; environment?: string; wrongCredentials?: boolean; balance?: number; currency?: string; equity?: number };
};
type McPosition = { id?: string; message?: string; error?: string };

export type MtConnectRequest = {
  /** The user's own MT5 account number — any login works, nothing is hardcoded. */
  login: string;
  password: string;
  server: string;
  /** Shown in the MetaCopier dashboard, e.g. the app user's email. */
  alias?: string;
  /** MetaCopier region id. When omitted the first available region is used. */
  regionId?: number;
  /** The type the user picked in the app (Standard, ECN, Demo…) — stored, not sent to MetaCopier. */
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
  /** The END USER's MetaCopier account id (their connected MT5). */
  accountId: string;
  eaName: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: string;
};

export type LiveTradeResult = { ok: true; message: string; orderId?: string } | MtFailure;

/** Cached — the type/region enums don't change between connects. */
let mcTypesCache: { typeId: number; regionId?: number } | null = null;

/** GET /types/accountTypes + /types/regions, resolving MT5 and a default region. */
async function resolveMcTypes(apiKey: string): Promise<{ typeId: number; regionId?: number }> {
  if (mcTypesCache) return mcTypesCache;
  let typeId = MC_TYPE_MT5;
  try {
    const types = await mcFetch(apiKey, "/types/accountTypes");
    if (types.status >= 200 && types.status < 300 && Array.isArray(types.payload)) {
      const mt5 = (types.payload as McType[]).find((t) => t.name?.toUpperCase().includes("MT5"));
      if (mt5) typeId = mt5.id;
    }
  } catch {
    /* keep the documented default (1 = MT5) */
  }
  try {
    const regions = await mcFetch(apiKey, "/types/regions");
    if (regions.status >= 200 && regions.status < 300 && Array.isArray(regions.payload)) {
      const first = (regions.payload as McRegion[])[0];
      if (first) {
        mcTypesCache = { typeId, regionId: first.id };
        return mcTypesCache;
      }
    }
  } catch {
    /* fall through to the default region below */
  }
  // MetaCopier requires a region on create — default to the first listed one
  // (New York) if the lookup ever fails, instead of guaranteeing a 400.
  mcTypesCache = { typeId, regionId: 1 };
  return mcTypesCache;
}

/**
 * Connect the END USER's MT5 account under the platform's MetaCopier project.
 * Uses skipCredentialCheck: false so MetaCopier validates the credentials
 * immediately — a wrong login/server/password fails here, not later mid-trade.
 */
export const connectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtConnectRequest) => data)
  .handler(async ({ data }): Promise<MtConnectResult> => {
    const outcome = await withMasterKey(async (apiKey) => {
      const { typeId, regionId } = await resolveMcTypes(apiKey);
      const body: Record<string, unknown> = {
        type: { id: typeId },
        loginAccountNumber: data.login.trim(),
        loginAccountPassword: data.password,
        loginServer: data.server.trim(),
        alias: (data.alias ?? data.login).slice(0, 100),
        closeUnmanagedPositions: false,
        ...(regionId !== undefined ? { region: { id: regionId } } : {}),
      };
      return mcFetch(apiKey, "/accounts", { method: "POST", json: body });
    });
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

    const { status, payload } = outcome.response;
    const account = payload as (McAccount & { message?: string; error?: string }) | undefined;

    if (status < 200 || status >= 300) {
      const detail = account?.message || account?.error || account?.statusMessage || mcErrors(payload);
      // Auth rejections mean the admin's master key is inactive — plain wording,
      // no env details. Every other failure shows the real provider message.
      if (isAuthRejected(status, payload)) return { ok: false, code: "key_rejected", message: rejectedKeyMessage(status) };
      return { ok: false, code: "failed", message: detail || `MetaCopier rejected the connection (HTTP ${status}). Check login, server and password.` };
    }

    if (!account?.id) return { ok: false, code: "failed", message: "Connection created but no account ID was returned. Try again." };

    return {
      ok: true,
      accountId: account.id,
      ...(account.accountInformation?.environment ? { environment: account.accountInformation.environment } : {}),
      ...(account.accountInformation?.balance !== undefined ? { balance: account.accountInformation.balance } : {}),
      ...(account.accountInformation?.currency ? { currency: account.accountInformation.currency } : {}),
    };
  });

/** DELETE /accounts/{accountId} — removes the user's hosted connection. */
export const disconnectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtDisconnectRequest) => data)
  .handler(async ({ data }): Promise<MtDisconnectResult> => {
    const outcome = await withMasterKey((apiKey) => mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}`, { method: "DELETE" }));
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };
    const { status } = outcome.response;
    if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
      if (isAuthRejected(status, null)) return { ok: false, code: "key_rejected", message: rejectedKeyMessage(status) };
      return { ok: false, code: "failed", message: `Could not remove the account (HTTP ${status}).` };
    }
    return { ok: true, message: "MT5 account disconnected." };
  });

/** GET /accounts/{accountId} — live connection status for the user's own account. */
export const getMtAccountStatus = createServerFn({ method: "POST" })
  .validator((data: MtStatusRequest) => data)
  .handler(async ({ data }): Promise<MtStatusResult> => {
    const outcome = await withMasterKey((apiKey) => mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}`));
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

    const { status, payload } = outcome.response;
    if (status < 200 || status >= 300) {
      if (isAuthRejected(status, payload)) return { ok: false, code: "key_rejected", message: rejectedKeyMessage(status) };
      return { ok: false, code: "failed", message: `Account not found (HTTP ${status}).` };
    }
    const account = payload as McAccount | undefined;
    const info = account?.accountInformation;
    return {
      ok: true,
      connected: info?.connected === true,
      ...(info?.balance !== undefined ? { balance: info.balance } : {}),
      ...(info?.equity !== undefined ? { equity: info.equity } : {}),
      ...(info?.currency ? { currency: info.currency } : {}),
      ...(info?.environment ? { environment: info.environment } : {}),
      ...(account?.statusMessage ? { statusMessage: account.statusMessage } : {}),
    };
  });

/** POST /accounts/{accountId}/positions — places a market order on the user's account. */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    if (!data.accountId) return { ok: false, code: "failed", message: "No connected MT5 account. Link your account on the MetaTrader page first." };

    const volume = Math.max(Number.parseFloat(data.lotSize) || 0, 0.01);
    const body = {
      symbol: data.symbol,
      volume,
      orderType: data.direction === "SELL" ? "Sell" : "Buy",
      openPrice: 0, // 0 = market execution
      stopLoss: 0, // 0 = no stop loss
      takeProfit: 0, // 0 = no take profit
      requestId: requestIdCounter++ % 1000, // dedupe counter required by MetaCopier
      comment: `${data.eaName} - EA Migrate`.slice(0, 100),
    };

    const outcome = await withMasterKey((apiKey) =>
      mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}/positions`, { method: "POST", json: body }),
    );
    if (outcome.kind === "missing") return { ok: false, code: "key_missing", message: missingKeyMessage() };
    if (outcome.kind === "rejected") return { ok: false, code: "key_rejected", message: rejectedKeyMessage(outcome.status) };

    const { status, payload } = outcome.response;
    const position = payload as McPosition | undefined;

    if (status < 200 || status >= 300) {
      const detail = position?.message || position?.error || mcErrors(payload);
      if (isAuthRejected(status, payload)) return { ok: false, code: "key_rejected", message: rejectedKeyMessage(status) };
      return { ok: false, code: "failed", message: detail || `Order rejected (HTTP ${status}).` };
    }

    return {
      ok: true,
      message: `${data.direction} ${volume} ${data.symbol} executed`,
      ...(position?.id ? { orderId: position.id } : {}),
    };
  });

let requestIdCounter = 0;
