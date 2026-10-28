import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE PLAY BUTTON'S ANSWER IS TRI-STATE.
 *
 * "No robot video yet — your mentor can upload one" is a CLAIM: it may only be
 * said when the licence store answered and confirmed the key's EA has no
 * video. A store that could not be asked, or a video part that could not be
 * read, must come back as a retryable error instead.
 */

const kv = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  configsEnabled: true,
  configsOk: true,
  configError: "" as string,
  info: { enabled: true, ok: true, found: false } as Record<string, unknown>,
  chunks: {} as Record<number, { enabled: boolean; ok: boolean; data?: string; error?: string }>,
}));

const media = vi.hoisted(() => ({ video: null as string | null }));

vi.mock("@/lib/license-cloud", () => ({
  fetchEaConfigsInKv: vi.fn(async () => ({
    enabled: kv.configsEnabled,
    ok: kv.configsOk,
    configs: kv.configs,
    ...(kv.configError ? { error: kv.configError } : {}),
  })),
  fetchEaVideoInfoInKv: vi.fn(async () => kv.info),
  fetchEaVideoChunkInKv: vi.fn(async (_key: string, index: number) =>
    kv.chunks[index] ?? { enabled: true, ok: false, error: `no chunk ${index}` },
  ),
}));

vi.mock("@/lib/ea-video-cloud", () => ({
  loadEaVideoFromCloud: vi.fn(async () => media.video),
  saveEaVideoToCloud: vi.fn(async () => true),
  deleteEaVideoFromCloud: vi.fn(async () => true),
}));

const KEY = "EMP-ABCD-1234-WXYZ";
const CLIP = "data:video/mp4;base64,AAAAIGZ0eXA=";

async function lookup(key: string) {
  const { lookupRobotVideoForKey } = await import("../src/lib/robot-video");
  return lookupRobotVideoForKey(key);
}

beforeEach(() => {
  kv.configs = [];
  kv.configsEnabled = true;
  kv.configsOk = true;
  kv.configError = "";
  kv.info = { enabled: true, ok: true, found: false };
  kv.chunks = {};
  media.video = null;
});

describe("robot video lookup by licence key", () => {
  it("returns the source the key's record carries (http URL)", async () => {
    kv.configs = [{ key: KEY, symbols: null, video: "https://cdn.example.test/demo.mp4" }];

    const result = await lookup(KEY);

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.video).toBe("https://cdn.example.test/demo.mp4");
      expect(result.from).toBe("record");
    }
  });

  it("reassembles the video stored for the key from its parts", async () => {
    kv.configs = [{ key: KEY, symbols: null, videoId: "ea-ea-1" }];
    kv.info = { enabled: true, ok: true, found: true, rowId: "ea-ea-1", chunks: 2, bytes: CLIP.length * 2 };
    kv.chunks = {
      0: { enabled: true, ok: true, data: CLIP.slice(0, 20) },
      1: { enabled: true, ok: true, data: CLIP.slice(20) },
    };

    const result = await lookup(KEY);

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.video).toBe(CLIP);
      expect(result.from).toBe("store");
    }
  });

  it("falls back to a legacy media row when the key store has no copy", async () => {
    kv.configs = [{ key: KEY, symbols: null, videoId: "v_1699_abc" }];
    kv.info = { enabled: true, ok: true, found: false };
    media.video = CLIP;

    const result = await lookup(KEY);

    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.video).toBe(CLIP);
  });

  it("says NONE only when the store answered and the key has no video", async () => {
    kv.configs = [{ key: KEY, symbols: ["XAUUSDm"] }];
    kv.info = { enabled: true, ok: true, found: false };

    expect((await lookup(KEY)).status).toBe("none");
  });

  it("says NONE for a key the store does not hold", async () => {
    kv.configs = [];
    kv.info = { enabled: true, ok: true, found: false };

    expect((await lookup(KEY)).status).toBe("none");
  });

  it("is UNAVAILABLE — never 'no video' — when the config store cannot be asked", async () => {
    kv.configsEnabled = false;

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.error).toBeTruthy();
  });

  it("is UNAVAILABLE when the store answered with an error", async () => {
    kv.configsOk = false;
    kv.configError = "Licence storage is unavailable. Please try again.";

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.error).toContain("Licence storage is unavailable");
    }
  });

  it("is UNAVAILABLE when the video index is incomplete", async () => {
    kv.configs = [{ key: KEY, symbols: null, videoId: "ea-ea-1" }];
    kv.info = { enabled: true, ok: false, found: false, error: "The stored video is incomplete." };

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
  });

  it("is UNAVAILABLE when a part of the video cannot be read", async () => {
    kv.configs = [{ key: KEY, symbols: null, videoId: "ea-ea-1" }];
    kv.info = { enabled: true, ok: true, found: true, rowId: "ea-ea-1", chunks: 2, bytes: 100 };
    kv.chunks = { 0: { enabled: true, ok: true, data: "AAA" } };

    const result = await lookup(KEY);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.error).toBeTruthy();
  });
});
