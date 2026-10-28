import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE ROBOT VIDEO IS STORED AGAINST THE LICENCE KEY.
 *
 * The mentor's upload used to live only in the portal row / media store, so an
 * activated app had nothing to look up by key and claimed "no video". These
 * tests drive the real /api/licenses handler against a scripted KV store and
 * assert the link the app depends on: whatever is written on `issue` or on a
 * mentor EA edit comes back from `ea-config` for that key.
 */

const store = vi.hoisted(() => ({
  /** hash name → field → value — the shape HSET/HGET use here. */
  hash: new Map<string, Map<string, string>>(),
  sets: new Map<string, Set<string>>(),
  strings: new Map<string, string>(),
}));

vi.mock("../api/_handlers/_registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/_handlers/_registry")>();
  const kvCommand = async (command: (string | number)[]): Promise<unknown> => {
    const [name, ...rest] = command;
    const op = String(name ?? "").toUpperCase();
    const key = String(rest[0] ?? "");
    const field = String(rest[1] ?? "");
    if (op === "HGET") return store.hash.get(key)?.get(field) ?? null;
    if (op === "HSET") {
      const hash = store.hash.get(key) ?? new Map<string, string>();
      hash.set(field, String(rest[2] ?? ""));
      store.hash.set(key, hash);
      return 1;
    }
    if (op === "SADD") {
      const set = store.sets.get(key) ?? new Set<string>();
      set.add(field);
      store.sets.set(key, set);
      return 1;
    }
    if (op === "SREM") {
      store.sets.get(key)?.delete(field);
      return 1;
    }
    if (op === "SMEMBERS") return Array.from(store.sets.get(key) ?? []);
    if (op === "SCARD") return (store.sets.get(key) ?? new Set()).size;
    if (op === "DEL") {
      store.hash.delete(key);
      store.sets.delete(key);
      store.strings.delete(key);
      return 1;
    }
    if (op === "GET") return store.strings.get(key) ?? null;
    if (op === "SET") {
      if (rest.includes("NX") && store.strings.has(key)) return null;
      store.strings.set(key, field);
      return "OK";
    }
    return null;
  };
  return { ...actual, storeConfigured: () => true, kvCommand };
});

const MENTOR = "mentor@example.com";
const KEY = "EMP-ABCD-1234-WXYZ";

type Reply = { status: number; body: Record<string, unknown> };

async function call(payload: Record<string, unknown>): Promise<Reply> {
  const { default: handler } = await import("../api/_handlers/licenses");
  const reply: Reply = { status: 0, body: {} };
  const response = {
    setHeader: () => undefined,
    status(code: number) {
      reply.status = code;
      return response;
    },
    json(body: unknown) {
      reply.body = (body ?? {}) as Record<string, unknown>;
    },
  };
  await handler({ method: "POST", body: JSON.stringify(payload) }, response as never);
  return reply;
}

async function configsFor(key: string): Promise<Array<Record<string, unknown>>> {
  const reply = await call({ action: "ea-config", keys: [key] });
  expect(reply.status).toBe(200);
  return (reply.body["configs"] ?? []) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  store.hash.clear();
  store.sets.clear();
  store.strings.clear();
});

describe("licence-key video record", () => {
  it("keeps the video pointer written at issue and returns it by key", async () => {
    const issued = await call({
      action: "issue",
      key: KEY,
      mentorEmail: MENTOR,
      eaName: "Apex Sniper Pro V6+",
      eaId: "ea-1",
      symbols: ["XAUUSDm"],
      videoId: "ea-ea-1",
    });
    expect(issued.body["ok"]).toBe(true);

    const [config] = await configsFor(KEY);
    expect(config?.["videoId"]).toBe("ea-ea-1");
    expect(config?.["eaName"]).toBe("Apex Sniper Pro V6+");
  });

  it("carries a small inline source instead of a pointer when that is all it takes", async () => {
    const clip = "data:video/mp4;base64,AAAAIGZ0eXA=";
    await call({
      action: "issue",
      key: KEY,
      mentorEmail: MENTOR,
      eaId: "ea-1",
      video: clip,
    });
    const [config] = await configsFor(KEY);
    expect(config?.["video"]).toBe(clip);
    expect(config?.["videoId"]).toBeUndefined();
  });

  it("links the video on a mentor EA edit, for every key of that EA", async () => {
    await call({ action: "issue", key: KEY, mentorEmail: MENTOR, eaId: "ea-1", eaName: "Apex" });
    expect((await configsFor(KEY))[0]?.["videoId"]).toBeUndefined();

    const updated = await call({
      action: "update-ea",
      mentorEmail: MENTOR,
      eaId: "ea-1",
      symbols: ["XAUUSDm"],
      videoId: "ea-ea-1",
    });
    expect(updated.body["updated"]).toBe(1);
    expect((await configsFor(KEY))[0]?.["videoId"]).toBe("ea-ea-1");
  });

  it("answers an unknown key with no config at all (the app reads that as 'no video')", async () => {
    const configs = await configsFor("EMP-ZZZZ-9999-0000");
    expect(configs).toHaveLength(0);
  });

  it("never stores an oversized inline video, but keeps the pointer", async () => {
    await call({
      action: "issue",
      key: KEY,
      mentorEmail: MENTOR,
      eaId: "ea-1",
      video: `data:video/mp4;base64,${"A".repeat(500_000)}`,
      videoId: "ea-ea-1",
    });
    const [config] = await configsFor(KEY);
    expect(config?.["video"]).toBeUndefined();
    expect(config?.["videoId"]).toBe("ea-ea-1");
  });
});

