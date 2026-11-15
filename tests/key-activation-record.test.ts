import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE CLAIM MUST LEAVE A RECORD THE ACCESS GATE CAN READ.
 *
 * The reported bug: entering a licence key said "key activated", opened the
 * home screen, and then moved back to the first page of the app. The cause was
 * that `/api/check-access` only knew about keys ASSIGNED to an address
 * (`eamp:license-by-client`), which is not evidence of anything, and not about
 * keys REDEEMED by it — so the guard found no paid record and ejected the
 * customer it had just let in.
 *
 * `claimLicenceKeyForEmail` is the single place a key is redeemed (both the
 * `/api/licenses` claim action and `/api/account` claim-key go through it), so
 * it is where the redemption is written:
 *
 *   SADD eamp:key-activated:<email> <key>      — the paid record
 *   SET  eamp:key-activated-at:<email> <iso> NX — when it happened, first wins
 *
 * These tests read the commands the function actually sends to Redis.
 */

const EMAIL = "client@example.com";
const KEY = "EMP-AAAA-BBBB-CCCC";

let commands: unknown[][] = [];
/** Who already holds the key's single-use claim lock, if anyone. */
let claimHolder: string | null = null;

function stubKv(recordFor?: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      let command: unknown[] = [];
      try {
        command = JSON.parse(String(init?.body ?? "[]")) as unknown[];
      } catch {
        command = [];
      }
      commands.push(command);
      const verb = String(command[0] ?? "").toUpperCase();
      const key = String(command[1] ?? "");
      const result = (value: unknown) => ({ ok: true, status: 200, json: async () => ({ result: value }) });
      if (verb === "SET" && key.startsWith("eamp:license-claim:")) return result(claimHolder ? null : "OK");
      if (verb === "GET" && key.startsWith("eamp:license-claim:")) return result(claimHolder);
      if (verb === "HGET") return result(recordFor ? JSON.stringify(recordFor) : null);
      return result(null);
    }),
  );
}

function sent(verb: string, keyPrefix: string): unknown[][] {
  return commands.filter(
    (command) => String(command[0] ?? "").toUpperCase() === verb && String(command[1] ?? "").startsWith(keyPrefix),
  );
}

beforeEach(() => {
  commands = [];
  claimHolder = null;
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a redeemed licence key is recorded against the account", () => {
  it("writes the activation record when the claim succeeds", async () => {
    stubKv({ key: KEY, mentorEmail: "mentor@example.com", clientEmail: EMAIL, eaName: "Sniper" });
    vi.resetModules();
    const { claimLicenceKeyForEmail } = await import("../api/_handlers/licenses");

    const outcome = await claimLicenceKeyForEmail(KEY, EMAIL);

    expect(outcome.ok).toBe(true);
    const added = sent("SADD", "eamp:key-activated:");
    expect(added, "the gate reads this set — without it the app bounces back to the first page").toHaveLength(1);
    expect(added[0]?.[1]).toBe(`eamp:key-activated:${EMAIL}`);
    expect(added[0]?.[2]).toBe(KEY);
    // The timestamp is the first one only, so the paid date never moves.
    const stamped = sent("SET", "eamp:key-activated-at:");
    expect(stamped).toHaveLength(1);
    expect(stamped[0]?.[1]).toBe(`eamp:key-activated-at:${EMAIL}`);
    expect(String(stamped[0]?.[2])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stamped[0]?.[3]).toBe("NX");
  });

  it("records the re-activation when the SAME account re-enters its own key", async () => {
    // A reinstall, or a claim whose answer was lost on a mobile network: the
    // customer is told "already in use", and the record must still exist.
    claimHolder = EMAIL;
    stubKv({ key: KEY, mentorEmail: "mentor@example.com", clientEmail: EMAIL });
    vi.resetModules();
    const { claimLicenceKeyForEmail } = await import("../api/_handlers/licenses");

    const outcome = await claimLicenceKeyForEmail(KEY, EMAIL);

    expect(outcome.alreadyInUse).toBe(true);
    expect(outcome.heldBy).toBe(EMAIL);
    expect(sent("SADD", "eamp:key-activated:")).toHaveLength(1);
  });

  it("records NOTHING for a key another account already claimed", async () => {
    claimHolder = "someone-else@example.com";
    stubKv();
    vi.resetModules();
    const { claimLicenceKeyForEmail } = await import("../api/_handlers/licenses");

    const outcome = await claimLicenceKeyForEmail(KEY, EMAIL);

    expect(outcome.ok).toBe(false);
    expect(outcome.alreadyInUse).toBe(true);
    expect(sent("SADD", "eamp:key-activated:")).toHaveLength(0);
  });
});
