import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE SPLASH MUST RESOLVE — 8 SECONDS, WHATEVER THE STORE DOES.
 *
 * The route guards await `requireVerifiedAccess` before anything paints, and
 * that chain is three network calls deep (the access check, a device-binding
 * read, a binding write), each allowed 15s of its own. When a store simply does
 * not answer, the first navigation stayed pending and the shell's black
 * "Loading…" splash was the last thing on screen — forever.
 *
 * These two facts are what make that impossible:
 *
 *   1. the deadline is 8s, and
 *   2. a deadline is answered `retry` (undecided) — NEVER `pay`, `signin` or
 *      `deactivate`. We did not learn that anybody has not paid, only that we
 *      could not ask, so the person lands on the sign-in screen with a RETRY
 *      button instead of the checkout page.
 */

const EMAIL = "client@example.com";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          limit: async () => ({ data: null, error: { message: "unreachable" } }),
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("boot deadline", () => {
  it("is the 8 seconds the splash is promised", async () => {
    const gate = await import("../src/lib/payment-gate");
    expect(gate.BOOT_ACCESS_DEADLINE_MS).toBe(8_000);
  });

  it("answers retry at the deadline when /api/check-access never answers", async () => {
    // A store that accepts the request and never replies — the exact shape of
    // the hang that left the splash up.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => {})));

    const gate = await import("../src/lib/payment-gate");
    vi.useFakeTimers();

    const pending = gate.requireVerifiedAccess(EMAIL);
    await vi.advanceTimersByTimeAsync(gate.BOOT_ACCESS_DEADLINE_MS);
    const verdict = await pending;

    expect(verdict.action).toBe("retry");
    expect(verdict.undecided).toBe(true);
    expect(verdict.message).toBe(gate.VERIFY_RETRY_MESSAGE);
  });

  it("still answers the store's real verdict when it answers in time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, isPaid: true, status: "paid" }),
      })),
    );

    const gate = await import("../src/lib/payment-gate");
    const verdict = await gate.requireVerifiedAccess(EMAIL);
    expect(verdict.action).toBe("pass");
  });
});
