/**
 * SCALPER MODE'S ONLY TRADING PATH IS THE VPS DAEMON.
 *
 * The scalper no longer runs in the browser. `scalper_daemon.py` on the machine
 * that holds MetaTrader (started by bridge.py) owns the whole cycle — analyse,
 * open the batch, sweep-close it, re-analyse, repeat — and the bridge at
 * BRIDGE_BASE_URL only switches it on and off:
 *
 *   POST /scalper/start   { symbol, lot, trade_count }
 *   POST /scalper/stop    {}                       (FastAPI requires a body)
 *   GET  /scalper/status  → { running, symbol, lot, trade_count, log, … }
 *
 * So pressing Scalper Start sends ONE request to /scalper/start and nothing
 * else: no /trade/execute, no browser-side loop, no order from the phone. A
 * "started" claim is only ever made from a 200 answer here, and the button's
 * state is read back from /scalper/status rather than remembered locally.
 *
 * THE BODY IS EXACTLY WHAT THE BRIDGE ACCEPTS. `/scalper/start` carries one
 * flat trio — `symbol`, `lot`, `trade_count`. Several Allowed Quotes travel as
 * a comma-joined `symbol`, which is the shape the daemon's own flat fallback
 * splits (it then applies that one lot/count to every listed symbol). The
 * per-symbol overrides live in the daemon's settings file; they are not part of
 * the bridge contract, so this client never pretends to send them.
 */
import { BRIDGE_KEY, bridgeHost, bridgeUnreachableMessage, getBridgeUrl } from "./bridge-client";

/** One Allowed Quotes entry reduced to what the bridge can carry. */
export type ScalperQuotePlan = { symbol: string; lot: number; trades: number };

export type ScalperStartResult =
  | { ok: true; message: string; symbols: string[]; lot: number; trades: number }
  | { ok: false; error: string };

export type ScalperStopResult = { ok: true; message: string } | { ok: false; error: string };

export type ScalperDaemonStatus = {
  running: boolean;
  /** The daemon's own banner version ("3.1"), read from its event log. */
  version: string | null;
  symbols: string[];
  lot: number | null;
  trades: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  positions: number;
  /** The most recent line the daemon wrote — its real, current activity. */
  message: string;
};

export type ScalperStatusResult =
  | { ok: true; status: ScalperDaemonStatus }
  | { ok: false; error: string };

/** A phone on mobile data over a cloudflared tunnel; still a bounded wait. */
const TIMEOUT_MS = 20_000;

const VERSION_IN_LOG = /DAEMON (?:STARTED )?v(\d+(?:\.\d+)*)/i;

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The bridge's human reason, wherever FastAPI put it. */
function payloadDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["message", "detail", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0) {
      // FastAPI validation errors: [{ loc: [...], msg: "..." }]
      const first = value[0];
      if (first && typeof first === "object") {
        const msg = (first as Record<string, unknown>)["msg"];
        if (typeof msg === "string" && msg.trim()) return msg.trim();
      }
    }
  }
  return "";
}

type BridgeReply = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

/**
 * ONE bridge call. A non-200 is a FAILURE with the bridge's own words — it is
 * never turned into a success, and the address that answered is logged so a
 * dead tunnel can never again look like a broken button.
 */
async function callBridge(path: string, init: RequestInit): Promise<BridgeReply> {
  const url = `${getBridgeUrl()}${path}`;
  const method = init.method ?? "GET";
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const record =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const detail = payloadDetail(payload);
    if (!response.ok) {
      const suffix = response.status === 401 ? " (bridge key rejected)" : "";
      console.warn(`[scalper] ${method} ${url} → ${response.status} ${detail}${suffix}`);
      return {
        ok: false,
        error: `${path} answered ${response.status}${detail ? ` — ${detail}` : ""}${suffix}`,
      };
    }
    console.info(`[scalper] ${method} ${url} → ${response.status}`);
    return { ok: true, payload: record };
  } catch (error) {
    const message = (error as Error)?.message ?? "request failed";
    console.warn(`[scalper] ${method} ${url} failed: ${message} (bridge ${bridgeHost()})`);
    return { ok: false, error: bridgeUnreachableMessage(message) };
  }
}

