import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingSignal,
  confirmPendingSignal,
  invalidatePendingSignal,
  peekPendingSignal,
  publishPendingSignal,
  resetPendingSignal,
  takeConfirmedPendingSignal,
  type PendingSignal,
} from "@/lib/pending-signal";

/**
 * THE CARD THAT FOLLOWS THE TRADER INTO METATRADER.
 *
 * The trader has to leave the app to watch the chart, so the held signal is
 * pushed to the Android overlay (`showTradeAnalysis`) — the rounded card that
 * draws OVER MetaTrader — and the overlay's EXECUTE tap comes back as
 * `eamp:native-execute` and must count as the trader's confirmation, exactly
 * once, only for the signal that is still waiting.
 *
 * These assertions pin that contract:
 *   • a held signal is pushed to the floating card, with the levels the card
 *     draws;
 *   • an unchanged refresh does not redraw it (a card rebuilt every pass would
 *     flicker and drop a drag mid-read);
 *   • a tap confirms the held signal ONCE — a double tap can never place two
 *     orders for one decision;
 *   • a tap from a stale card (a different symbol, or an invalidated signal)
 *     confirms nothing;
 *   • the card comes down when the signal is confirmed, invalidated or cleared.
 */

const SIGNAL: PendingSignal = {
  symbol: "BTCUSDm",
  direction: "BUY",
  entry: 80240,
  stopLoss: 79960,
  takeProfit: 80510,
  lotSize: 0.01,
  trades: 2,
  mode: "scalper",
  robotName: "Apex Sniper",
  reason: "the last 8 completed M15 candles read BUY",
  state: "ready",
  updatedAt: 1_700_000_000_000,
};

type Call = { method: string; payload: Record<string, unknown> | null };

function stubBridge(): Call[] {
  const calls: Call[] = [];
  (window as unknown as { EAMigrate?: unknown }).EAMigrate = {
    showTradeAnalysis: vi.fn((json: string) => {
      calls.push({ method: "showTradeAnalysis", payload: JSON.parse(json) as Record<string, unknown> });
    }),
    hideTradeAnalysis: vi.fn(() => {
      calls.push({ method: "hideTradeAnalysis", payload: null });
    }),
  };
  return calls;
}

/** The overlay's Execute button handing the tap back to the page. */
function tapFloatingExecute(symbol: string): void {
  window.dispatchEvent(new CustomEvent("eamp:native-execute", { detail: { ...SIGNAL, symbol } }));
}

beforeEach(() => {
  resetPendingSignal();
});

afterEach(() => {
  resetPendingSignal();
  delete (window as unknown as { EAMigrate?: unknown }).EAMigrate;
});

describe("the held signal and the floating card over MetaTrader", () => {
  it("floats the signal the moment it is held, with the levels the card draws", () => {
    const calls = stubBridge();
    publishPendingSignal(SIGNAL);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("showTradeAnalysis");
    expect(calls[0]!.payload).toMatchObject({
      symbol: "BTCUSDm",
      direction: "BUY",
      entry: 80240,
      stopLoss: 79960,
      takeProfit1: 80510,
      takeProfit2: 80510,
      lotSize: 0.01,
      trades: 2,
    });
  });

  it("does not redraw the card while the signal is unchanged, but does when it moves", () => {
    const calls = stubBridge();
    publishPendingSignal(SIGNAL);
    // The loop republishes its held signal every pass to keep the age current.
    publishPendingSignal({ ...SIGNAL, updatedAt: Date.now() });
    publishPendingSignal({ ...SIGNAL, updatedAt: Date.now() });
    expect(calls.filter((call) => call.method === "showTradeAnalysis")).toHaveLength(1);

    // The candles moved the levels: the trader is shown the MOVED signal.
    publishPendingSignal({ ...SIGNAL, entry: 80310, updatedAt: Date.now() });
    const shown = calls.filter((call) => call.method === "showTradeAnalysis");
    expect(shown).toHaveLength(2);
    expect(shown[1]!.payload).toMatchObject({ entry: 80310 });
  });

  it("turns the overlay's Execute tap into one confirmation, and only one", () => {
    const calls = stubBridge();
    publishPendingSignal(SIGNAL);

    tapFloatingExecute("BTCUSDm");

    expect(peekPendingSignal()?.state).toBe("confirmed");
    // The card goes down as the order goes out.
    expect(calls.at(-1)!.method).toBe("hideTradeAnalysis");

    const settled = takeConfirmedPendingSignal();
    expect(settled?.symbol).toBe("BTCUSDm");
    expect(settled?.direction).toBe("BUY");
    expect(settled?.lotSize).toBe(0.01);
    expect(settled?.trades).toBe(2);
    // CONSUMED — a second pass (or a second tap) cannot place another order.
    expect(takeConfirmedPendingSignal()).toBeNull();
    expect(peekPendingSignal()).toBeNull();
  });

  it("ignores a tap from a card showing a different signal", () => {
    stubBridge();
    publishPendingSignal(SIGNAL);

    tapFloatingExecute("XAUUSD");

    expect(peekPendingSignal()?.state).toBe("ready");
    expect(takeConfirmedPendingSignal()).toBeNull();
  });

  it("withdraws Execute when the market moves off the signal", () => {
    const calls = stubBridge();
    publishPendingSignal(SIGNAL);

    invalidatePendingSignal("the live candles no longer support this signal — NO TRADE: weak setup");

    expect(peekPendingSignal()?.state).toBe("invalid");
    expect(peekPendingSignal()?.invalidReason).toContain("weak setup");
    // The card is off the screen and a tap on it confirms nothing.
    expect(calls.at(-1)!.method).toBe("hideTradeAnalysis");
    tapFloatingExecute("BTCUSDm");
    expect(takeConfirmedPendingSignal()).toBeNull();
    expect(peekPendingSignal()?.state).toBe("invalid");
  });

  it("takes the card down when the session drops the signal", () => {
    const calls = stubBridge();
    publishPendingSignal(SIGNAL);
    clearPendingSignal();

    expect(peekPendingSignal()).toBeNull();
    expect(calls.at(-1)!.method).toBe("hideTradeAnalysis");
    // Nothing left to confirm — Stop must never leave an order one tap away.
    expect(confirmPendingSignal()).toBeUndefined();
    expect(takeConfirmedPendingSignal()).toBeNull();
  });
});
