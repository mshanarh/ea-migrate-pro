import { beforeEach, describe, expect, it } from "vitest";
import {
  isBackgroundPictureOn,
  setBackgroundPictureOn,
  subscribeBackgroundPicture,
} from "@/lib/background-picture";

describe("background picture toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists under the one key every screen reads", () => {
    setBackgroundPictureOn(true);
    expect(window.localStorage.getItem("mediaDim")).toBe("true");
    expect(isBackgroundPictureOn()).toBe(true);

    setBackgroundPictureOn(false);
    expect(window.localStorage.getItem("mediaDim")).toBe("false");
    expect(isBackgroundPictureOn()).toBe(false);
  });

  it("notifies every subscribed screen the moment it flips", () => {
    let notifications = 0;
    const unsubscribe = subscribeBackgroundPicture(() => {
      notifications += 1;
    });

    setBackgroundPictureOn(true);
    setBackgroundPictureOn(true); // no-op: same value must not repaint the app
    expect(notifications).toBe(1);

    setBackgroundPictureOn(false);
    expect(notifications).toBe(2);
    unsubscribe();
  });
});
