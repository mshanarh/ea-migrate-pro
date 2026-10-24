import { describe, it, expect, afterEach, vi } from "vitest";
import { executeAutoTrade, preserveEaName } from "../src/lib/auto-trade";
import { mt5OrderComment } from "../src/lib/utils";
import { pullbackSeries } from "./breakout-fixtures";

/**
 * THE ORDER COMMENT MUST REACH THE BRIDGE UNCHANGED.
 *
 * These are end-to-end assertions, not tautologies: the app's LIVE execution
 * engine (`executeAutoTrade` with saved credentials) is driven with a mocked
 * `fetch`, and the captured body of POST {BRIDGE}/trade/execute is inspected.
 * That body is literally what the bridge hands to MT5 as the order comment, so
 * it is the right place to prove "sniper killer ea v2+" is sent as
 * "sniper killer ea v2+" — no stripping, no space collapsing, no 31-character
 * cap and no brand fallback.
 */

const EA_NAME = "sniper killer ea v2+";

const CREDENTIALS = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

type Captured = { url: string; body: Record<string, unknown> };
type BridgeReply = { status?: number; payload: Record<string, unknown> };

/**
 * A live AUDUSD market the ENTRY FILTER allows: a gentle drift, a pullback
 * into the 20-candle average and a completed bullish candle. (A vertical
 * breakout is refused now — that is the point of the filter — so these
 * order-comment tests use a tradeable series.)
 */
const FIXTURE = pullbackSeries({ direction: "BUY", base: 0.655, forming: true });
const QUOTE = { bid: FIXTURE.bid, ask: FIXTURE.ask, digits: 5, point: 0.00001, stops_level: 0 };
const CANDLES = FIXTURE.candles;

/**
 * Stub the bridge: /symbol/candles returns the breakout series, /symbol/price
 * the live quote and /trade/execute the broker's verdict. Every request body is
 * captured for assertions.
 */
function stubBridge(tradeReply: BridgeReply): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url: target, body });
      if (target.endsWith("/symbol/candles")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, candles: CANDLES }) } as unknown as Response;
      }
      const isQuote = target.endsWith("/symbol/price");
      const status = isQuote ? 200 : (tradeReply.status ?? 200);
      return {
        ok: status < 400,
        status,
        json: async () => (isQuote ? { success: true, ...QUOTE } : tradeReply.payload),
      } as unknown as Response;
    }),
  );
  return captured;
}

/** Run the app's live engine once and return both the results and the requests. */
async function runOneLiveTrade(tradeReply: BridgeReply, eaName: string = EA_NAME) {
  const captured = stubBridge(tradeReply);
  const results = await executeAutoTrade({
    symbol: "AUDUSD",
    lotSize: 0.01,
    maxTrades: 1,
    eaName,
    credentials: CREDENTIALS,
  });
  const order = captured.find((request) => request.url.endsWith("/trade/execute"));
  return { results, order };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MT5 order comment — app request to the bridge", () => {
  it(`sends "${EA_NAME}" to the bridge verbatim`, async () => {
    const { order } = await runOneLiveTrade({ payload: { retcode: 10009, order: 555123 } });

    expect(order, "the app must POST an order to the bridge").toBeDefined();
    // The exact string the broker receives — every character intact.
    expect(order!.body["comment"]).toBe(EA_NAME);
    expect(order!.body["comment"]).toHaveLength(EA_NAME.length);
    expect(order!.body["comment"]).toContain("+");
    expect(String(order!.body["comment"])).not.toMatch(/^\s|\s$/);
  });

  it("keeps spaces, version text and plus signs for other names too", async () => {
    const names = [
      "sniper killer ea v2+",
      "EA Cloud Pro v3.0",
      "robot magic + scalper (ver 1)",
      "  leading and trailing  ",
      "a".repeat(64),
    ];

    for (const name of names) {
      const { order } = await runOneLiveTrade({ payload: { retcode: 10009, order: 1 } }, name);
      expect(order!.body["comment"]).toBe(name);
      vi.unstubAllGlobals();
    }
  });

  it("records the exact requested name on the trade", async () => {
    const { results } = await runOneLiveTrade({ payload: { retcode: 10009, order: 555123 } });

    const filled = results.find((trade) => trade.status === "executed");
    expect(filled?.meta?.requestedComment).toBe(EA_NAME);
    // What we sent is what the record keeps — the name stands.
    expect(filled?.meta?.actualComment).toBe(EA_NAME);
  });

  it("never compares or warns about the broker's own echoed comment", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The broker echoed its own comment instead of the requested name —
    // brokers do this constantly, so the app must not treat it as a problem.
    const { results } = await runOneLiveTrade({
      payload: { retcode: 10009, order: 555123, comment: "sniper killer ea v2" },
    });

    const filled = results.find((trade) => trade.status === "executed");
    expect(filled?.status).toBe("executed");
    // The fill line is the plain success message — no ⚠, no comment text.
    expect(filled?.message).toBe("Trade 1/1 executed on MetaTrader");
    expect(filled?.message).not.toContain("broker applied the comment");
    // Nothing about a comment mismatch is ever logged as a warning.
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toMatch(/comment/i);
    warn.mockRestore();
  });

  it("refuses to place an order with a substituted comment when the broker rejects it", async () => {
    const { results } = await runOneLiveTrade({
      status: 400,
      payload: { detail: "Invalid comment" },
    });

    // No silent retry under a stripped/stamped name — the run stops and says
    // which comment was refused.
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.message).toContain(EA_NAME);
  });
});

describe("mt5OrderComment / preserveEaName — the single source of truth", () => {
  it("returns the configured name untouched", () => {
    expect(mt5OrderComment(EA_NAME)).toBe(EA_NAME);
    expect(preserveEaName(EA_NAME)).toBe(EA_NAME);
  });

  it("never rewrites spaces, case, punctuation or length", () => {
    const name = "Sniper  Killer  EA   v2+ (Pro) [XAUUSD]";
    expect(mt5OrderComment(name)).toBe(name);
    expect(mt5OrderComment(name)).not.toBe(name.replace(/[^A-Za-z0-9 ]/g, ""));
    expect(mt5OrderComment("a".repeat(40))).toHaveLength(40);
  });

  it("collapses only a missing name to an empty comment", () => {
    expect(mt5OrderComment(undefined)).toBe("");
    expect(mt5OrderComment(null)).toBe("");
    expect(mt5OrderComment("")).toBe("");
  });
});
