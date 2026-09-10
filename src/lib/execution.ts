import type { MtAccount } from "@/lib/app-store";

export type TradeDirection = "BUY" | "SELL";

export type TradeExecutionRequest = {
  robotId: string;
  symbol: string;
  direction: TradeDirection;
  lotSize: string;
  mt: MtAccount;
};

type ExecutionResponse = {
  confirmed?: boolean;
  orderId?: string;
  message?: string;
};

const executionUrl = (import.meta.env["VITE_EXECUTION_API_URL"] as string | undefined) || "/api/trades/execute";

export async function executeTrade(request: TradeExecutionRequest): Promise<ExecutionResponse> {
  const response = await fetch(executionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  let payload: ExecutionResponse = {};
  try {
    payload = (await response.json()) as ExecutionResponse;
  } catch {
    // Preserve the provider status when it does not return JSON.
  }

  if (!response.ok) {
    throw new Error(payload.message || `Execution service returned ${response.status}.`);
  }
  if (payload.confirmed !== true) {
    throw new Error(payload.message || "The execution service did not confirm the order.");
  }

  return payload;
}