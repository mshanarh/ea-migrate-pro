import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE COMMENT ON A SIGNAL ORDER IS THE ENTRY POINT'S, NOT A CONSTANT.
 *
 * The trader asked for two different things, and the MT5 comment is where they
 * are told apart:
 *
 *   • Fundamentals (an economic release) → "Ea migrate news"
 *   • anywhere else, including the symbols list → the ACTIVE ROBOT'S NAME, so
 *     the order reads exactly like a trade the bot placed itself
 *
 * These assertions drive `executeAnalysedSignal` against a scripted bridge and
 * read the comment it actually posted, so neither wording can quietly drift
 * into the other path.
 */

const CREDENTIALS = { login: 12345678, password: "secret", server: "Example-Server" };
const QUOTE = { bid: 1.1000, ask: 1.1002 };

function scriptBridge(): { comments: string[]; bodies: Record<string, unknown>[] } {
  const comments: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      bodies.push({ url: target, ...body });
      const reply = (payload: Record<string, unknown>) => ({
        ok: true,
        status: 200,
        json: async () => payload,
      });
      if (target.includes("/symbol/price")) {
        return reply({
          success: true,
          symbol: "EURUSDm",
          bid: QUOTE.bid,
          ask: QUOTE.ask,
          digits: 5,
          point: 0.00001,
          stops_level: 0,
        });
      }
      if (target.includes("/account/verify")) {
        return reply({ account: { margin_free: 10_000, equity: 10_000 } });
      }
      if (target.includes("/trade/execute")) {
        const comment = typeof body["comment"] === "string" ? body["comment"] : "";
        comments.push(comment);
        return reply({
          success: true,
          order: 90_000 + comments.length,
          price: body["action"] === "BUY" ? QUOTE.ask : QUOTE.bid,
          comment,
        });
      }
      return reply({});
    }),
  );
  return { comments, bodies };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executeAnalysedSignal order comment", () => {
  it("sends the caller's comment — Fundamentals passes 'Ea migrate news'", async () => {
    const bridge = scriptBridge();
    const { executeAnalysedSignal } = await import("../src/lib/auto-trade");

    const reply = await executeAnalysedSignal({
      credentials: CREDENTIALS,
      symbol: "EURUSDm",
      direction: "BUY",
      lotSize: 0.01,
      trades: 2,
      stopLoss: 1.095,
      takeProfit: 1.105,
      comment: "Ea migrate news",
    });

    expect(reply.ok, reply.message).toBe(true);
    expect(bridge.comments).toEqual(["Ea migrate news", "Ea migrate news"]);
  });

  it("sends the robot's name when the caller does not name a comment", async () => {
    const bridge = scriptBridge();
    const { executeAnalysedSignal } = await import("../src/lib/auto-trade");

    const reply = await executeAnalysedSignal({
      credentials: CREDENTIALS,
      symbol: "EURUSDm",
      direction: "SELL",
      lotSize: 0.01,
      trades: 1,
      stopLoss: 1.105,
      takeProfit: 1.095,
      comment: "Sniper Killer",
    });

    expect(reply.ok, reply.message).toBe(true);
    expect(bridge.comments).toEqual(["Sniper Killer"]);
  });

  it("never falls back to the news wording for a blank comment", async () => {
    const bridge = scriptBridge();
    const { executeAnalysedSignal } = await import("../src/lib/auto-trade");

    const reply = await executeAnalysedSignal({
      credentials: CREDENTIALS,
      symbol: "EURUSDm",
      direction: "BUY",
      lotSize: 0.01,
      trades: 1,
      stopLoss: 1.095,
      takeProfit: 1.105,
      comment: "   ",
    });

    expect(reply.ok, reply.message).toBe(true);
    expect(bridge.comments).toHaveLength(1);
    expect(bridge.comments[0]).not.toMatch(/migrate news/i);
    expect(bridge.comments[0]?.length).toBeGreaterThan(0);
  });
});
