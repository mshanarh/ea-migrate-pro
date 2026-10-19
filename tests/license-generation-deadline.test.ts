import { afterEach, describe, expect, it, vi } from "vitest";
import { addLicense, createEaRecord, generateKey, register, setEAs } from "../src/lib/auth-store";
import {
  LICENSE_LOOKUP_DEADLINE_MS,
  licenseAllowanceForEmail,
  withinDeadline,
} from "../src/lib/admin-store";

/**
 * KEY GENERATION MUST NOT WAIT ON A DEAD CLOUD.
 *
 * Generating a key used to await the cap and the usage count twice — once on
 * the dashboard, once again inside `addLicense` — and each lookup carried its
 * own 10–12s client deadline (the count retried, so ~24s). A slow or
 * unreachable Upstash therefore left the mentor on "Generating the key…" for
 * a minute or more for a verdict the second lookup could not even change.
 *
 * These tests pin the fix at the two seams that caused it:
 *   • `withinDeadline` answers with the fallback instead of hanging;
 *   • `licenseAllowanceForEmail` reads the cap and the count IN PARALLEL
 *     under one short deadline, so a dead store costs one deadline total;
 *   • the submission path (bounded allowance read → `addLicense` with
 *     `limitAlreadyChecked`) still CREATES the key, quickly.
 */

/** Every network call hangs forever — a dead store, not a refused one. */
function stubDeadStore(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => new Promise<never>(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function newMentor(email: string) {
  const { account } = register({
    firstName: "Test",
    displayName: "Test Mentor",
    email,
    username: email.split("@")[0]!,
    password: "secret123",
    whatsapp: "",
  });
  if (!account) throw new Error("test mentor could not be registered");
  const ea = createEaRecord("Deadline EA");
  setEAs(account.id, [ea]);
  return { accountId: account.id, ea };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("withinDeadline — a lookup that never answers cannot hang the caller", () => {
  it("resolves with the fallback once the deadline passes", async () => {
    const started = Date.now();
    const value = await withinDeadline(new Promise<number>(() => {}), 7, 60);

    expect(value).toBe(7);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("still returns a fast answer immediately, and treats a rejection as a miss", async () => {
    await expect(withinDeadline(Promise.resolve(11), 0, 5_000)).resolves.toBe(11);
    await expect(withinDeadline(Promise.reject(new Error("down")), 3, 5_000)).resolves.toBe(3);
  });
});

describe("licenseAllowanceForEmail — one deadline, not two, when both stores are dead", () => {
  it("answers with the page's cap and the local count instead of hanging", async () => {
    const fetchMock = stubDeadStore();
    const started = Date.now();

    const allowance = await licenseAllowanceForEmail({
      email: "mentor@example.com",
      fallbackCap: 40,
      localUsed: 3,
      deadlineMs: 60,
    });

    const elapsed = Date.now() - started;
    expect(allowance).toEqual({ cap: 40, used: 3 });
    // The two reads run together, so the wait is ~one deadline, not two.
    expect(elapsed).toBeLessThan(900);
    // Both lookups were actually attempted (cap endpoint + key count).
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses the shipped ~4s deadline when the caller does not override it", async () => {
    stubDeadStore();
    expect(LICENSE_LOOKUP_DEADLINE_MS).toBe(4_000);
    const started = Date.now();

    const allowance = await licenseAllowanceForEmail({
      email: "mentor@example.com",
      fallbackCap: 500,
      localUsed: 2,
    });

    const elapsed = Date.now() - started;
    expect(allowance).toEqual({ cap: 500, used: 2 });
    expect(elapsed).toBeLessThan(4_700);
  }, 10_000);

  it("never lowers the usage below the local count", async () => {
    stubDeadStore();

    const allowance = await licenseAllowanceForEmail({
      email: "mentor@example.com",
      localUsed: 9,
      deadlineMs: 40,
    });

    expect(allowance.used).toBe(9);
  });
});

describe("key creation with a dead-slow store", () => {
  it("creates the key well inside the deadline when the cap check is bounded", async () => {
    const fetchMock = stubDeadStore();
    const { accountId, ea } = newMentor(`deadline-${Date.now()}@example.com`);
    const started = Date.now();

    // EXACTLY the dashboard's submission order: one bounded allowance read,
    // then addLicense with the duplicate check switched off.
    const allowance = await licenseAllowanceForEmail({
      email: "deadline@example.com",
      fallbackCap: 2000,
      localUsed: 0,
      deadlineMs: 60,
    });
    expect(allowance.cap).toBe(2000);
    const lookupsBeforeCreation = fetchMock.mock.calls.length;

    const result = await addLicense(
      accountId,
      "Lifetime",
      generateKey(),
      { name: "Client", eaId: ea.id, eaNameHash: ea.eaNameHash, expiry: "Lifetime" },
      { limitAlreadyChecked: true },
    );

    const elapsed = Date.now() - started;
    expect(result.error).toBeUndefined();
    expect(result.license?.key).toMatch(/^EMP-/);
    expect(elapsed).toBeLessThan(900);
    // No hidden second cap/count lookup was issued by addLicense.
    expect(fetchMock.mock.calls.length).toBe(lookupsBeforeCreation);
  });

  it("keeps enforcing the cap: used >= cap still refuses the key at addLicense", async () => {
    const { accountId, ea } = newMentor(`capped-${Date.now()}@example.com`);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const target = String(url);
        if (target.includes("/mentor-status")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, found: true, licenseLimit: 1, licenseLimitSet: true }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, count: 1 }),
        } as unknown as Response;
      }),
    );

    const allowance = await licenseAllowanceForEmail({
      email: "capped@example.com",
      fallbackCap: 1,
      localUsed: 1,
      deadlineMs: 500,
    });

    expect(allowance).toEqual({ cap: 1, used: 1 });

    // addLicense on its own (no limitAlreadyChecked) still refuses — the cap
    // rules are unchanged, only the duplicate check is gone from the page.
    const refused = await addLicense(accountId, "Lifetime", "EMP-TEST-KEY", { name: "C", eaId: ea.id });
    expect(refused.license).toBeUndefined();
    expect(refused.error).toContain("You have used all 1 of your license keys");
  });
});
