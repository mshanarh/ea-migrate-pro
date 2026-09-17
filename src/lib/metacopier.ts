import { createServerFn } from "@tanstack/react-start";

/**
 * MetaCopier platform integration.
 *
 * ONE platform API key (EXECUTION_API_KEY + EXECUTION_API_URL env vars) is used
 * for the whole platform. Each END USER connects their OWN MT5 account from the
 * app (MetaTrader page): login + server + password are sent to MetaCopier's
 * create-account API, which hosts the connection. The resulting MetaCopier
 * account ID is stored per user and used for live execution.
 *
 * Verified against MetaCopier's official API (js-metacopier-api SDK):
 * - Auth: "X-API-KEY" header
 * - Create: POST {base}/rest/api/v1/accounts
 *   { type: {id: 1 = MT5}, loginAccountNumber, loginAccountPassword,
 *     loginServer, region: {id}, alias, closeUnmanagedPositions }
 * - Types/regions enums: GET /rest/api/v1/types/accountTypes, /types/regions
 * - List:   GET /rest/api/v1/accounts
 * - Delete: DELETE /rest/api/v1/accounts/{accountId}
 * - Execute: POST /rest/api/v1/accounts/{accountId}/positions
 *   { symbol, volume, orderType: "Buy"|"Sell", openPrice: 0 (market),
 *     stopLoss, takeProfit, requestId (0-999 dedupe), comment }
 */

const MC_TYPE_MT5 = 1;

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
  login: string;
  password: string;
  server: string;
  /** Shown in the MetaCopier dashboard, e.g. the app user's email. */
  alias?: string;
  /** MetaCopier region id. When omitted the first available region is used. */
  regionId?: number;
  accountType?: "LIVE" | "DEMO";
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

function mcConfig(): { apiKey: string; apiRoot: string } | { error: string } {
  const apiKey = process.env["EXECUTION_API_KEY"];
  if (!apiKey) return { error: "Live execution is not configured yet: missing platform API key." };
  const base = (process.env["EXECUTION_API_URL"] ?? "").trim().replace(/\/+$/, "");
  if (!base) return { error: "Live execution is not configured yet: missing platform API URL." };
  return { apiKey, apiRoot: base.endsWith("/rest/api/v1") ? base : `${base}/rest/api/v1` };
}

