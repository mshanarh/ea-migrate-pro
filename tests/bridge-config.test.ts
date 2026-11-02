import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE BRIDGE ADDRESS IS HARDCODED.
 *
 * It used to be resolvable at runtime (admin KV value → device cache → env →
 * default), which meant a stale tunnel host saved on a phone or in KV could
 * silently send every request to a dead host while the bridge was online. Now
 * there is exactly one address in `src/lib/bridge-client.ts`, nothing to
 * configure and nothing cached: Test bridge and every scalper call read the
 * same constant.
 */

const EXPECTED_URL = "https://class-risks-protective-positions.trycloudflare.com";

/** A fresh copy of the module, so nothing is shared between assertions. */
async function freshModule() {
  vi.resetModules();
  return import("../src/lib/bridge-client");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bridge address", () => {
  it("is the hardcoded tunnel", async () => {
    const { getBridgeUrl, BRIDGE_URL } = await freshModule();
    expect(BRIDGE_URL).toBe(EXPECTED_URL);
    expect(getBridgeUrl()).toBe(EXPECTED_URL);
  });

  it("ignores any address left in device storage by an older build", async () => {
    window.localStorage.setItem("eamp.bridge.url.v1", "https://stale-tunnel.trycloudflare.com");
    window.localStorage.setItem("bridgeUrl", "http://localhost:8000");
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe(EXPECTED_URL);
  });

  it("ignores build-environment URL overrides", async () => {
    vi.stubEnv("VITE_MT5_BRIDGE_URL", "https://from-env.example.com");
    vi.stubEnv("VITE_BRIDGE_URL", "https://also-from-env.example.com");
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe(EXPECTED_URL);
  });

  it("exposes no setter and no loader — the address cannot be changed at runtime", async () => {
    const mod = (await freshModule()) as Record<string, unknown>;
    expect(mod["setBridgeUrl"]).toBeUndefined();
    expect(mod["loadBridgeConfig"]).toBeUndefined();
    expect(mod["normalizeBridgeUrl"]).toBeUndefined();
  });

  it("reports the host without a protocol for short messages", async () => {
    const { bridgeHost, getBridgeUrl } = await freshModule();
    expect(bridgeHost()).toBe("class-risks-protective-positions.trycloudflare.com");
    expect(bridgeHost(getBridgeUrl())).toBe("class-risks-protective-positions.trycloudflare.com");
  });
});

describe("failure messages", () => {
  it("names the address that was actually called, in the user's terms", async () => {
    const { bridgeUnreachableMessage } = await freshModule();
    const message = bridgeUnreachableMessage(new TypeError("Failed to fetch"));
    expect(message).toContain(EXPECTED_URL);
    expect(message).toContain("DNS/hostname not found");
  });

  it("never reports a browser timeout as the generic phrase", async () => {
    const { describeBridgeFailure } = await freshModule();
    const timeout = new DOMException("signal timed out", "TimeoutError");
    const reason = describeBridgeFailure(timeout, 10_000);
    expect(reason).toContain("timeout");
    expect(reason).toContain("10s");
    expect(reason).not.toContain("signal timed out");
  });
});

/**
 * TEST BRIDGE — three exact outcomes, a 10-second bound and the real reason,
 * always against the one hardcoded address.
 */
describe("testBridgeConnection", () => {
  it("answers Bridge OK on HTTP 200 and calls /scalper/status on the hardcoded address", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return { ok: true, status: 200, json: async () => ({ running: false }) } as unknown as Response;
      }),
    );
    const { testBridgeConnection } = await freshModule();

    await expect(testBridgeConnection()).resolves.toMatchObject({ kind: "ok", url: EXPECTED_URL });
    expect(calls[0]).toBe(`${EXPECTED_URL}/scalper/status`);
  });

  it("sends the bridge key header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response),
    );
    const { testBridgeConnection } = await freshModule();
    await testBridgeConnection();
    const init = (vi.mocked(fetch).mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect((init.headers as Record<string, string>)["x-bridge-key"]).toBe("my_secret_bridge_key_2026");
  });

  it("reports the bridge's HTTP code when it answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 502, json: async () => null }) as unknown as Response),
    );
    const { testBridgeConnection } = await freshModule();
    await expect(testBridgeConnection()).resolves.toEqual({
      kind: "http",
      url: EXPECTED_URL,
      status: 502,
    });
  });

  it("calls a timeout a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      }),
    );
    const { testBridgeConnection } = await freshModule();
    const result = await testBridgeConnection();
    expect(result.kind).toBe("unreachable");
    if (result.kind !== "unreachable") return;
    expect(result.reason).toContain("timeout");
    expect(result.reason).not.toContain("signal timed out");
  });

  it("names a dead hostname/refused connection instead of guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { testBridgeConnection } = await freshModule();
    const result = await testBridgeConnection();
    expect(result.kind).toBe("unreachable");
    if (result.kind !== "unreachable") return;
    expect(result.reason).toContain("DNS/hostname not found");
  });

  it("tells a CORS refusal apart from a dead host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        // The no-CORS probe answers; the real request was blocked.
        if (init?.mode === "no-cors") return { ok: true, status: 0 } as unknown as Response;
        throw new TypeError("Failed to fetch");
      }),
    );
    const { testBridgeConnection } = await freshModule();
    const result = await testBridgeConnection();
    expect(result.kind).toBe("unreachable");
    if (result.kind !== "unreachable") return;
    expect(result.reason).toContain("CORS");
  });
});
