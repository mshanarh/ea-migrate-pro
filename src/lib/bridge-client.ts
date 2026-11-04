/**
 * MT5 bridge connection details for DIRECT browser → bridge calls.
 *
 * The production app is a static Vite site (no server functions), so the
 * scanner's Execute flow, the live-price lookup for SL/TP and the MetaTrader
 * TEST CONNECTION hit the bridge straight from the browser. The bridge allows
 * CORS from the app's origins (verified).
 *
 * THE ADDRESS IS HARDCODED — THERE IS NOTHING FOR THE USER TO CONFIGURE.
 *
 * It used to be a setting (a field in Settings, an admin KV value, a cached
 * device value and an env override), because the bridge sits behind a
 * cloudflared quick tunnel whose hostname is minted fresh on every restart.
 * That meant every stale copy of the address — a device cache, a forgotten KV
 * value, an old env var — could silently send the app to a dead host while the
 * bridge was perfectly online.
 *
 * Now there is exactly one address, in this file. Test bridge, /scalper/start,
 * /scalper/stop and /scalper/status, quotes, candles and execution all read it
 * through `getBridgeUrl()`, so they can never disagree and no screen ever asks
 * for it. Changing tunnels is a one-line edit and a deploy.
 */
export const BRIDGE_KEY = "my_secret_bridge_key_2026";

/** THE bridge address. The single source of truth for every bridge call. */
export const BRIDGE_URL = "https://class-risks-protective-positions.trycloudflare.com";

/** The address in use right now — every request reads this. */
export function getBridgeUrl(): string {
  return BRIDGE_URL;
}

/** Host only, for messages that should stay short. */
export function bridgeHost(url: string = BRIDGE_URL): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* ── failure diagnosis ───────────────────────────────────────────────────── */

/** The test button and the status poll are a quick read, not a job. */
export const BRIDGE_PROBE_TIMEOUT_MS = 10_000;
/** Start/stop wait for the daemon to answer — still bounded, never a freeze. */
export const BRIDGE_COMMAND_TIMEOUT_MS = 30_000;

/**
 * THE REAL REASON A BRIDGE CALL FAILED — in the user's terms.
 *
 * `AbortSignal.timeout()` rejects with a DOMException whose message is literally
 * "signal timed out", and every caller used to print that, so a DEAD HOSTNAME
 * and a SLOW DAEMON both looked like "signal timed out". A timeout is now
 * called a timeout, a refused/DNS/TLS failure is called a network failure, and
 * anything else carries its own message. Never a generic phrase.
 */
export function describeBridgeFailure(error: unknown, timeoutMs: number = BRIDGE_PROBE_TIMEOUT_MS): string {
  const record = (error ?? {}) as { name?: unknown; message?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message.trim() : String(error ?? "").trim();
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  if (name === "TimeoutError" || /signal timed out|timed out|timeout/i.test(message)) {
    return `timeout — the bridge did not answer within ${seconds}s`;
  }
  if (name === "AbortError") return "request was cancelled";
  // The browser deliberately hides DNS vs refused vs TLS behind one opaque
  // TypeError; the caller adds a probe when it needs to tell them apart.
  if (/failed to fetch|networkerror|load failed|network request failed|err_connection|err_name|err_cert/i.test(message)) {
    return "network unreachable — DNS/hostname not found, connection refused or TLS error";
  }
  return message || "network unreachable — the request could not be completed";
}

/** Is the host answering at all (ignoring CORS)? Used only to name the reason. */
async function probeHostAnswers(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return true;
  } catch {
    return false;
  }
}

export type BridgeTestResult =
  | { kind: "ok"; url: string; latencyMs: number }
  | { kind: "http"; url: string; status: number }
  | { kind: "unreachable"; url: string; reason: string };

/**
 * TEST BRIDGE — `GET {BRIDGE_URL}/scalper/status` with a 10 s bound.
 *
 * Three outcomes, and nothing else: OK, an HTTP error with its real code, or
 * unreachable with the real reason. A CORS refusal and a dead hostname are
 * different answers, so the opaque `TypeError` is probed once more without CORS
 * to find out which one it was. No argument: the address is not configurable.
 */
export async function testBridgeConnection(): Promise<BridgeTestResult> {
  const url = BRIDGE_URL;
  const startedAt = Date.now();
  try {
    const response = await fetch(`${url}/scalper/status`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", "x-bridge-key": BRIDGE_KEY },
      signal: AbortSignal.timeout(BRIDGE_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "http", url, status: response.status };
    return { kind: "ok", url, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const reason = describeBridgeFailure(error, BRIDGE_PROBE_TIMEOUT_MS);
    if (!reason.startsWith("network unreachable")) {
      return { kind: "unreachable", url, reason };
    }
    const answers = await probeHostAnswers(url);
    return {
      kind: "unreachable",
      url,
      reason: answers
        ? "the address answered but blocked the request (CORS) — check the bridge's allowed origins"
        : "DNS/hostname not found, connection refused or TLS error",
    };
  }
}

/**
 * WHY THE CALL FAILED — in the user's terms, and NEVER the address.
 *
 * The bridge URL is an implementation detail (a cloudflared tunnel hostname);
 * it is logged for diagnosis but must never appear on screen. What the trader
 * needs is the reason — a timeout is a timeout, a dead hostname is a network
 * failure — never "signal timed out" and never a URL they cannot act on.
 */
export function bridgeUnreachableMessage(error?: unknown): string {
  const reason = error === undefined || error === null || error === "" ? "" : describeBridgeFailure(error);
  return `Could not reach the trading server${reason ? ` (${reason})` : ""} — check the connection and that the bridge is running.`;
}

/**
 * Ordered candidates to try when a broker refuses the robot's exact symbol
 * name — brokers brand the same market differently (BTCUSDm on Exness,
 * BTCUSD.i elsewhere, glued XAUUSDM…). The bridge (v0.3+) resolves names
 * itself against the broker's own symbol list; this candidate list keeps the
 * retry working against older bridges too.
 */
export function bridgeSymbolCandidates(symbol: string): string[] {
  const raw = symbol.trim();
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return raw ? [raw] : [];
  // Glued broker suffix (XAUUSDM → XAUUSD): strip one trailing brand letter
  // only when a real base remains (mirrors the scanner's stripBrokerSuffixes).
  let base = cleaned;
  if (/[MCIZ]$/.test(base) && base.length - 1 >= 5) base = base.slice(0, -1);
  const out: string[] = [];
  const push = (value: string) => {
    if (!value) return;
    if (out.some((item) => item.toUpperCase() === value.toUpperCase())) return;
    out.push(value);
  };
  push(raw);
  push(base);
  for (const suffix of ["m", ".m", "c", ".c", "i", ".i", "z", ".z", "M"]) push(base + suffix);
  push(cleaned);
  return out.slice(0, 12);
}