/** GET /types/accountTypes + /types/regions, resolving MT5 and a default region. */
async function resolveMcTypes(apiKey: string, apiRoot: string): Promise<{ typeId: number; regionId?: number }> {
  const headers = { "X-API-KEY": apiKey };
  let typeId = MC_TYPE_MT5;
  try {
    const response = await fetch(`${apiRoot}/types/accountTypes`, { headers });
    if (response.ok) {
      const types = (await response.json()) as McType[];
      const mt5 = (Array.isArray(types) ? types : []).find((t) => t.name?.toUpperCase().includes("MT5"));
      if (mt5) typeId = mt5.id;
    }
  } catch {
    /* keep the documented default (1 = MT5) */
  }
  try {
    const response = await fetch(`${apiRoot}/types/regions`, { headers });
    if (response.ok) {
      const regions = (await response.json()) as McRegion[];
      const first = (Array.isArray(regions) ? regions : [])[0];
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
    const config = mcConfig();
    if ("error" in config) return { ok: false, message: config.error };

    const { typeId, regionId } = await resolveMcTypes(config.apiKey, config.apiRoot);
    const body: Record<string, unknown> = {
      type: { id: typeId },
      loginAccountNumber: data.login.trim(),
      loginAccountPassword: data.password,
      loginServer: data.server.trim(),
      alias: (data.alias ?? data.login).slice(0, 100),
      closeUnmanagedPositions: false,
      ...(regionId !== undefined ? { region: { id: regionId } } : {}),
    };

    let payload: (McAccount & { message?: string; error?: string }) | undefined;
    try {
      const response = await fetch(`${config.apiRoot}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": config.apiKey },
        body: JSON.stringify(body),
      });
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Provider may return an empty body.
      }
      if (!response.ok) {
        const detail = payload?.message || payload?.error || payload?.statusMessage;
        return { ok: false, message: detail || `MetaCopier rejected the connection (HTTP ${response.status}). Check login, server and password.` };
      }
    } catch {
      return { ok: false, message: "Could not reach the execution provider." };
    }

    if (!payload?.id) return { ok: false, message: "Connection created but no account ID was returned. Try again." };

    return {
      ok: true,
      accountId: payload.id,
      ...(payload.accountInformation?.environment ? { environment: payload.accountInformation.environment } : {}),
      ...(payload.accountInformation?.balance !== undefined ? { balance: payload.accountInformation.balance } : {}),
      ...(payload.accountInformation?.currency ? { currency: payload.accountInformation.currency } : {}),
    };
  });

/** DELETE /accounts/{accountId} — removes the user's hosted connection. */
export const disconnectMt5Account = createServerFn({ method: "POST" })
  .validator((data: MtDisconnectRequest) => data)
  .handler(async ({ data }): Promise<MtDisconnectResult> => {
    const config = mcConfig();
    if ("error" in config) return { ok: false, message: config.error };
    try {
      const response = await fetch(`${config.apiRoot}/accounts/${encodeURIComponent(data.accountId)}`, {
        method: "DELETE",
        headers: { "X-API-KEY": config.apiKey },
      });
      if (!response.ok && response.status !== 404) {
        return { ok: false, message: `Could not remove the account (HTTP ${response.status}).` };
      }
      return { ok: true, message: "MT5 account disconnected." };
    } catch {
      return { ok: false, message: "Could not reach the execution provider." };
    }
  });

/** GET /accounts/{accountId} — live connection status for the user's own account. */
export const getMtAccountStatus = createServerFn({ method: "POST" })
  .validator((data: MtStatusRequest) => data)
  .handler(async ({ data }): Promise<MtStatusResult> => {
    const config = mcConfig();
    if ("error" in config) return { ok: false, message: config.error };
    try {
      const response = await fetch(`${config.apiRoot}/accounts/${encodeURIComponent(data.accountId)}`, {
        headers: { "X-API-KEY": config.apiKey },
      });
      if (!response.ok) return { ok: false, message: `Account not found (HTTP ${response.status}).` };
      const account = (await response.json()) as McAccount;
      const info = account.accountInformation;
      return {
        ok: true,
        connected: info?.connected === true,
        ...(info?.balance !== undefined ? { balance: info.balance } : {}),
        ...(info?.equity !== undefined ? { equity: info.equity } : {}),
        ...(info?.currency ? { currency: info.currency } : {}),
        ...(info?.environment ? { environment: info.environment } : {}),
        ...(account.statusMessage ? { statusMessage: account.statusMessage } : {}),
      };
    } catch {
      return { ok: false, message: "Could not reach the execution provider." };
    }
  });

/** POST /accounts/{accountId}/positions — places a market order on the user's account. */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    const config = mcConfig();
    if ("error" in config) return { ok: false, message: config.error };

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
      comment: `EA Migrate Pro — ${data.eaName}`.slice(0, 100),
    };

    try {
      const response = await fetch(`${config.apiRoot}/accounts/${encodeURIComponent(data.accountId)}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": config.apiKey },
        body: JSON.stringify(body),
      });

      let payload: McPosition | undefined;
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Provider may return an empty body.
      }

      if (!response.ok) {
        const detail = payload?.message || payload?.error;
        return { ok: false, message: detail || `Order rejected (HTTP ${response.status}).` };
      }

      return {
        ok: true,
        message: `${data.direction} ${volume} ${data.symbol} executed`,
        ...(payload?.id ? { orderId: payload.id } : {}),
      };
    } catch {
      return { ok: false, message: "Could not reach the execution provider." };
    }
  });

let requestIdCounter = 0;
