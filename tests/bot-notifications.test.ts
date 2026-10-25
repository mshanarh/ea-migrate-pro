import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * THE NOTIFICATION WORDING, EXACTLY AS SPECIFIED.
 *
 * The Android side splits the payload on the first newline: line 1 is the
 * title, the rest is the body. Every assertion below therefore reads the BODY
 * from the second line and checks the title separately.
 */

const sent: Array<{ title: string; text: string }> = [];

function bodies(): string[] {
  return sent.map((entry) => entry.text.split("\n").slice(1).join("\n"));
}

beforeEach(async () => {
  sent.length = 0;
  (window as unknown as { EAMigrate: unknown }).EAMigrate = {
    showTradeNotification: (title: string, text: string) => sent.push({ title, text }),
  };
  const notify = await import("../src/lib/bot-notify");
  notify.beginBotSession();
});

describe("bot notifications", () => {
  it("opens with the trade number, direction, symbol, lots and real entry price", async () => {
    const { notifyTradeOpened, reserveTradeNumber } = await import("../src/lib/bot-notify");

    notifyTradeOpened({
      number: reserveTradeNumber(),
      side: "BUY",
      symbol: "BTCUSDm",
      lotSize: 0.01,
      price: 80556.1,
    });

    expect(sent[0]!.title).toBe("EA Migrate");
    expect(bodies()[0]).toBe("Trade 1 opened — BUY BTCUSDm 0.01 lots @ 80556.1");
  });

  it("closes with the same number the open was given", async () => {
    const { describeClose } = await import("../src/lib/bot-notify");

    expect(describeClose({ number: 1, profit: 0.45 })).toBe("Trade 1 closed — profit +$0.45");
    expect(describeClose({ number: 2, profit: -0.3, outcome: "stop-loss" })).toBe(
      "Trade 2 closed — stop loss -$0.30",
    );
    // No reported result → the level is named and NO amount is invented.
    expect(describeClose({ number: 3, outcome: "stop-loss" })).toBe("Trade 3 closed — stop loss");
  });

  it("combines a scalper close and the trade that followed into ONE alert", async () => {
    const { notifyCloseThenOpen } = await import("../src/lib/bot-notify");

    notifyCloseThenOpen(
      { number: 1, profit: 0.45 },
      [{ number: 2, side: "BUY", symbol: "BTCUSDm", lotSize: 0.01, price: 80556.1 }],
    );

    expect(sent).toHaveLength(1);
    expect(bodies()[0]).toBe(
      "Trade 1 closed — profit +$0.45. Trade 2 opened — BUY BTCUSDm 0.01 lots @ 80556.1",
    );
  });

  it("names the mode and the symbols on start, and says Bot stopped on stop", async () => {
    const { notifyBotStarted, notifyBotStopped } = await import("../src/lib/bot-notify");

    notifyBotStarted("scalper", ["BTCUSDm"]);
    notifyBotStarted("normal", ["BTCUSDm", "XAUUSD"]);
    notifyBotStopped();

    expect(bodies()[0]).toBe("Bot started — Scalper mode, watching BTCUSDm");
    expect(bodies()[1]).toBe("Bot started — Normal mode, watching BTCUSDm, XAUUSD");
    expect(bodies()[2]).toBe("Bot stopped");
  });

  it("names the exact hard block, once per symbol and reason", async () => {
    const { notifyTradeSkipped } = await import("../src/lib/bot-notify");

    expect(notifyTradeSkipped("BTCUSDm", "Free margin 12.40 is below the 20% buffer for this order.")).toBe(
      true,
    );
    expect(notifyTradeSkipped("BTCUSDm", "Free margin 12.40 is below the 20% buffer for this order.")).toBe(
      false,
    );

    expect(bodies()[0]).toBe("Trade skipped — not enough free margin");
    expect(sent).toHaveLength(1);
  });

  it("restarts the numbering with every bot session", async () => {
    const { notifyTradeOpened, reserveTradeNumber, beginBotSession } = await import(
      "../src/lib/bot-notify"
    );

    const first = reserveTradeNumber();
    notifyTradeOpened({ number: first, side: "SELL", symbol: "XAUUSD", lotSize: 0.01, price: 2650.4 });
    beginBotSession();
    const second = reserveTradeNumber();
    notifyTradeOpened({ number: second, side: "BUY", symbol: "BTCUSDm", lotSize: 0.01, price: 80556.1 });

    expect(bodies()[0]).toMatch(/^Trade 1 opened/);
    expect(bodies()[1]).toMatch(/^Trade 1 opened/);
  });
});
