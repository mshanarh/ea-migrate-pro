import { createServerFn } from "@tanstack/react-start";

export type LiveTradeRequest = {
  eaName: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: string;
};

export type LiveTradeResult = {
  ok: boolean;
  message: string;
  orderId?: string;
};

type McPosition = { id?: string };

type McAccount = {
  id?: string;
  loginAccountNumber?: string;
  loginServer?: string;
  accountInformation?: { connected?: boolean; environment?: string; wrongCredentials?: boolean };
};

let requestIdCounter = 0;

/**
 * Server-only live trade execution through MetaCopier.
 *
 * Env (server-side only, never in the client bundle):
 *  - EXECUTION_API_KEY   MetaCopier API key (project-level or account-level)
 *  - EXECUTION_API_URL   MetaCopier base URL, e.g. https://api.metacopier.io
 *                        (a regional host like https://api-london.metacopier.io is faster;
 *                        a URL already ending in /rest/api/v1 also works)
 *  - EXECUTION_ACCOUNT_ID  Optional: the MetaCopier account to trade on. When omitted,
 *                        the first connected live account in the project is used.
 *
 * MetaCopier contract (verified against their OpenAPI spec):
 *  - Auth: "X-API-KEY" header (not Bearer)
 *  - Open position: POST {base}/rest/api/v1/accounts/{accountId}/positions
 *  - Body: PositionRequestDTO { symbol, volume, orderType: "Buy"|"Sell", openPrice,
 *          stopLoss, takeProfit, requestId (0-999 dedupe counter), comment }
 */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    const apiKey = process.env["EXECUTION_API_KEY"];
    if (!apiKey) {
      return { ok: false, message: "Live execution is not configured: missing API key." };
    }

    const base = (process.env["EXECUTION_API_URL"] ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      return { ok: false, message: "Live execution is not configured: missing provider URL." };
    }
    const apiRoot = base.endsWith("/rest/api/v1") ? base : `${base}/rest/api/v1`;

    const headers = {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    };

    // Resolve which MetaCopier account places the trade.
    const accountId = process.env["EXECUTION_ACCOUNT_ID"]?.trim() || (await resolveAccountId(apiRoot, headers));
    if (!accountId) {
      return {
        ok: false,
        message:
          "No connected MetaCopier account found. Add your MT5 account in MetaCopier (or set EXECUTION_ACCOUNT_ID).",
      };
    }

    const volume = Math.max(Number.parseFloat(data.lotSize) || 0, 0.01);
    const body = {
      symbol: data.symbol,
      volume,
      orderType: data.direction === "SELL" ? "Sell" : "Buy",
      openPrice: 0, // 0 = market execution for Buy/Sell
      stopLoss: 0, // 0 = no stop loss
      takeProfit: 0, // 0 = no take profit
      requestId: requestIdCounter++ % 1000, // dedupe counter required by MetaCopier
      comment: `EA Migrate Pro — ${data.eaName}`.slice(0, 100),
    };

    try {
      const response = await fetch(`${apiRoot}/accounts/${encodeURIComponent(accountId)}/positions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      let payload: (McPosition & { message?: string; error?: string }) | undefined;
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Provider may return an empty body.
      }

      if (!response.ok) {
        const detail = payload?.message || payload?.error;
        return { ok: false, message: detail || `MetaCopier rejected the order (HTTP ${response.status}).` };
      }

      return {
        ok: true,
        message: `${data.direction} ${volume} ${data.symbol} executed via MetaCopier`,
        ...(payload?.id ? { orderId: payload.id } : {}),
      };
    } catch {
      return { ok: false, message: "Could not reach MetaCopier." };
    }
  });

/** Pick the first connected live account in the project when no explicit account ID is set. */
async function resolveAccountId(apiRoot: string, headers: Record<string, string>): Promise<string | undefined> {
  try {
    const response = await fetch(`${apiRoot}/accounts`, { headers });
    if (!response.ok) return undefined;
    const accounts = (await response.json()) as McAccount[];
    const connected = (Array.isArray(accounts) ? accounts : []).filter(
      (a) => a.id && a.accountInformation?.connected !== false && !a.accountInformation?.wrongCredentials,
    );
    const live = connected.find((a) => a.accountInformation?.environment !== "DEMO");
    return (live ?? connected[0])?.id;
  } catch {
    return undefined;
  }
}
