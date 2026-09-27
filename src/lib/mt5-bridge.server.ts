import { createServerFn } from "@tanstack/react-start";
import { cloudSyncConfigured, getMt5RecordWithSecret, upsertMt5Record } from "@/lib/account-sync.server";

const BRIDGE_URL = process.env["MT5_BRIDGE_URL"] || "http://34.201.16.197:8000";
const BRIDGE_KEY = process.env["MT5_BRIDGE_KEY"] || "my_secret_bridge_key_2026";
/** Hard cap on any single bridge request — a dead bridge must fail FAST with
 *  a clear message, never hang the scanner on "EXECUTING" forever. */
const BRIDGE_TIMEOUT_MS = 12_000;

function bridgeHostLabel(): string {
  try {
    return new URL(BRIDGE_URL).host;
  } catch {
    return BRIDGE_URL;
  }
}

/** Uniform, ACTIONABLE message for any bridge transport failure. */
function bridgeTransportError(err: unknown): string {
  const host = bridgeHostLabel();
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return `VPS bridge timed out after ${BRIDGE_TIMEOUT_MS / 1000}s — ${host} did not respond. Check that bridge.py is running on the VPS.`;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Cannot reach the VPS bridge at ${host} (${detail}). Check that bridge.py is running and that port 8000 is open in the VPS firewall/security group.`;
}

/**
 * Single bridge transport helper — every call site uses this so timeouts and
 * error shaping are consistent. Never throws: transport failures come back
 * as { transportError } and are turned into user-facing messages upstream.
 */
async function bridgeFetch(
  path: string,
  body: unknown,
  timeoutMs: number = BRIDGE_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; transportError?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-key": BRIDGE_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: {}, transportError: bridgeTransportError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1. Verify MT5 Account Credentials
 */
export const verifyMt5Credentials = createServerFn({ method: "POST" })
  .validator((data: { login: number | string; password: string; server: string }) => data)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string | undefined; account?: any }> => {
      const result = await bridgeFetch("/account/verify", {
        login: Number(data.login),
        password: data.password,
        server: data.server,
      });
      if (result.transportError) {
        return { success: false, error: result.transportError };
      }
      const res = result.data as { success?: boolean; message?: string; detail?: string; account?: any };
      if (!result.ok || res.success === false) {
        return { success: false, error: res.message || res.detail || "Account verification failed" };
      }
      return { success: true, account: res.account };
    },
  );

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
    const verifyResult = await bridgeFetch(
      "/account/verify",
      { login: Number(login), password, server },
      5000,
    );
    if (verifyResult.ok) {
      const res = verifyResult.data as { valid?: boolean; success?: boolean };
      verified = res.valid === true || res.success === true;
      if (verified) {
        // Persist the verified state so the UI can show Connected.
        await upsertMt5Record({ ...record, isConnected: true, connectedAt: new Date().toISOString() });
      }
    }
    // Bridge offline/slow (transportError) — DO NOT throw; the save stands as
    // unverified and verification retries at the next trade.

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
 * 3. Execute trades for a signed-in user — THE LIVE EXECUTION PATH.
 *
 * Trade execution needs the MT5 password, and the password NEVER travels
 * through the browser. This server function takes the signed-in user id,
 * reads the saved credentials server-side from the cloud store, then sends
 * them to the VPS bridge which opens the broker connection, places the
 * order(s) and closes the connection again.
 */
export type ExecuteMt5ForUserInput = {
  userId: string;
  symbol: string;
  action: "BUY" | "SELL";
  volume: number;
  stop_loss?: number | undefined;
  take_profit?: number | undefined;
  tradeCount?: number | undefined;
};
export type ExecuteMt5ForUserResult = {
  ok: boolean;
  message: string;
  executed: number;
  total: number;
};

export const executeMt5ForUser = createServerFn({ method: "POST" })
  .validator((data: ExecuteMt5ForUserInput) => data)
  .handler(async ({ data }): Promise<ExecuteMt5ForUserResult> => {
    const total = Math.max(1, Math.min(Math.floor(data.tradeCount ?? 1), 20));
    const record = await getMt5RecordWithSecret(data.userId);
    if (!record || !record.mtPassword) {
      return {
        ok: false,
        executed: 0,
        total,
        message: "No saved MT5 credentials — save them on the MetaTrader page first.",
      };
    }

    // Fire the FIRST order alone. If the bridge itself is unreachable, one
    // clear error beats N identical failures (and 20 simultaneous broker
    // logins). Only when the first order reaches the bridge do the rest fire
    // in parallel — the bridge opens the broker connection per order and
    // closes it afterwards.
    const firstAttempt = await executeVpsTradeInternal({
      login: record.loginId,
      password: record.mtPassword ?? "",
      server: record.server,
      symbol: data.symbol,
      action: data.action,
      volume: data.volume,
      stop_loss: data.stop_loss,
      take_profit: data.take_profit,
    });
    if (!firstAttempt.success && firstAttempt.transportDown) {
      return { ok: false, executed: 0, total, message: firstAttempt.error ?? "VPS bridge unreachable." };
    }
    const results = [firstAttempt];
    if (total > 1) {
      const rest = await Promise.all(
        Array.from({ length: total - 1 }, () =>
          executeVpsTradeInternal({
            login: record.loginId,
            password: record.mtPassword ?? "",
            server: record.server,
            symbol: data.symbol,
            action: data.action,
            volume: data.volume,
            stop_loss: data.stop_loss,
            take_profit: data.take_profit,
          }).catch(() => ({ success: false as const, error: "Bridge request failed" })),
        ),
      );
      results.push(...rest);
    }
    const executed = results.filter((item) => item.success).length;
    if (executed === total) {
      return {
        ok: true,
        executed,
        total,
        message: total > 1 ? `${total}/${total} ${data.symbol} trades opened on MT5 — EA Migrate` : `${data.symbol} trade opened on MT5 — EA Migrate`,
      };
    }
    const reason = results.find((item) => !item.success)?.error ?? "The bridge did not accept the order.";
    return {
      ok: false,
      executed,
      total,
      message: executed > 0 ? `${executed}/${total} executed — ${reason}` : reason,
    };
  });

/**
 * 4. Execute one trade directly to MT5 — internal, credentials in hand.
 */
async function executeVpsTradeInternal(input: {
  login: number | string;
  password: string;
  server: string;
  symbol: string;
  action: "BUY" | "SELL";
  volume: number;
  stop_loss?: number | undefined;
  take_profit?: number | undefined;
}): Promise<{ success: boolean; error?: string; transportDown?: boolean }> {
  const result = await bridgeFetch("/trade/execute", {
    credentials: {
      login: Number(input.login),
      password: input.password,
      server: input.server,
    },
    symbol: input.symbol,
    action: input.action.toUpperCase(),
    volume: input.volume,
    stop_loss: input.stop_loss || 0,
    take_profit: input.take_profit || 0,
    comment: "EA Migrate Live",
  });
  if (result.transportError) {
    return { success: false, error: result.transportError, transportDown: true };
  }
  if (!result.ok) {
    const res = result.data as { detail?: string; message?: string };
    return { success: false, error: res.detail || res.message || `Trade execution failed (HTTP ${result.status})` };
  }
  return { success: true };
}

/**
 * 5. Execute Trade Directly to MT5 — explicit-credentials server function.
 * Kept for callers that already hold the credentials server-side; the app's
 * live path goes through executeMt5ForUser so no password reaches the client.
 */
export const executeVpsTrade = createServerFn({ method: "POST" })
  .validator((data: {
    credentials: { login: number | string; password: string; server: string };
    symbol: string;
    action: "BUY" | "SELL";
    volume: number;
    stop_loss?: number | undefined;
    take_profit?: number | undefined;
  }) => data)
  .handler(async ({ data }) => {
    const result = await executeVpsTradeInternal({
      login: data.credentials.login,
      password: data.credentials.password,
      server: data.credentials.server,
      symbol: data.symbol,
      action: data.action,
      volume: data.volume,
      stop_loss: data.stop_loss,
      take_profit: data.take_profit,
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  });
