import { createServerFn } from "@tanstack/react-start";

const BRIDGE_URL = process.env["MT5_BRIDGE_URL"] || "http://34.201.16.197:8000";
const BRIDGE_KEY = process.env["MT5_BRIDGE_KEY"] || "my_secret_bridge_key_2026";

/**
 * 1. Verify MT5 Account Credentials
 */
export const verifyMt5Credentials = createServerFn({ method: "POST" })
  .validator((data: { login: number | string; password: string; server: string }) => data)
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${BRIDGE_URL}/account/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": BRIDGE_KEY,
        },
        body: JSON.stringify({
          login: Number(data.login),
          password: data.password,
          server: data.server,
        }),
      });

      const res = await response.json();
      if (!response.ok) {
        throw new Error(res.detail || "Account verification failed");
      }
      return { success: true, account: res.account };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

/**
 * 2. Execute Trade Directly to MT5
 */
export const executeVpsTrade = createServerFn({ method: "POST" })
  .validator((data: {
    credentials: { login: number | string; password: string; server: string };
    symbol: string;
    action: "BUY" | "SELL";
    volume: number;
    stop_loss?: number;
    take_profit?: number;
  }) => data)
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${BRIDGE_URL}/trade/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": BRIDGE_KEY,
        },
        body: JSON.stringify({
          credentials: {
            login: Number(data.credentials.login),
            password: data.credentials.password,
            server: data.credentials.server,
          },
          symbol: data.symbol,
          action: data.action.toUpperCase(),
          volume: data.volume,
          stop_loss: data.stop_loss || 0,
          take_profit: data.take_profit || 0,
          comment: "EA Migrate Pro Live",
        }),
      });

      const res = await response.json();
      if (!response.ok) {
        throw new Error(res.detail || "Trade execution failed");
      }
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
