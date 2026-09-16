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

/**
 * Server-only live trade execution.
 *
 * The EXECUTION_API_KEY lives in the server environment (never in the client
 * bundle) and is attached as a bearer token when forwarding the confirmed
 * trade request to the execution provider at EXECUTION_API_URL.
 */
export const executeLiveTrade = createServerFn({ method: "POST" })
  .validator((data: LiveTradeRequest) => data)
  .handler(async ({ data }): Promise<LiveTradeResult> => {
    const apiKey = process.env["EXECUTION_API_KEY"];
    if (!apiKey) {
      return { ok: false, message: "Live execution is not configured: missing API key." };
    }

    const upstream = process.env["EXECUTION_API_URL"];
    if (!upstream) {
      return { ok: false, message: "Live execution is not configured: missing provider URL." };
    }

    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          eaName: data.eaName,
          symbol: data.symbol,
          direction: data.direction,
          lotSize: data.lotSize,
          sentAt: new Date().toISOString(),
        }),
      });

      let payload: { confirmed?: boolean; orderId?: string; message?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Provider may return an empty body on errors.
      }

      if (!response.ok) {
        return { ok: false, message: payload.message || `Execution provider returned ${response.status}.` };
      }
      if (payload.confirmed !== true) {
        return { ok: false, message: payload.message || "The execution provider did not confirm the order." };
      }

      return { ok: true, message: "Order executed", ...(payload.orderId ? { orderId: payload.orderId } : {}) };
    } catch {
      return { ok: false, message: "Could not reach the execution provider." };
    }
  });
