import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TradeExecutionToast } from "@/components/app/TradeExecutionToast";

/**
 * THE STEPPER RUNS BEFORE THE ANALYSIS.
 *
 * These tests hold the card to its contract: READY + symbol on arrival, the
 * line moving Connect → Terminal → Execute on its own clock, `onComplete`
 * fired exactly once (the parent opens the Signal Analysis card there), and a
 * real bridge answer flipping the last line to "Confirmed on MetaTrader".
 */

// React only flushes `act()` work when it knows it is in a test environment.
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
        totalTrades: 2,
        mode: "auto",
        symbol: "XAUUSD.m",
        ...props,
      }),
    );
  });
}

const text = () => document.body.textContent ?? "";

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

describe("TradeExecutionToast (stepper)", () => {
  it("shows READY, the robot's symbol and the first stage on arrival", () => {
    render();
    expect(text()).toContain("READY");
    expect(text()).toContain("XAUUSD.m");
    expect(text()).toContain("Chart scan");
    expect(text()).toContain("Loading symbol");
    expect(text()).toContain("Connect");
    expect(text()).toContain("Terminal");
    expect(text()).toContain("Execute");
  });

  it("falls back to XAUUSD.m when no symbol is passed", () => {
    render({ symbol: "" });
    expect(text()).toContain("XAUUSD.m");
  });

  it("moves to Terminal after 0.8s and to Execute after another 1.2s", () => {
    const onComplete = vi.fn();
    render({ onComplete });

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(text()).toContain("Linking broker terminal");
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(text()).toContain("Executing trades to MetaTrader");
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Nothing re-fires the hand-over: the analysis card must not be opened
    // again on every later tick.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("confirms on the bridge's real answer and then closes itself", () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: true, message: "TRADE 1/2 EXECUTED" },
        }),
      );
    });
    expect(text()).toContain("Confirmed on MetaTrader");

    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores in-flight progress but reports a refusal", () => {
    render();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message: "CONNECTING TO BROKER..." },
        }),
      );
    });
    expect(text()).toContain("Executing trades to MetaTrader");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message: "TRADE 1 REFUSED — no margin" },
        }),
      );
    });
    expect(text()).toContain("TRADE 1 REFUSED — no margin");
  });

  it("closes from the ✕ button", () => {
    const onClose = vi.fn();
    render({ onClose });
    const close = [...document.querySelectorAll("button")].find((button) =>
      (button.getAttribute("aria-label") ?? "").includes("Close execution"),
    );
    expect(close).toBeTruthy();
    act(() => {
      close!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render({ isOpen: false });
    expect(text()).toBe("");
  });
});
