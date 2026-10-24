import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE BRIDGE ADDRESS IS RESOLVED AT RUNTIME.
 *
 * The tunnel hostname changes whenever cloudflared restarts, so a build-time
 * constant goes stale and every request fails with "Failed to fetch" while the
 * bridge is online. These assertions pin the resolution order — admin setting
 * (KV, via /api/bridge-config) → this device's cached address → env → default —
 * and that a known-dead host is never used again.
 */

const STORAGE_KEY = "eamp.bridge.url.v1";
const DEFAULT_URL = "https://eating-investors-geometry-loans.trycloudflare.com";
const DEAD_URL = "https://camping-geology-operates-consistency.trycloudflare.com";

/** A fresh copy of the module, so its module-level address is re-resolved. */
async function freshModule() {
  vi.resetModules();
  return import("../src/lib/bridge-client");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv("VITE_MT5_BRIDGE_URL", "");
  vi.stubEnv("VITE_BRIDGE_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bridge URL resolution", () => {
  it("falls back to the confirmed tunnel when nothing else is known", async () => {
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });

  it("reads the VITE_-prefixed env override", async () => {
    vi.stubEnv("VITE_MT5_BRIDGE_URL", "https://from-env.example.com/");
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe("https://from-env.example.com");
  });

  it("prefers the address saved on this device", async () => {
    window.localStorage.setItem(STORAGE_KEY, "https://saved-tunnel.trycloudflare.com");
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe("https://saved-tunnel.trycloudflare.com");
  });

  it("never reuses the known-dead tunnel host", async () => {
    window.localStorage.setItem(STORAGE_KEY, DEAD_URL);
    const { getBridgeUrl } = await freshModule();
    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });

  it("purges stale addresses written under older keys", async () => {
    window.localStorage.setItem("bridgeUrl", DEAD_URL);
    window.localStorage.setItem("bridge_url", "http://localhost:8000");
    await freshModule();
    expect(window.localStorage.getItem("bridgeUrl")).toBeNull();
    expect(window.localStorage.getItem("bridge_url")).toBeNull();
  });

  it("saves a new address, normalising a trailing slash", async () => {
    const { getBridgeUrl, setBridgeUrl } = await freshModule();
    expect(setBridgeUrl("https://new-tunnel.trycloudflare.com/")).toBe("https://new-tunnel.trycloudflare.com");
    expect(getBridgeUrl()).toBe("https://new-tunnel.trycloudflare.com");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("https://new-tunnel.trycloudflare.com");
  });

  it("refuses anything that is not an http(s) address", async () => {
    const { getBridgeUrl, setBridgeUrl } = await freshModule();
    expect(setBridgeUrl("ftp://bridge.example.com")).toBeNull();
    expect(setBridgeUrl("not a url")).toBeNull();
    expect(setBridgeUrl("")).toBeNull();
    // The address in use is unchanged by a refused save.
    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });
});

describe("loadBridgeConfig", () => {
  it("adopts the admin-set address from /api/bridge-config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, url: "https://admin-set.trycloudflare.com" }),
      }) as unknown as Response),
    );
    const { getBridgeUrl, loadBridgeConfig } = await freshModule();

    await loadBridgeConfig();

    expect(getBridgeUrl()).toBe("https://admin-set.trycloudflare.com");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("https://admin-set.trycloudflare.com");
  });

  it("keeps the current address when the endpoint is missing (static host)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token <");
        },
      }) as unknown as Response),
    );
    const { getBridgeUrl, loadBridgeConfig } = await freshModule();

    await loadBridgeConfig();

    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });

  it("keeps the current address when the store is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as unknown as Response),
    );
    const { getBridgeUrl, loadBridgeConfig } = await freshModule();

    await loadBridgeConfig();

    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });

  it("ignores a dead address coming back from the store", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, url: DEAD_URL }) }) as unknown as Response),
    );
    const { getBridgeUrl, loadBridgeConfig } = await freshModule();

    await loadBridgeConfig();

    expect(getBridgeUrl()).toBe(DEFAULT_URL);
  });
});

describe("failure messages", () => {
  it("names the address that was actually called", async () => {
    const { bridgeUnreachableMessage } = await freshModule();
    const message = bridgeUnreachableMessage("Failed to fetch");
    expect(message).toContain(DEFAULT_URL);
    expect(message).toContain("Failed to fetch");
  });
});
