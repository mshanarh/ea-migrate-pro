import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCENT_COLORS } from "@/lib/app-customization";
import { colourCycleAccentId, isColourCycling, toggleColourCycle } from "@/lib/color-cycle";

function stopIfRunning() {
  if (isColourCycling()) toggleColourCycle();
}

describe("interface colour cycle", () => {
  afterEach(() => {
    stopIfRunning();
    vi.useRealTimers();
  });

  it("walks EVERY colour Settings offers, in picker order, then repeats", () => {
    vi.useFakeTimers();
    toggleColourCycle();

    const seen: Array<string | null> = [colourCycleAccentId()];
    for (let index = 1; index < ACCENT_COLORS.length; index += 1) {
      vi.advanceTimersByTime(2000);
      seen.push(colourCycleAccentId());
    }

    expect(seen).toEqual(ACCENT_COLORS.map((entry) => entry.id));

    // …and wraps back to the first colour instead of stopping on the last.
    vi.advanceTimersByTime(2000);
    expect(colourCycleAccentId()).toBe(ACCENT_COLORS[0]!.id);
  });

  it("changes colour once every 2 seconds — not on every frame", () => {
    vi.useFakeTimers();
    toggleColourCycle();
    const first = colourCycleAccentId();

    vi.advanceTimersByTime(1_900);
    expect(colourCycleAccentId()).toBe(first);

    vi.advanceTimersByTime(100);
    expect(colourCycleAccentId()).not.toBe(first);
  });

  it("stops on the next tap and returns to the stored theme", () => {
    vi.useFakeTimers();
    toggleColourCycle();
    vi.advanceTimersByTime(4_000);
    expect(isColourCycling()).toBe(true);

    toggleColourCycle();
    expect(isColourCycling()).toBe(false);
    // null means "no override": useCustomization() falls back to the saved colour.
    expect(colourCycleAccentId()).toBeNull();
  });
});
