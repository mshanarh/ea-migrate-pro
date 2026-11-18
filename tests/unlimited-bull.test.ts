import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { UnlimitedBull } from "@/components/app/SignatureLayouts";
import { INTERFACE_THEMES } from "@/lib/app-customization";
import { interfaceDefinitionFor } from "@/lib/interface-themes";
import { checkDirectionAgainstCandles } from "@/lib/auto-trade";
import type { Robot } from "@/lib/app-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UNLIMITED BULL — one portrait card, one stadium action bar, the connected
 * robot's own name on two capsules, and every colour from the accent.
 *
 * The second half of this file is the trend fix: a SELL inside a confirmed
 * uptrend is refused even though the last few closes ticked down.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const ROBOT = {
  id: "r1",
  name: "Unlimited Bot",
  image: "https://cdn.example.com/bull-face.jpg",
  running: false,
} as unknown as Robot;

function mount(robot: Robot | undefined, running = false) {
  const onClick = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(UnlimitedBull, {
        robot: robot ? ({ ...robot, running } as Robot) : undefined,
        accent: "#00F5A0",
        onStart: onClick,
        onQuotes: onClick,
        onRemove: onClick,
        onOpenScanner: onClick,
        onOpenAdd: onClick,
      }),
    );
  });
  return onClick;
}

function click(label: string) {
  const target = [...document.querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").toUpperCase().includes(label),
  );
  if (!target) throw new Error(`No button "${label}"`);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("Unlimited Bull", () => {
  it("is offered as an interface style", () => {
    const theme = INTERFACE_THEMES.find((item) => item.id === "UNLIMITED BULL");
    expect(theme).toBeDefined();
    expect(theme!.name).toBe("Unlimited Bull");
  });

  it("is a signature layout, never an InterfaceConsole definition", () => {
    // A definition would hand it a fixed palette and let InterfaceConsole
    // intercept the Home screen; the layout owns the screen instead.
    expect(interfaceDefinitionFor("UNLIMITED BULL")).toBeNull();
    expect(interfaceDefinitionFor("APEX SNIPER")).toBeNull();
  });

  it("renders the note, the robot's own name and the three controls", () => {
    mount(ROBOT);
    const text = document.body.textContent ?? "";
    expect(text).toContain("its time for a change");
    expect(text).toContain("Unlimited Bot");
    expect(text).toContain("DELETE");
    expect(text).toContain("START");
    expect(text).toContain("SYMBOLS");
    expect(text).toContain("Connect EA");
    expect(text).toContain("Connect New License Key");
  });

  it("uses the robot's own picture, never a bundled asset", () => {
    mount(ROBOT);
    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toContain("https://cdn.example.com/bull-face.jpg");
    expect(sources.join(" ")).not.toContain("interface-layout");
  });

  it("falls back to the layout name when no robot is hosted", () => {
    mount(undefined);
    expect(document.body.textContent ?? "").toContain("UNLIMITED BULL");
  });

  it("walks the actions", () => {
    const onClick = mount(ROBOT);
    click("DELETE");
    click("START");
    click("SYMBOLS");
    click("CONNECT EA");
    expect(onClick).toHaveBeenCalledTimes(4);
  });

  it("says STOP while the robot runs", () => {
    mount(ROBOT, true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("STOP");
    expect(text).not.toContain("START");
  });
});

describe("trend guard", () => {
  /** A clean uptrend: 60 closes rising, price above EMA50, EMA20 > EMA50. */
  const uptrend = Array.from({ length: 60 }, (_, index) => {
    const close = 2000 + index * 3;
    return { time: 1_700_000_000 + index * 3600, open: close - 1, high: close + 1.5, low: close - 2, close, volume: 100 };
  });

  /** A clean downtrend: 60 closes falling. */
  const downtrend = Array.from({ length: 60 }, (_, index) => {
    const close = 2200 - index * 3;
    return { time: 1_700_000_000 + index * 3600, open: close + 1, high: close + 2, low: close - 1.5, close, volume: 100 };
  });

  it("hard-blocks SELL inside a confirmed uptrend", () => {
    const verdict = checkDirectionAgainstCandles("SELL", uptrend);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("UPTREND");
  });

  it("allows BUY inside a confirmed uptrend", () => {
    expect(checkDirectionAgainstCandles("BUY", uptrend).ok).toBe(true);
  });

  it("hard-blocks BUY inside a confirmed downtrend", () => {
    const verdict = checkDirectionAgainstCandles("BUY", downtrend);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("DOWNTREND");
  });

  it("allows SELL inside a confirmed downtrend", () => {
    expect(checkDirectionAgainstCandles("SELL", downtrend).ok).toBe(true);
  });

  it("still refuses a side that fights a short series", () => {
    // Fewer than 20 closes: no EMA stack to read, so the 5-bar check decides.
    const short = Array.from({ length: 10 }, (_, index) => {
      const close = 100 + index;
      return { time: 1_700_000_000 + index * 3600, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 10 };
    });
    expect(checkDirectionAgainstCandles("SELL", short).ok).toBe(false);
  });
});
