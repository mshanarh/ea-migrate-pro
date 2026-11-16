import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ApexSniper } from "@/components/app/SignatureLayouts";
import { INTERFACE_THEMES } from "@/lib/app-customization";
import type { Robot } from "@/lib/app-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * APEX SNIPER — the avatar overlaps the card, the three tiles are the controls,
 * and the picture is whatever the hosted robot carries. Nothing here may point
 * at a bundled background image.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const ROBOT = {
  id: "r1",
  name: "Apex Bot",
  image: "https://cdn.example.com/ea-face.jpg",
  running: false,
} as unknown as Robot;

function render(element: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(element);
  });
}

function mount(robot: Robot | undefined, running = false, onClick = vi.fn()) {
  render(
    createElement(ApexSniper, {
      robot: robot ? ({ ...robot, running } as Robot) : undefined,
      accent: "#00F5A0",
      onStart: onClick,
      onQuotes: onClick,
      onRemove: onClick,
      onOpenScanner: vi.fn(),
      onOpenAdd: onClick,
    }),
  );
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

describe("Apex Sniper", () => {
  it("is offered as an interface style", () => {
    const theme = INTERFACE_THEMES.find((item) => item.id === "APEX SNIPER");
    expect(theme).toBeTruthy();
    expect(theme!.name).toBe("Apex Sniper");
    expect(theme!.description).toBe("Floating avatar & dark glass tiles");
  });

  it("draws the robot's own picture, its name and the three glass tiles", () => {
    mount(ROBOT);
    const text = (document.body.textContent ?? "").toUpperCase();
    expect(text).toContain("APEX BOT");
    expect(text).toContain("START");
    expect(text).toContain("QUOTES");
    expect(text).toContain("REMOVE");
    expect(text).toContain("HOST ROBOT");

    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/ea-face.jpg");
    // No bundled hero/backdrop image may be referenced by this layout.
    expect(document.body.innerHTML).not.toMatch(/ea-migrate-hero|hero\.jpg/);
  });

  it("shows STOP while the robot runs and START when it is idle", () => {
    mount(ROBOT, true);
    expect((document.body.textContent ?? "").toUpperCase()).toContain("STOP");
    act(() => root?.unmount());
    root = null;
    host?.remove();

    mount(ROBOT, false);
    expect((document.body.textContent ?? "").toUpperCase()).toContain("START");
  });

  it("falls back to the platform logo and a placeholder name with no robot", () => {
    mount(undefined);
    const text = (document.body.textContent ?? "").toUpperCase();
    expect(text).toContain("YOUR ROBOT");
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
  });

  it("anchors the layout at the top, not in the bottom dock", () => {
    mount(ROBOT);
    const shell = document.body.querySelector("div.relative.z-10") as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(shell!.className).toContain("justify-start");
    expect(shell!.className).not.toContain("justify-center");
    // Bottom padding keeps the capsule clear of the platform nav.
    expect(shell!.className).toContain("pb-24");
  });

  it("wires the tiles and the Host Robot capsule to their actions", () => {
    const onClick = mount(ROBOT);
    click("QUOTES");
    expect(onClick).toHaveBeenCalledTimes(1);
    click("REMOVE");
    expect(onClick).toHaveBeenCalledTimes(2);
    click("HOST ROBOT");
    expect(onClick).toHaveBeenCalledTimes(3);
  });
});