describe("stored video parts and the backfill", () => {
  const KEY_A = "EMP-AAAA-1111-2222";
  const KEY_B = "EMP-BBBB-3333-4444";
  const PART_1 = "data:video/mp4;base64,AAAAIGZ0eXA=";
  const PART_2 = "BBBBCCCCDDDD";

  async function twoKeysFor(eaId: string, eaName: string) {
    await call({ action: "issue", key: KEY_A, mentorEmail: MENTOR, eaId, eaName });
    await call({ action: "issue", key: KEY_B, mentorEmail: MENTOR, eaId, eaName });
  }

  async function uploadParts(eaId: string, parts: string[]) {
    for (let index = 0; index < parts.length; index += 1) {
      const put = await call({
        action: "video-put",
        mentorEmail: MENTOR,
        eaId,
        index,
        total: parts.length,
        data: parts[index],
      });
      expect(put.body["ok"]).toBe(true);
    }
  }

  it("stores every part and links ALL keys of the EA, idempotently", async () => {
    await twoKeysFor("ea-1", "Apex Sniper Pro V6+");
    await uploadParts("ea-1", [PART_1, PART_2]);

    const link = await call({
      action: "video-link",
      mentorEmail: MENTOR,
      eaId: "ea-1",
      chunks: 2,
      bytes: PART_1.length + PART_2.length,
    });
    expect(link.body["ok"]).toBe(true);
    expect(link.body["keysLinked"]).toBe(2);

    const again = await call({
      action: "video-link",
      mentorEmail: MENTOR,
      eaId: "ea-1",
      chunks: 2,
      bytes: PART_1.length + PART_2.length,
    });
    expect(again.body["keysLinked"]).toBe(2);

    for (const key of [KEY_A, KEY_B]) {
      const [config] = await configsFor(key);
      expect(config?.["videoId"]).toBe("ea-1");
    }
  });

  it("serves the exact parts back by licence key", async () => {
    await twoKeysFor("ea-2", "Apex");
    await uploadParts("ea-2", [PART_1, PART_2]);
    await call({ action: "video-link", mentorEmail: MENTOR, eaId: "ea-2", chunks: 2, bytes: 30 });

    const info = await call({ action: "video-info", key: KEY_A });
    expect(info.body).toMatchObject({ ok: true, found: true, rowId: "ea-2", chunks: 2 });

    const first = await call({ action: "video-chunk", key: KEY_A, index: 0 });
    const second = await call({ action: "video-chunk", key: KEY_B, index: 1 });
    expect(first.body["data"]).toBe(PART_1);
    expect(second.body["data"]).toBe(PART_2);
    expect(`${first.body["data"]}${second.body["data"]}`).toBe(PART_1 + PART_2);
  });

  it("reports zero linked keys honestly when the EA has no key yet", async () => {
    await call({ action: "issue", key: KEY_A, mentorEmail: MENTOR, eaId: "ea-other", eaName: "Other" });
    await uploadParts("ea-3", [PART_1]);

    const link = await call({ action: "video-link", mentorEmail: MENTOR, eaId: "ea-3", chunks: 1, bytes: 10 });
    expect(link.body["keysLinked"]).toBe(0);
    expect(link.body["keysForMentor"]).toBe(1);
  });

  it("matches the EA name case-insensitively", async () => {
    // The portal shows "Apex Sniper Pro V6+"; the stored record says "Apex sniper pro V6+".
    await call({
      action: "issue",
      key: KEY_A,
      mentorEmail: MENTOR,
      eaId: "ea-mvdjri9fl9vmv8",
      eaName: "Apex sniper pro V6+",
    });
    await uploadParts("ea-mvdjri9fl9vmv8", [PART_1]);

    const link = await call({
      action: "video-link",
      mentorEmail: MENTOR,
      eaId: "ea-mvdjri9fl9vmv8",
      eaName: "Apex Sniper Pro V6+",
      chunks: 1,
      bytes: 10,
    });
    expect(link.body["keysLinked"]).toBe(1);
    expect((await configsFor(KEY_A))[0]?.["videoId"]).toBe("ea-mvdjri9fl9vmv8");
  });

  it("reports a pointer with no stored index as an error, not as 'no video'", async () => {
    // A pointer written without its parts (the shape a broken link leaves
    // behind) must answer "incomplete — retry", never "this key has no video".
    await call({ action: "issue", key: KEY_A, mentorEmail: MENTOR, eaId: "ea-4", eaName: "Broken" });
    await call({ action: "update-ea", mentorEmail: MENTOR, eaId: "ea-4", videoId: "ea-ghost" });

    const info = await call({ action: "video-info", key: KEY_A });
    expect(info.status).toBe(503);
    expect(info.body["ok"]).toBe(false);
  });

  it("answers a missing part as a failure, not as an empty video", async () => {
    await twoKeysFor("ea-6", "Partial");
    await uploadParts("ea-6", [PART_1]);
    await call({ action: "video-link", mentorEmail: MENTOR, eaId: "ea-6", chunks: 2, bytes: 900 });

    const missing = await call({ action: "video-chunk", key: KEY_A, index: 1 });
    expect(missing.status).toBe(503);
    expect(missing.body["ok"]).toBe(false);
  });

  it("clears the stored video and the pointer", async () => {
    await twoKeysFor("ea-5", "Clearable");
    await uploadParts("ea-5", [PART_1]);
    await call({ action: "video-link", mentorEmail: MENTOR, eaId: "ea-5", chunks: 1, bytes: 10 });

    const cleared = await call({ action: "video-clear", mentorEmail: MENTOR, eaId: "ea-5" });
    expect(cleared.body["unlinked"]).toBe(2);
    const info = await call({ action: "video-info", key: KEY_A });
    expect(info.body).toMatchObject({ ok: true, found: false });
  });
});
