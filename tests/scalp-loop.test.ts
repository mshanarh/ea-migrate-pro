import { describe, it, expect, afterEach, vi } from "vitest";
import { pullbackSeries } from "./breakout-fixtures";

/**
 * THE LOOP MUST TRADE WITHOUT THE POSITION ENDPOINTS.
 *
 * The VPS bridge does not have `/positions/list` or `/positions/close` yet, and
 * an early version of the loop aborted the whole pass when the list call
 * failed — so pressing START showed the mode toast and then did nothing at all.
 * These assertions drive the real loop against a bridge that answers the candle
 * / price / order endpoints and 404s the position ones, and prove that:
 *
 *   • an order IS sent (the bot starts trading),
 *   • the missing endpoint is announced instead of silently swallowed,
 *   • normal mode does not need the position endpoints at all.
 */

const CREDENTIALS = { login: 12345678, password: "secret", server: "Exness-MT5Real8" };
const FIXTURE = pullbackSeries({ direction: "BUY", base: 0.655, forming: true });
const QUOTE = { bid: FIXTURE.bid, ask: FIXTURE.ask, digits: 5, point: 0.00001, stops_level: 0 };

type Captured = { url: string; body: Record<string, unknown> };

function stubBridge(options: { positionsStatus: number }): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url: target, body });

      if (target.endsWith("/symbol/candles")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, candles: FIXTURE.candles }) } as unknown as Response;
      }
      if (target.endsWith("/symbol/price")) {
        return { ok: true, status: 200, json: async () => ({ success: true, ...QUOTE }) } as unknown as Response;
      }
      if (target.endsWith("/positions/list")) {
        return {
          ok: options.positionsStatus < 400,
          status: options.positionsStatus,
          json: async () =>
            options.positionsStatus < 400
              ? { success: true, positions: [] }
              : { detail: "Not Found" },
        } as unknown as Response;
      }
      if (target.endsWith("/trade/execute")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, retcode: 10009, order: 4242, price: QUOTE.ask }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }),
  );
  return captured;
}

const messages: string[] = [];

function listen() {
  messages.length = 0;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message?: string } | undefined;
    if (detail?.message) messages.push(detail.message);
  };
  window.addEventListener("eamp:execution-result", handler);
  return () => window.removeEventListener("eamp:execution-result", handler);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bot loop — starts trading when the position endpoints are missing", () => {
  it("opens an order and says monitoring is unavailable instead of going silent", async () => {
    const captured = stubBridge({ positionsStatus: 404 });
    const stopListening = listen();
    const { startScalpLoop } = await import("../src/lib/scalp-loop");

    const handle = startScalpLoop({
      symbols: [{ symbol: "AUDUSD", lotSize: 0.01, maxTrades: 1 }],
      eaName: "Apex sniper pro V6+",
      credentials: CREDENTIALS,
      mode: "scalper",
    });

    await vi.waitFor(
      () => {
        expect(captured.some((request) => request.url.endsWith("/trade/execute"))).toBe(true);
      },
      { timeout: 8_000 },
    );

    handle.stop();
    stopListening();

    // The order carried the loop's own magic, so it can be told apart later.
    const order = captured.find((request) => request.url.endsWith("/trade/execute"))!;
    expect(order.body["magic"]).toBe(26102401);
    // The missing endpoint was reported, not swallowed.
    expect(messages.join(" | ")).toContain("Position monitoring unavailable");
  }, 15_000);

  it("normal mode trades with no position endpoint at all", async () => {
    const captured = stubBridge({ positionsStatus: 404 });
    const stopListening = listen();
    const { startScalpLoop } = await import("../src/lib/scalp-loop");

    const handle = startScalpLoop({
      symbols: [{ symbol: "AUDUSD", lotSize: 0.01, maxTrades: 1 }],
      eaName: "Apex sniper pro V6+",
      credentials: CREDENTIALS,
      mode: "normal",
    });

    await vi.waitFor(
      () => {
        expect(captured.some((request) => request.url.endsWith("/trade/execute"))).toBe(true);
      },
      { timeout: 8_000 },
    );

    handle.stop();
    stopListening();

    // Normal mode never asks for a close.
    expect(captured.some((request) => request.url.endsWith("/positions/close"))).toBe(false);
  }, 15_000);
});
