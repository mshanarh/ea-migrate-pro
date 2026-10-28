import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachVideoHost,
  detachVideoHost,
  getSharedVideoState,
  resetSharedVideoForTests,
  setSharedVideoSource,
  videoLayerMode,
} from "@/lib/shared-video";
import {
  isRobotVideoStopped,
  isRobotVideoUltra,
  setRobotVideoStopped,
  setRobotVideoUltra,
  toggleVideoPlayback,
} from "@/lib/video-playback";

/**
 * THE SHARED ROBOT VIDEO — placement rules and the ONE-element guarantee.
 *
 * The rules are the product requirement: Home always plays, the Robot Video
 * switch drives the other non-trading screens, and Metatrader / Scanner /
 * Fundamentals never show a video. The registry tests prove the player is a
 * single element that MOVES between hosts instead of being remounted (which is
 * what used to stack decoders and restart the clip on every navigation).
 */

const SOURCE = "data:video/mp4;base64,AAAA";

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function player(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video[data-eamp-robot-video]");
}

function makeHost(kind: "card" | "screen", id: string, transparentScreen = true): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  attachVideoHost({
    id,
    kind,
    el,
    getOptions: () => ({ opacity: kind === "card" ? 1 : 0.4, transparentScreen }),
  });
  return el;
}

beforeEach(() => {
  resetSharedVideoForTests();
  setRobotVideoStopped(false);
  setRobotVideoUltra(true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  resetSharedVideoForTests();
  setRobotVideoStopped(false);
  setRobotVideoUltra(true);
  window.localStorage.removeItem("robotVideoUltra");
  document.querySelectorAll("div").forEach((el) => {
    if (el.parentElement === document.body) el.remove();
  });
  vi.restoreAllMocks();
});

describe("videoLayerMode — the placement rule", () => {
  it("always puts the video on Home, whatever the switch says", () => {
    expect(videoLayerMode("/app/home", false)).toBe("home");
    expect(videoLayerMode("/app/home", true)).toBe("home");
  });

  it("gates every other non-trading app screen on the Robot Video switch", () => {
    expect(videoLayerMode("/app/settings", true)).toBe("background");
    expect(videoLayerMode("/app/settings", false)).toBe("none");
    expect(videoLayerMode("/app/notifications", true)).toBe("background");
    expect(videoLayerMode("/app/trading-pairs", true)).toBe("background");
  });

  it("never shows the video on Metatrader, Scanner or Fundamentals", () => {
    for (const path of ["/app/metatrader", "/app/scanner", "/app/fundamentals"]) {
      expect(videoLayerMode(path, true)).toBe("none");
      expect(videoLayerMode(path, false)).toBe("none");
    }
  });

  it("stays off outside the app", () => {
    expect(videoLayerMode("/", true)).toBe("none");
    expect(videoLayerMode("/dashboard", true)).toBe("none");
    expect(videoLayerMode("/app", true)).toBe("none");
  });
});

describe("one shared element across interfaces", () => {
  it("has a source and becomes ready before any host shows it", async () => {
    setSharedVideoSource(SOURCE);
    expect(getSharedVideoState().ready).toBe(false);
    await until(() => getSharedVideoState().ready, "the source to resolve");
    expect(getSharedVideoState().sourceRef).toBe(SOURCE);
    expect(player()?.getAttribute("src")).toBe(SOURCE);
  });

  it("moves into the card host (Home's big screen) when one registers", async () => {
    await (async () => {
      setSharedVideoSource(SOURCE);
      await until(() => getSharedVideoState().ready, "ready");
    })();
    const card = makeHost("card", "card-1");
    expect(player()?.parentElement).toBe(card);
    expect(document.body.classList.contains("eamp-app-video")).toBe(false);
  });

  it("moves to the screen host when the card host unmounts — same element", async () => {
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const card = makeHost("card", "card-1");
    const screen = makeHost("screen", "screen-1");
    const element = player();
    expect(element?.parentElement).toBe(card);

    detachVideoHost("card-1");
    // THE SAME element — not a new one: playback position survives navigation.
    expect(player()).toBe(element);
    expect(element?.parentElement).toBe(screen);
    expect(screen.contains(element as Node)).toBe(true);
    expect(document.body.classList.contains("eamp-app-video")).toBe(true);
  });

  it("parks the element (paused) when no screen allows it", async () => {
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const screen = makeHost("screen", "screen-1");
    expect(player()?.parentElement).toBe(screen);

    detachVideoHost("screen-1");
    const parked = player();
    expect(parked?.parentElement?.hasAttribute("data-eamp-video-park")).toBe(true);
    expect(document.body.classList.contains("eamp-app-video")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("keeps one source and never reloads it on repeated navigation", async () => {
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const load = vi.mocked(HTMLMediaElement.prototype.load);

    const screenA = makeHost("screen", "screen-a");
    detachVideoHost("screen-a");
    const screenB = makeHost("screen", "screen-b");
    setSharedVideoSource(SOURCE); // a route change re-applies the same source
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screenB.contains(player() as Node)).toBe(true);
    expect(getSharedVideoState().ready).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("stops on every host when the HOME gesture stops playback — Home included", async () => {
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const card = makeHost("card", "card-1");
    expect(card.contains(player() as Node)).toBe(true);

    toggleVideoPlayback();
    expect(isRobotVideoStopped()).toBe(true);
    // Parked and paused: the big screen cannot keep playing behind a stop.
    expect(card.contains(player() as Node)).toBe(false);
    expect(player()?.parentElement?.hasAttribute("data-eamp-video-park")).toBe(true);
    expect(document.body.classList.contains("eamp-app-video")).toBe(false);

    // A further navigation must not resurrect it — it stays stopped.
    detachVideoHost("card-1");
    const screen = makeHost("screen", "screen-1");
    expect(screen.contains(player() as Node)).toBe(false);

    // The same gesture plays it again.
    toggleVideoPlayback();
    expect(isRobotVideoStopped()).toBe(false);
    expect(screen.contains(player() as Node)).toBe(true);
  });

  it("defaults to Ultra HD and marks the element for the crisp filter", async () => {
    expect(isRobotVideoUltra()).toBe(true);
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const screen = makeHost("screen", "screen-1");
    expect(screen.contains(player() as Node)).toBe(true);
    expect(player()?.hasAttribute("data-eamp-video-ultra")).toBe(true);

    setRobotVideoUltra(false);
    attachVideoHost({
      id: "screen-1",
      kind: "screen",
      el: screen,
      getOptions: () => ({ opacity: 0.4, transparentScreen: true }),
    });
    expect(player()?.hasAttribute("data-eamp-video-ultra")).toBe(false);
  });

  it("drops the player when the source is cleared", async () => {
    setSharedVideoSource(SOURCE);
    await until(() => getSharedVideoState().ready, "ready");
    const screen = makeHost("screen", "screen-1");
    setSharedVideoSource(null);
    expect(getSharedVideoState()).toEqual({ sourceRef: null, ready: false, failed: false });
    // The element itself survives (parked, empty, invisible) — it is never
    // destroyed and re-created, which is what would restart the clip.
    const el = player();
    expect(el?.getAttribute("src")).toBeFalsy();
    expect(el?.parentElement?.hasAttribute("data-eamp-video-park")).toBe(true);
    expect(screen.contains(el as Node)).toBe(false);
    expect(document.body.classList.contains("eamp-app-video")).toBe(false);
  });
});
