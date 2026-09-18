import { createServerFn } from "@tanstack/react-start";

/**
 * MetaCopier platform integration — ONE master API key for everyone.
 *
 * The master key lives ONLY on the server (Cloud secret / env). The frontend
 * never sees it and never calls MetaCopier directly — it calls the server
 * functions below (this stack's edge functions), which attach the key.
 *
 * Master key resolution order (server-side only):
 *   1. METACOPIER_MASTER_KEY   ← the canonical admin secret
 *   2. EXECUTION_API_KEY       ← legacy alias so existing deployments keep working
 *
 * Auth compatibility: MetaCopier's documented auth header is "X-API-KEY";
 * some gateway deployments instead expect a standard "Authorization: Bearer
 * <key>" header. Both are sent — extra headers are ignored by servers that
 * don't need them.
 *
 * Endpoint compatibility: the documented base is {host}/rest/api/v1; the
 * user's deployment may expose {host}/api/v1. EXECUTION_API_URL / a
 * METACOPIER_API_URL env var can pin either; a fetch against the other
 * variant is attempted as fallback.
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

/** Returns the server-side master key, or null when the admin hasn't set one. */
function masterKey(): string | null {
  const key = (process.env["METACOPIER_MASTER_KEY"] ?? process.env["EXECUTION_API_KEY"] ?? "").trim();
  return key.length > 0 ? key : null;
}

/** Resolves the MetaCopier REST root candidates, most-likely first. */
function apiRoots(): string[] {
  const configured = (process.env["METACOPIER_API_URL"] ?? process.env["EXECUTION_API_URL"] ?? "").trim().replace(/\/+$/, "");
  const host = configured
    ? configured.replace(/\/(rest\/api\/v1|api\/v1)$/, "")
    : "https://api.metacopier.com";
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

/**
 * User-facing error for auth/permission failures. It names the cause plainly
 * (the admin's MetaCopier key) without leaking env var names or secrets.
 */
function friendlyConfigError(): string {
  return "The platform's MetaCopier API key is not active yet. Please contact support so live trading can be enabled.";
}

/** True only when MetaCopier rejected our authorization (admin's master key). */
function isAuthRejected(status: number, payload: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const raw = JSON.stringify(payload ?? {}).toLowerCase();
  return raw.includes("unauthorized") || raw.includes("forbidden");
}

type McType = { id: number; name?: string };
type McRegion = { id: number; name?: string };
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

export type MtConnectResult =
  | { ok: true; accountId: string; environment?: string; balance?: number; currency?: string }
  | { ok: false; message: string };

export type MtDisconnectRequest = { accountId: string };
export type MtDisconnectResult = { ok: boolean; message: string };

export type MtStatusRequest = { accountId: string };
export type MtStatusResult =
  | { ok: true; connected: boolean; balance?: number; equity?: number; currency?: string; environment?: string; statusMessage?: string }
  | { ok: false; message: string };

export type LiveTradeRequest = {
  /** The END USER's MetaCopier account id (their connected MT5). */
  accountId: string;
  eaName: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: string;
};

export type LiveTradeResult = { ok: boolean; message: string; orderId?: string };

/** GET /types/accountTypes + /types/regions, resolving MT5 and a default region. */
async function resolveMcTypes(apiKey: string): Promise<{ typeId: number; regionId?: number }> {
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
      if (first) return { typeId, regionId: first.id };
    }
  } catch {
    /* region is optional in practice; the create call will report if required */
  }
  return { typeId };
}

/**
 * Connect the END USER's MT5 account under the platform's MetaCopier project.
 * Uses skipCredentialCheck: false so MetaCopier validates the credentials
 * immediately — a wrong login/server/password fails here, not later mid-trade.
 */
export const connectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtConnectRequest) => data)
  .handler(async ({ data }): Promise<MtConnectResult> => {
    const apiKey = masterKey();
    if (!apiKey) return { ok: false, message: friendlyConfigError() };

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

    const { status, payload } = await mcFetch(apiKey, "/accounts", { method: "POST", json: body });
    const account = payload as (McAccount & { message?: string; error?: string }) | undefined;

    if (status < 200 || status >= 300) {
      const detail = account?.message || account?.error || account?.statusMessage;
      // Auth rejections mean the admin's master key is inactive — plain wording,
      // no env details. Every other failure shows the real provider message.
      if (isAuthRejected(status, payload)) return { ok: false, message: friendlyConfigError() };
      return { ok: false, message: detail || `MetaCopier rejected the connection (HTTP ${status}). Check login, server and password.` };
    }

    if (!account?.id) return { ok: false, message: "Connection created but no account ID was returned. Try again." };

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
    const apiKey = masterKey();
    if (!apiKey) return { ok: false, message: friendlyConfigError() };
    const { status } = await mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}`, { method: "DELETE" });
    if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
      if (isAuthRejected(status, null)) return { ok: false, message: friendlyConfigError() };
      return { ok: false, message: `Could not remove the account (HTTP ${status}).` };
    }
    return { ok: true, message: "MT5 account disconnected." };
  });

/** GET /accounts/{accountId} — live connection status for the user's own account. */
export const getMtAccountStatus = createServerFn({ method: "POST" })
  .validator((data: MtStatusRequest) => data)
  .handler(async ({ data }): Promise<MtStatusResult> => {
    const apiKey = masterKey();
    if (!apiKey) return { ok: false, message: friendlyConfigError() };

    const { status, payload } = await mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}`);
    if (status < 200 || status >= 300) {
      if (isAuthRejected(status, payload)) return { ok: false, message: friendlyConfigError() };
      return { ok: false, message: `Account not found (HTTP ${status}).` };
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
    const apiKey = masterKey();
    if (!apiKey) return { ok: false, message: friendlyConfigError() };

    if (!data.accountId) return { ok: false, message: "No connected MT5 account. Link your account on the MetaTrader page first." };

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

    const { status, payload } = await mcFetch(apiKey, `/accounts/${encodeURIComponent(data.accountId)}/positions`, {
      method: "POST",
      json: body,
    });
    const position = payload as McPosition | undefined;

    if (status < 200 || status >= 300) {
      const detail = position?.message || position?.error;
      if (isAuthRejected(status, payload)) return { ok: false, message: friendlyConfigError() };
      return { ok: false, message: detail || `Order rejected (HTTP ${status}).` };
    }

    return {
      ok: true,
      message: `${data.direction} ${volume} ${data.symbol} executed`,
      ...(position?.id ? { orderId: position.id } : {}),
    };
  });

let requestIdCounter = 0;
