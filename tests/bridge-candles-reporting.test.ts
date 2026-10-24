import { afterEach, describe, expect, it, vi } from "vitest";
import { CANDLE_RETRY_DELAY_MS, resolveTradeDirection, type BridgeCredentials } from "../src/lib/auto-trade";
import { bridgeSeries, type Candle } from "./breakout-fixtures";

/**
 * BRIDGE CANDLE REPORTING — a 200 with no usable payload must never be
 * reported as "HTTP 200".
 *
 * The app now logs the exact symbol it sent, the timeframe and the raw
 * response summary (or the bridge's own error), accepts the candle array
 * wherever the bridge nests it, retries once two seconds later under the
 * broker's resolved symbol, and only then refuses with NO TRADE.
 */

const CREDENTIALS: BridgeCredentials = {
  login: 12345678,
  password: "super-secret",
  server: "Exness-MT5Real8",
};

type Captured = { url: string; body: Record<string, unknown> };

/** The breakout series a broker would serve for a BUY (range 100–110). */
const SERIES = bridgeSeries({ low: 100, high: 110, breakoutClose: 112 });

type BridgeScript = {
  /** One candle payload per candle request, in order. The last entry repeats. */
  candleReplies: unknown[];
  /** The quote payload (the working quote path). */
  quote?: Record<string, unknown>;
};

function stubBridge(script: BridgeScript): Captured[] {
  const captured: Captured[] = [];
  let candleCall = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url: target, body });
      if (target.endsWith("/symbol/candles")) {
        const reply = script.candleReplies[Math.min(candleCall, script.candleReplies.length - 1)];
        candleCall += 1;
        return { ok: true, status: 200, json: async () => reply } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          bid: 112.4,
          ask: 112.5,
          digits: 2,
          point: 0.01,
          stops_level: 0,
          ...(script.quote ?? {}),
        }),
      } as unknown as Response;
    }),
  );
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("candle payload shapes", () => {
  it("reads candles nested under a data key", async () => {
    stubBridge({ candleReplies: [{ ok: true, data: { candles: SERIES } }] });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    expect(result.setup?.lastClose).toBe(112);
  });

  it("reads MT5-style tuple rows served under `rates`", async () => {
    const tuples = SERIES.map((candle: Candle) => [
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]);
    stubBridge({ candleReplies: [{ success: true, rates: tuples }] });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
    expect(result.setup?.lastClose).toBe(112);
  });

  it("reads a bare array payload", async () => {
    stubBridge({ candleReplies: [SERIES] });

    const result = await resolveTradeDirection("XAUUSD", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("BUY");
  });
});

describe("zero candles ARE reported as zero candles", () => {
  it("says the bridge returned 0 candles — never a bare HTTP 200", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const captured = stubBridge({ candleReplies: [{ ok: true, candles: [] }] });

    const result = await resolveTradeDirection("HW_100", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("NO_TRADE");
    const reason = result.direction.type === "NO_TRADE" ? result.direction.reason : "";

    // The exact symbol, the timeframe and the raw summary are all in the
    // message the card shows.
    expect(reason).toContain("HW_100");
    expect(reason).toContain("15m");
    expect(reason).toContain("bridge returned 0 candles");
    expect(reason).toContain("Missing or unavailable broker data");
    // Attempt 1 also failed, so the reported attempt is the retry.
    expect(reason).toContain("attempt 2");
    expect(reason).not.toMatch(/candles for HW_100 — attempt 2: HTTP 200\./);

    // Exactly one retry: two candle requests, no more.
    const candleRequests = captured.filter((request) => request.url.endsWith("/symbol/candles"));
    expect(candleRequests).toHaveLength(2);
    expect(candleRequests.every((request) => request.body["timeframe"] === "15m")).toBe(true);

    // ONE diagnostic line per request with the exact symbol and summary.
    const requestLines = logs.filter((line) => line.includes("[auto-trade] candles →"));
    expect(requestLines).toHaveLength(2);
    expect(requestLines[0]).toContain("symbol HW_100 | timeframe 15m | attempt 1");
    expect(requestLines[0]).toContain("bridge returned 0 candles");
  }, 15_000);

  it("keeps the bridge's own error text in the refusal", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubBridge({
      candleReplies: [
        {
          success: false,
          message: "bridge returned 0 candles: MT5 has no 15m history for USTEC",
        },
      ],
    });

    const result = await resolveTradeDirection("HW_100", { credentials: CREDENTIALS });

    expect(result.direction.type).toBe("NO_TRADE");
    const reason = result.direction.type === "NO_TRADE" ? result.direction.reason : "";
    expect(reason).toContain("MT5 has no 15m history for USTEC");
    expect(reason).toContain("bridge said");
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("retrying once");
  }, 15_000);
});

describe("one retry after the broker resolves the symbol", () => {
  it(`retries once after ${CANDLE_RETRY_DELAY_MS}ms and uses the broker's own symbol`, async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const captured = stubBridge({
      // Empty on the first attempt, the real series once the broker's name is used.
      candleReplies: [{ ok: true, candles: [] }, { ok: true, candles: SERIES }],
      quote: { symbol: "USTEC" },
    });

    const startedAt = Date.now();
    const result = await resolveTradeDirection("HW_100", { credentials: CREDENTIALS });
    const elapsed = Date.now() - startedAt;

    // The retry waits the full delay before asking again.
    expect(elapsed).toBeGreaterThanOrEqual(CANDLE_RETRY_DELAY_MS - 100);

    // The recovery is real: the analysis proceeds on the retried series.
    expect(result.direction.type).toBe("BUY");
    expect(result.symbol).toBe("HW_100");

    const candleRequests = captured.filter((request) => request.url.endsWith("/symbol/candles"));
    expect(candleRequests).toHaveLength(2);
    expect(candleRequests[0]!.body["symbol"]).toBe("HW_100");
    expect(candleRequests[1]!.body["symbol"]).toBe("USTEC");
  }, 15_000);
});
