import { describe, expect, it } from "vitest";
import { isPlainBackgroundTap } from "@/components/ColourCycleTap";

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("centre tap on the app background", () => {
  it("counts a tap on open space inside an app shell", () => {
    mount(
      '<div class="app-fullscreen"><div class="app-scroll-area"><div id="gap" style="padding:40px"></div></div></div>',
    );
    expect(isPlainBackgroundTap(document.getElementById("gap")!)).toBe(true);
  });

  it("ignores buttons, links, inputs and switches", () => {
    mount(
      '<div class="app-fullscreen"><div class="app-scroll-area">' +
        '<button id="b"><span id="b-span">Start</span></button>' +
        '<a id="a" href="/x">x</a>' +
        '<input id="i" />' +
        '<div role="switch" id="s"><span id="s-span"></span></div>' +
        "</div></div>",
    );
    expect(isPlainBackgroundTap(document.getElementById("b")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("b-span")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("a")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("i")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("s-span")!)).toBe(false);
  });

  it("ignores cards, popups, the draggable bot and the bottom nav", () => {
    mount(
      '<div class="app-fullscreen"><div class="app-scroll-area">' +
        '<div id="card" style="background-color:#121212;border-radius:20px;padding:16px"><span id="card-text">x</span></div>' +
        '<div id="popup" role="dialog"><span id="popup-text">log</span></div>' +
        '<div id="bot" role="button" aria-label="bot"><span id="bot-dot"></span></div>' +
        '<nav id="nav"><span id="nav-label">Home</span></nav>' +
        "</div></div>",
    );
    expect(isPlainBackgroundTap(document.getElementById("card-text")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("popup-text")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("bot-dot")!)).toBe(false);
    expect(isPlainBackgroundTap(document.getElementById("nav-label")!)).toBe(false);
  });
});
