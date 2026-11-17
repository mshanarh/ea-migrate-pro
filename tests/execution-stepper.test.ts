import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TradeExecutionToast } from "@/components/app/TradeExecutionToast";

/**
 * THE EXECUTION CARD — one popup that names the order.
 *
 * These tests hold it to what the card promises: the side is READ, never
 * assumed (prop first, then the bridge's payload), the "Executing X of Y" line
 * counts real fills, and the three stepper stages advance on their own clock.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(props: Partial<Parameters<typeof TradeExecutionToast>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(TradeExecutionToast, {
        isOpen: true,
        onClose: () => {},
        botName: "MOE V2+",
        totalTrades: 3,
        mode: "auto",
        symbol: "XAUUSD.m",
        direction: null,
        ...props,
      }),
    );
  });
}

const text = () => document.body.textContent ?? "";

function emit(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail }));
  });
}

function clickLabel(label: string) {
  const target = [...document.querySelectorAll("button")].find((element) =>
    (element.getAttribute("aria-label") ?? "").includes(label),
  );
  if (!target) throw new Error(`No button "${label}"`);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

describe("TradeExecutionToast (execution card)", () => {
  it("shows the symbol, READY, a neutral ANALYZING badge and the first stage", () => {
    render();
    expect(text()).toContain("XAUUSD.m");
    expect(text()).toContain("READY");
    expect(text()).toContain("ANALYZING");
    expect(text()).toContain("Market order");
    expect(text()).toContain("Reading broker candles...");
    expect(text()).toContain("Connect");
    expect(text()).toContain("Terminal");
    expect(text()).toContain("Execute");
  });

  it("renders the SELL badge and a sell order when the plan says SELL", () => {
    render({ direction: "SELL" });
    expect(text()).toContain("SELL");
    expect(text()).toContain("Sell order");
    expect(text()).not.toContain("ANALYZING");
  });

  it("renders the BUY badge and a buy order when the plan says BUY", () => {
    render({ direction: "BUY" });
    expect(text()).toContain("BUY");
    expect(text()).toContain("Buy order");
  });

  it("takes the side from the bridge when the plan had not resolved it", () => {
    render({ direction: null });
    expect(text()).toContain("ANALYZING");
    emit({ ok: false, message: "CONNECTING TO BROKER...", side: "SELL" });
    expect(text()).toContain("SELL");
    expect(text()).toContain("Sell order");
  });

  it("holds on Connect while no BUY or SELL exists, however long it is open", () => {
    render({ direction: null, totalTrades: 3 });
    expect(text()).toContain("ANALYZING");
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("0");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    // Still analysing: no "Linking broker terminal", no "Executing …".
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("0");
    expect(text()).not.toContain("Linking broker terminal");
    expect(text()).not.toContain("Executing");
    expect(text()).toContain("ANALYZING");
  });

  it("starts moving the moment a signal arrives on the event bus", () => {
    render({ direction: null, totalTrades: 3 });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("0");

    emit({ status: "info", message: "scanning", side: "BUY" });
    expect(text()).toContain("BUY");
    expect(text()).toContain("Buy order");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("1");
    expect(text()).toContain("Linking broker terminal");

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("2");
    expect(text()).toContain("Executing 1 of 3");
  });

  it("ignores narration so an info line cannot confirm the run", () => {
    render({ direction: "BUY" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    emit({ ok: true, status: "reanalysed", message: "re-analysed: direction now BUY", side: "BUY" });
    expect(text()).not.toContain("Confirmed on MetaTrader");
    expect(document.querySelector("[data-stage]")?.getAttribute("data-stage")).toBe("2");
  });

  it("walks Connect → Terminal → Execute and counts the real fills", () => {
    render({ direction: "BUY" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(text()).toContain("Linking broker terminal");

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(text()).toContain("Executing 1 of 3");

    emit({ ok: false, message: "TRADE 2 EXECUTED", index: 2, total: 3, side: "BUY" });
    expect(text()).toContain("Executing 2 of 3");
    expect(text()).toContain("BUY");
  });

  it("says Executing trades to MetaTrader for a single-trade run", () => {
    render({ totalTrades: 1, direction: "BUY" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(text()).toContain("Executing trades to MetaTrader");
  });

  it("confirms on the bridge's answer and STAYS OPEN until the ✕ is pressed", () => {
    const onClose = vi.fn();
    render({ onClose, direction: "SELL" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    emit({ ok: true, message: "TRADE 1/3 EXECUTED", index: 1, total: 3, side: "SELL" });
    expect(text()).toContain("Confirmed on MetaTrader");

    // The trader is the one who dismisses the report — a full minute of real
    // time must not take the ticket away.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(text()).toContain("Confirmed on MetaTrader");

    clickLabel("Close execution");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal but ignores in-flight progress", () => {
    render({ direction: "SELL" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    emit({ ok: false, message: "CONNECTING TO BROKER..." });
    expect(text()).toContain("Executing 1 of 3");

    emit({ ok: false, message: "TRADE 1 REFUSED — no margin" });
    expect(text()).toContain("TRADE 1 REFUSED — no margin");
  });

  it("closes from the ✕ button and renders nothing when closed", () => {
    const onClose = vi.fn();
    render({ onClose });
    clickLabel("Close execution");
    expect(onClose).toHaveBeenCalled();

    act(() => root?.unmount());
    root = null;
    host?.remove();
    render({ isOpen: false });
    expect(text()).toBe("");
  });
});
