import { beforeEach, describe, expect, it } from "vitest";
import {
  BOTTOM_NAV_STYLE_OPTIONS,
  getBottomNavStyle,
  setBottomNavStyle,
  type BottomNavStyle,
} from "@/lib/bottom-nav-style";

/**
 * SETTINGS → BOTTOM NAV.
 *
 * The picker writes ONE shared, persisted store and the real `FixedBottomNav`
 * on Home, Metatrader, Quotes and Scanner subscribes to it, so a selection
 * re-renders every mounted nav instantly. These tests pin the full line-up and
 * that each choice survives a reload.
 */

const EXPECTED: BottomNavStyle[] = [
  "floating-pill",
  "icon-pill",
  "classic-tabs",
  "compact-dots",
  "glass-bar",
  "outlined-pill",
  "circle-dock",
  "square-tiles",
  "underline-tabs",
];

describe("bottom nav styles", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the module store the way the default load would.
    setBottomNavStyle("floating-pill");
    window.localStorage.clear();
  });

  it("offers the original four plus the five new looks", () => {
    expect(BOTTOM_NAV_STYLE_OPTIONS.map((option) => option.id)).toEqual(EXPECTED);
    // Every option is user-facing: a name and a line explaining the shape.
    for (const option of BOTTOM_NAV_STYLE_OPTIONS) {
      expect(option.name.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it("applies and persists any of the nine styles", () => {
    for (const style of EXPECTED) {
      setBottomNavStyle(style);
      expect(getBottomNavStyle()).toBe(style);
      expect(window.localStorage.getItem("eamp.bottomNavStyle")).toBe(style);
    }
  });

  it("broadcasts the change so every mounted nav re-renders without a reload", () => {
    let notifications = 0;
    const listener = () => {
      notifications += 1;
    };
    window.addEventListener("eamp:bottomnavstyle", listener);

    setBottomNavStyle("circle-dock");

    window.removeEventListener("eamp:bottomnavstyle", listener);
    expect(notifications).toBe(1);
    expect(getBottomNavStyle()).toBe("circle-dock");
  });
});
