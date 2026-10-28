import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE PLAY BUTTON'S ANSWER IS TRI-STATE.
 *
 * "No robot video yet — your mentor can upload one" is a CLAIM: it may only be
 * said when the licence store answered and confirmed the key's EA has no
 * video. A store that could not be asked, or a media row that could not be
 * read, must come back as a retryable error instead.
 */

const kv = vi.hoisted(() => ({
  answer: { enabled: true, ok: true, configs: [] as Array<Record<string, unknown>> },
}));

const media = vi.hoisted(() => ({
  video: null as string | null,
}));

vi.mock("@/lib/license-cloud", () => ({
  fetchEaConfigsInKv: vi.fn(async () => kv.answer),
}));

vi.mock("@/lib/ea-video-cloud", () => ({
  loadEaVideoFromCloud: vi.fn(async () => media.video),
  saveEaVideoToCloud: vi.fn(async () => true),
  deleteEaVideoFromCloud: vi.fn(async () => true),
}));

const KEY = "EMP-ABCD-1234-WXYZ";

async function lookup(key: string) {
  const { lookupRobotVideoForKey } = await import("../src/lib/robot-video");
  return lookupRobotVideoForKey(key);
}

beforeEach(() => {
  kv.answer = { enabled: true, ok: true, configs: [] };
  media.video = null;
});

describe("robot video lookup by licence key", () => {
  it("returns the source the key's record carries", async () => {
    kv.answer = {
      enabled: true,
      ok: true,
      configs: [{ key: KEY, symbols: null, video: "https://cdn.example.test/demo.mp4" }],
    };

    const result = await lookup(KEY);

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.video).toBe("https://cdn.example.test/demo.mp4");
      expect(result.from).toBe("record");
    }
  });

  it("resolves a media-store pointer returned for the key", async () => {
    kv.answer = { enabled: true, ok: true, configs: [{ key: KEY, symbols: null, videoId: "ea-ea-1" }] };
    media.video = "data:video/mp4;base64,AAAAIGZ0eXA=";

    const result = await lookup(KEY);

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.video).toBe("data:video/mp4;base64,AAAAIGZ0eXA=");
      expect(result.from).toBe("store");
    }
  });

  it("says NONE only when the store answered and the key has no video", async () => {
    kv.answer = { enabled: true, ok: true, configs: [{ key: KEY, symbols: ["XAUUSDm"] }] };

    expect((await lookup(KEY)).status).toBe("none");
  });

  it("says NONE for a key the store does not hold", async () => {
    kv.answer = { enabled: true, ok: true, configs: [] };

    expect((await lookup(KEY)).status).toBe("none");
  });

  it("is UNAVAILABLE — never 'no video' — when the store cannot be asked", async () => {
    kv.answer = { enabled: false, ok: false, configs: [] };

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.error).toBeTruthy();
  });

  it("is UNAVAILABLE when the store answered with an error", async () => {
    kv.answer = {
      enabled: true,
      ok: false,
      configs: [],
      error: "Licence storage is unavailable. Please try again.",
    };

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.error).toContain("Licence storage is unavailable");
    }
  });

  it("is UNAVAILABLE when the key points at a media row that cannot be read", async () => {
    kv.answer = { enabled: true, ok: true, configs: [{ key: KEY, symbols: null, videoId: "ea-ea-1" }] };
    media.video = null;

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.error).toContain("ea-ea-1");
  });
});
