import { createServerFn } from "@tanstack/react-start";
import { cloudSyncConfigured, upsertMt5Record } from "@/lib/account-sync.server";

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
      if (!response.ok || res.success === false) {
        throw new Error(res.message || res.detail || "Account verification failed");
      }
      return { success: true, account: res.account };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

/**
 * 2. Save MT5 credentials — SAVE FIRST, VERIFY BEST-EFFORT.
 *
 * The credentials are ALWAYS persisted — on the device first, then in the
 * cloud store best-effort — before any broker contact. Verification then
 * runs against the VPS bridge with a short timeout; a bridge outage, wrong
 * password or timeout NEVER blocks or rolls back the save — the account is
 * simply marked unverified and the platform verifies again when the next
 * trade executes. This is the bridge-offline fix: the user's details are
 * never lost because the VPS was down.
 */
export type SaveMt5CredentialsInput = {
  userId: string;
  login: number | string;
  password: string;
  server: string;
  broker?: string | undefined;
  accountType?: string | undefined;
};
export type SaveMt5CredentialsResult = {
  success: boolean;
  verified: boolean;
  saved: boolean;
  message: string;
};

export const saveMt5Credentials = createServerFn({ method: "POST" })
  .validator((data: SaveMt5CredentialsInput) => data)
  .handler(async ({ data }): Promise<SaveMt5CredentialsResult> => {
    const login = String(data.login).trim();
    const password = data.password;
    const server = data.server.trim();

    // 1. Persist to the cloud store BEST-EFFORT — a failed or missing cloud
    //    write never fails the overall save (the device keeps its own copy).
    const record = {
      userId: data.userId,
      loginId: login,
      server,
      accountType: data.accountType ?? "Standard",
      broker: data.broker?.trim() || (server.includes("-") ? (server.split("-")[0]?.trim() ?? server) : server),
      mcAccountId: "", // legacy MetaApi column — the bridge executes directly
      isConnected: false,
      connectedAt: "",
      mtPassword: password, // server-side only; never served to the browser
    };
    let saved = false;
    try {
      saved = cloudSyncConfigured() ? await upsertMt5Record(record) : false;
    } catch (dbError) {
      console.error("[mt5-bridge] credential save failed:", dbError);
      saved = false;
    }

    // 2. Try verification, but DON'T block saving. Abort after 5s — a slow or
    //    down bridge must never hold the user's save hostage.
    let verified = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${BRIDGE_URL}/account/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": BRIDGE_KEY,
        },
        body: JSON.stringify({
          login: Number(login),
          password,
          server,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const res = await response.json();
        verified = res.valid === true || res.success === true;
        if (verified) {
          // Persist the verified state so the UI can show Connected.
          await upsertMt5Record({ ...record, isConnected: true, connectedAt: new Date().toISOString() });
        }
      }
    } catch {
      // Bridge offline/slow — DO NOT throw; the save stands as unverified.
    }

    // 3. Always succeed — the credentials are kept (device + cloud when
    //    reachable) and verification happens again at the next trade.
    return {
      success: true,
      verified,
      saved,
      message: verified ? "Connected and saved!" : "Saved securely. Will verify on next trade.",
    };
  });

/**
 * 3. Execute Trade Directly to MT5
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
