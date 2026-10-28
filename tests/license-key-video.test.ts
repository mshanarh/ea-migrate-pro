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
