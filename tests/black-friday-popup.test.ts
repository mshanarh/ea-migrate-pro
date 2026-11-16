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
  const target = [...document.querySelectorAll("button, a")].find(
    (element) =>
      (element.textContent ?? "").includes(label) ||
      (element.getAttribute("aria-label") ?? "").includes(label),
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

  it("prices Android at ZAR 175 / ZAR 250 and opens the bank details", () => {
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

    // The plan tap no longer leaves the popup — it shows where to pay.
    click("Get Monthly at ZAR 175");
    const bank = document.body.textContent ?? "";
    expect(bank).toContain("Pay via Bank Transfer");
    expect(bank).toContain("Standard Bank");
    expect(bank).toContain("10 23 913 954 0");
    expect(bank).toContain("927");
    expect(bank).toContain("Ea migrate");
    expect(bank).toContain("Current");
    expect(bank).toContain("ZAR 175");
    expect(bank).toContain("reference");
  });

  it("states the amount, plan and platform in the proof-of-payment link", () => {
    vi.useFakeTimers();
    render();
    act(() => {
      vi.advanceTimersByTime(800);
    });

    click("Claim 50% Off Access");
    click("Android App / APK");
    click("Get Lifetime at ZAR 250");

    const proof = [...document.querySelectorAll("a")]
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => href.startsWith("https://wa.me/27704950612"));
    expect(proof).toBeTruthy();
    const decoded = decodeURIComponent(proof!);
    expect(decoded).toContain("I have paid ZAR 250");
    expect(decoded).toContain("Lifetime");
    expect(decoded).toContain("Android");
    expect(decoded).toContain("proof of payment");

    // A CTA must be labelled as the place the receipt goes.
    const cta = [...document.querySelectorAll("a")].find((anchor) =>
      (anchor.textContent ?? "").includes("Send proof of payment to WhatsApp"),
    );
    expect(cta).toBeTruthy();
  });

  it("switches between the plans with the back buttons", () => {
    vi.useFakeTimers();
    render();
    act(() => {
      vi.advanceTimersByTime(800);
    });

    click("Claim 50% Off Access");
    click("iOS / iPhone & iPad");
    expect(document.body.textContent).toContain("Selected: iOS");

    click("Get Monthly at ZAR 175");
    expect(document.body.textContent).toContain("ZAR 175");

    click("Back to plans");
    expect(document.body.textContent).toContain("Get Lifetime at ZAR 250");

    click("Get Lifetime at ZAR 250");
    const bank = document.body.textContent ?? "";
    expect(bank).toContain("Pay via Bank Transfer");
    expect(bank).toContain("ZAR 250");

    // The header arrow walks back one step at a time: 4 → 3 → 2 → 1.
    click("Back to the previous step");
    expect(document.body.textContent).toContain("Selected: iOS");
    click("Back to the previous step");
    expect(document.body.textContent).toContain("Select your mobile platform");
  });
});
