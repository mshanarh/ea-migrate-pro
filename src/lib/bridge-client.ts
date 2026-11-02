/**
 * MT5 bridge connection details for DIRECT browser → bridge calls.
 *
 * The production app is a static Vite site (no server functions), so the
 * scanner's Execute flow, the live-price lookup for SL/TP and the MetaTrader
 * TEST CONNECTION hit the bridge straight from the browser. The bridge allows
 * CORS from the app's origins (verified).
 *
 * THE ADDRESS IS A SETTING, NOT A BUILD-TIME CONSTANT.
 *
 * The bridge is published through a cloudflared quick tunnel, whose hostname is
 * minted fresh every time `cloudflared` restarts. A hardcoded URL therefore
 * works until the next tunnel restart, and then every request fails with
 * "Failed to fetch" while the bridge itself is perfectly online — which is
 * exactly what happened. The URL is now resolved at runtime, in this order:
 *
 *   1. the address an admin saved in the console (KV, /api/bridge-config),
 *   2. the last address this device successfully used (cached locally),
 *   3. `VITE_MT5_BRIDGE_URL` (or `VITE_BRIDGE_URL`) from the build environment,
 *   4. the baked-in default below.
 *
 * A stale or dead address is never trusted: the previous tunnel host is
 * recognised and skipped, and only `http(s)` URLs are accepted. Changing the
 * tunnel is now a console edit — no redeploy, no new build, no reinstall.
 */
export const BRIDGE_KEY = "my_secret_bridge_key_2026";

/** The bridge's current quick-tunnel address — the LAST resort, not the truth. */
const DEFAULT_BRIDGE_URL = "https://eating-investors-geometry-loans.trycloudflare.com";

/** Where the resolved address is remembered on this device. */
const STORAGE_KEY = "eamp.bridge.url.v1";

/** Keys old builds (or hand-edits) may have written. Purged on load. */
const LEGACY_STORAGE_KEYS = ["eamp.bridge.url", "bridgeUrl", "bridge_url", "mt5_bridge_url"];

/**
 * HOSTS KNOWN TO BE DEAD. The app must not keep calling one just because a
 * device cached it before the tunnel was re-minted.
 */
const DEAD_BRIDGE_HOSTS = ["camping-geology-operates-consistency.trycloudflare.com"];

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Trim, validate and de-trail an address; `null` when it is unusable. */
export function normalizeBridgeUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (DEAD_BRIDGE_HOSTS.includes(url.host.toLowerCase())) return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function readCachedBridgeUrl(): string | null {
  if (!isBrowser()) return null;
  try {
    // A saved address under any old key is stale by definition — clear it so a
    // later read cannot resurrect it.
    for (const key of LEGACY_STORAGE_KEYS) {
      if (window.localStorage.getItem(key) !== null) window.localStorage.removeItem(key);
    }
    return normalizeBridgeUrl(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Build-environment override. `VITE_` is REQUIRED for browser code in Vite. */
function envBridgeUrl(): string | null {
  try {
    const env = import.meta.env as Record<string, unknown>;
    return normalizeBridgeUrl(env["VITE_MT5_BRIDGE_URL"]) ?? normalizeBridgeUrl(env["VITE_BRIDGE_URL"]);
  } catch {
    return null;
  }
}

/** The address in use right now — every request reads this, never a snapshot. */
let activeBridgeUrl: string = readCachedBridgeUrl() ?? envBridgeUrl() ?? DEFAULT_BRIDGE_URL;

export function getBridgeUrl(): string {
  return activeBridgeUrl;
}

/** Remember an address on this device and make it the one requests use. */
export function setBridgeUrl(value: string): string | null {
  const url = normalizeBridgeUrl(value);
  if (!url) return null;
  activeBridgeUrl = url;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* storage full/blocked — this session still uses the address */
    }
  }
  return url;
}

/** Host only, for messages that should stay short. */
export function bridgeHost(url: string = activeBridgeUrl): string {
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
 * TEST BRIDGE — `GET {bridgeUrl}/scalper/status` with a 10 s bound.
 *
 * Three outcomes, and nothing else: OK, an HTTP error with its real code, or
 * unreachable with the real reason. A CORS refusal and a dead hostname are
 * different answers, so the opaque `TypeError` is probed once more without CORS
 * to find out which one it was.
 */
export async function testBridgeConnection(input?: string): Promise<BridgeTestResult> {
  const normalized = input === undefined ? getBridgeUrl() : normalizeBridgeUrl(input);
  if (!normalized) {
    return { kind: "unreachable", url: (input ?? "").trim(), reason: "that is not a valid http(s) address" };
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(`${normalized}/scalper/status`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", "x-bridge-key": BRIDGE_KEY },
      signal: AbortSignal.timeout(BRIDGE_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "http", url: normalized, status: response.status };
    return { kind: "ok", url: normalized, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const reason = describeBridgeFailure(error, BRIDGE_PROBE_TIMEOUT_MS);
    if (!reason.startsWith("network unreachable")) {
      return { kind: "unreachable", url: normalized, reason };
    }
    const answers = await probeHostAnswers(normalized);
    return {
      kind: "unreachable",
      url: normalized,
      reason: answers
        ? "the address answered but blocked the request (CORS) — check the bridge's allowed origins"
        : "DNS/hostname not found, connection refused or TLS error",
    };
  }
}

/**
 * WHICH ADDRESS FAILED — logged and shown, so "Failed to fetch" can never again
 * hide whether the app was calling the right bridge, and a timeout is never
 * reported as the wrong reason.
 */
export function bridgeUnreachableMessage(error?: unknown): string {
  const url = getBridgeUrl();
  const reason = error === undefined || error === null || error === "" ? "" : describeBridgeFailure(error);
  return `Could not reach the trading bridge at ${url}${reason ? ` (${reason})` : ""} — check the connection and that bridge.py is running.`;
}

/** One in-flight read of the server-side setting, shared by every caller. */
let configLoad: Promise<string> | null = null;

/**
 * READ THE ADMIN-SET ADDRESS — once per app start (and on demand).
 *
 * `enabled: false`-style silence: a host with no `/api/bridge-config` (plain
 * static preview) answers HTML, which is not an answer, so the device keeps the
 * address it already has instead of being pointed at nothing.
 */
export function loadBridgeConfig(): Promise<string> {
  if (!isBrowser()) return Promise.resolve(activeBridgeUrl);
  if (configLoad) return configLoad;
  // THE DEVICE SETTING WINS. An address typed into Settings is the trader's
  // explicit choice, so the admin-set KV value is only adopted when this device
  // has never saved one — otherwise a stale server value would silently
  // overwrite the tunnel the user just fixed.
  if (readCachedBridgeUrl()) return Promise.resolve(activeBridgeUrl);
  const run = (async () => {
    try {
      const reply = await fetch("/api/bridge-config", {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!reply.ok) return activeBridgeUrl;
      const payload = (await reply.json().catch(() => null)) as { ok?: boolean; url?: unknown } | null;
      if (!payload || payload.ok !== true) return activeBridgeUrl;
      const url = normalizeBridgeUrl(payload.url);
      if (url) setBridgeUrl(url);
    } catch {
      /* offline / no endpoint — keep the current address */
    }
    return activeBridgeUrl;
  })();
  configLoad = run;
  return run.finally(() => {
    configLoad = null;
  });
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