/**
 * Allowed Quotes → the plan the daemon can run. A quote without a symbol or
 * without a trade count above 0 is skipped: the bridge cannot express "0
 * trades", and silently turning that into one trade would fire an order the
 * trader never configured.
 */
export function planFromAllowedQuotes(
  pairs: Array<{ symbol?: string; lotSize?: string; maxTrades?: string }>,
): ScalperQuotePlan[] {
  const plans: ScalperQuotePlan[] = [];
  for (const pair of pairs) {
    const symbol = (pair.symbol ?? "").trim();
    if (!symbol) continue;
    const trades = Number.parseInt(String(pair.maxTrades ?? ""), 10);
    if (!Number.isFinite(trades) || trades < 1) continue;
    const lot = Number(pair.lotSize);
    plans.push({ symbol, lot: Number.isFinite(lot) && lot > 0 ? lot : 0.01, trades });
  }
  return plans;
}

/** START THE VPS DAEMON — the only thing Scalper Start is allowed to send. */
export async function startScalperOnBridge(plans: ScalperQuotePlan[]): Promise<ScalperStartResult> {
  if (plans.length === 0) {
    return {
      ok: false,
      error:
        "No Allowed Quote has a trade count above 0 — set Number of Trades in Quotes before starting the scalper.",
    };
  }
  const primary = plans[0]!;
  const symbols = plans.map((plan) => plan.symbol);
  const body = {
    symbol: symbols.join(","),
    lot: primary.lot,
    trade_count: primary.trades,
  };
  console.info(
    `[scalper] POST /scalper/start → ${symbols.join(", ")} · lot ${body.lot} · trades ${body.trade_count}`,
  );
  const reply = await callBridge("/scalper/start", { method: "POST", body: JSON.stringify(body) });
  if (!reply.ok) return reply;
  if (reply.payload["ok"] !== true || reply.payload["running"] !== true) {
    return {
      ok: false,
      error:
        payloadDetail(reply.payload) ||
        "The bridge answered but did not report the scalper daemon as running.",
    };
  }
  const message =
    typeof reply.payload["message"] === "string" && reply.payload["message"].trim()
      ? reply.payload["message"].trim()
      : "Scalper daemon started";
  return { ok: true, message, symbols, lot: body.lot, trades: body.trade_count };
}

/** STOP THE VPS DAEMON — only a confirmed 200 counts as stopped. */
export async function stopScalperOnBridge(): Promise<ScalperStopResult> {
  const reply = await callBridge("/scalper/stop", { method: "POST", body: "{}" });
  if (!reply.ok) return reply;
  if (reply.payload["ok"] !== true || reply.payload["running"] !== false) {
    return {
      ok: false,
      error:
        payloadDetail(reply.payload) || "The bridge did not confirm that the daemon stopped.",
    };
  }
  const message =
    typeof reply.payload["message"] === "string" && reply.payload["message"].trim()
      ? reply.payload["message"].trim()
      : "Scalper daemon stopped";
  return { ok: true, message };
}

/** THE REAL STATE — running/idle, version and the daemon's last line. */
export async function fetchScalperStatus(): Promise<ScalperStatusResult> {
  const reply = await callBridge("/scalper/status", { method: "GET" });
  if (!reply.ok) return reply;
  const payload = reply.payload;
  const log = Array.isArray(payload["log"])
    ? (payload["log"] as unknown[]).filter((line): line is string => typeof line === "string")
    : [];
  let version: string | null = null;
  for (let index = log.length - 1; index >= 0 && version === null; index -= 1) {
    const match = VERSION_IN_LOG.exec(log[index] ?? "");
    if (match?.[1]) version = match[1];
  }
  const rawSymbol = typeof payload["symbol"] === "string" ? payload["symbol"] : "";
  const symbols = rawSymbol
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    ok: true,
    status: {
      running: payload["running"] === true,
      version,
      symbols,
      lot: numberOrNull(payload["lot"]),
      trades: numberOrNull(payload["trade_count"]),
      startedAt: stringOrNull(payload["started_at"]),
      stoppedAt: stringOrNull(payload["stopped_at"]),
      positions: numberOrNull(payload["positions_managed"]) ?? 0,
      message: log.length > 0 ? (log[log.length - 1] ?? "") : "",
    },
  };
}
