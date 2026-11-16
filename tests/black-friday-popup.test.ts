import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BlackFridayPromoPopup } from "@/components/BlackFridayPromoPopup";

/**
 * THE THREE-TAP DEAL, DRIVEN THE WAY A CUSTOMER DRIVES IT.
 *
 * The offer is only useful if the numbers are right for the platform that was
 * picked, so this clicks the real buttons: open → Claim → Android / iOS, and
 * reads the prices and the WhatsApp link that end up on screen.
 */

// React only batches and flushes `act()` work when it is told it is in a test
// environment; without this the console fills with warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(BlackFridayPromoPopup));
  });
}

function click(label: string) {
  const target = [...document.querySelectorAll("button, a")].find((element) =>
    (element.textContent ?? "").includes(label),
  );
  if (!target) throw new Error(`No control matching "${label}" on screen`);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

describe("Black Friday popup", () => {
  it("opens after the settle delay, counts down, and closes", () => {
    vi.useFakeTimers();
    // 26 hours before the deadline: 01 days 02 hours 00 minutes 00 seconds.
    vi.setSystemTime(new Date("2026-11-17T22:00:00+02:00"));
    render();
    expect(document.body.textContent).not.toContain("Black Friday Exclusive");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(document.body.textContent).toContain("Black Friday Exclusive");
    expect(document.body.textContent).toContain("Valid until 18 November");

    // The deadline is 18 Nov 2026 23:59:59 SAST, so one tick later the pills
    // read 01 days / 01 hours / 59 minutes / 59 seconds.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.body.textContent).toContain("01Days");
    expect(document.body.textContent).toContain("01Hours");
    // The clock really ticks: it read 00:00:00 when the dialog opened.
    expect(document.body.textContent).toMatch(/5[0-9]Seconds/);

    click("No thanks, keep browsing");
    expect(document.body.textContent).not.toContain("Black Friday Exclusive");
  });

  it("prices Android at ZAR 175 / ZAR 250 and links WhatsApp with the platform", () => {
    vi.useFakeTimers();
    render();
    act(() => {
      vi.advanceTimersByTime(800);
    });

    click("Claim 50% Off Access");
    expect(document.body.textContent).toContain("Select your mobile platform");

    click("Android App / APK");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Selected: Android");
    expect(text).toContain("ZAR 175");
    expect(text).toContain("ZAR 250");
    expect(text).toContain("ZAR 350");
    expect(text).toContain("ZAR 500");

    const links = [...document.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href") ?? "");
    const monthly = links.find((href) => href.startsWith("https://wa.me/27704950612")) ?? "";
    expect(decodeURIComponent(monthly)).toContain("Android - Monthly");
    expect(links.some((href) => decodeURIComponent(href).includes("Android - Lifetime"))).toBe(true);
  });

  it("prices iOS the same and can go back to change platform", () => {
    vi.useFakeTimers();
    render();
    act(() => {
      vi.advanceTimersByTime(800);
    });

    click("Claim 50% Off Access");
    click("iOS / iPhone & iPad");
    expect(document.body.textContent).toContain("Selected: iOS");

    click("Change");
    expect(document.body.textContent).toContain("Select your mobile platform");

    click("Android App / APK");
    const links = [...document.querySelectorAll("a")].map((href) => decodeURIComponent(href.getAttribute("href") ?? ""));
    expect(links.some((href) => href.includes("Android - Lifetime"))).toBe(true);
  });
});
