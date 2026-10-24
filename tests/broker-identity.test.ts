import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brokerDomain,
  brokerIdentity,
  brokerLogoUrl,
  companyFromBridgeReply,
  serverFromBridgeReply,
} from "@/lib/broker-identity";

/**
 * THE BROKER NAME AND LOGO COME FROM THE BROKER.
 *
 * The account sync screen used to say "Headway" and show the MetaTrader mark
 * whatever was connected. These assertions pin the replacement: the company
 * comes from the bridge's own `account.company`, the domain from a lookup, and
 * the logo URL only exists when a domain AND a publishable key are available —
 * otherwise the caller falls back to the MetaTrader mark.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("broker domain lookup", () => {
  it("recognises the brokers this app actually sees", () => {
    expect(brokerDomain("Exness Technologies Ltd")).toBe("exness.com");
    expect(brokerDomain("Headway")).toBe("headway.net");
    expect(brokerDomain("Deriv (SVG) LLC")).toBe("deriv.com");
    expect(brokerDomain("XM Global Limited")).toBe("xm.com");
    expect(brokerDomain("IC Markets (Pty) Ltd")).toBe("icmarkets.com");
    expect(brokerDomain("ForexTime (FXTM)")).toBe("forextime.com");
    expect(brokerDomain("RoboForex Ltd")).toBe("roboforex.com");
    expect(brokerDomain("Hantec Markets")).toBe("hantecmarkets.com");
  });

  it("falls back to the server name when the company is blank", () => {
    expect(brokerDomain("", "Exness-MT5Real8")).toBe("exness.com");
    expect(brokerDomain("", "ICMarketsSC-MT5-4")).toBe("icmarkets.com");
  });

  it("never guesses for an unknown broker", () => {
    expect(brokerDomain("")).toBeNull();
    expect(brokerDomain("Some Local Broker Ltd", "SomeLocal-MT5")).toBeNull();
  });
});

describe("broker logo", () => {
  it("builds a logo.dev URL with the publishable key from the environment", () => {
    vi.stubEnv("VITE_LOGO_DEV_KEY", "pk_test_123");
    expect(brokerLogoUrl("Exness", "Exness-MT5Real8")).toBe(
      "https://img.logo.dev/exness.com?token=pk_test_123&size=160&format=png&retina=true",
    );
  });

  it("returns null (→ MetaTrader mark) without a key or for an unknown broker", () => {
    vi.stubEnv("VITE_LOGO_DEV_KEY", "");
    expect(brokerLogoUrl("Exness")).toBeNull();
    vi.stubEnv("VITE_LOGO_DEV_KEY", "pk_test_123");
    expect(brokerLogoUrl("Unknown Broker")).toBeNull();
  });

  it("describes the identity in one call", () => {
    vi.stubEnv("VITE_LOGO_DEV_KEY", "pk_test_123");
    const identity = brokerIdentity("Quantum Blue Broker", "Unknown-MT5");
    expect(identity.company).toBe("Quantum Blue Broker");
    expect(identity.domain).toBeNull();
    expect(identity.logoUrl).toBeNull();
  });
});

describe("reading the bridge reply", () => {
  it("takes the company from account.company", () => {
    expect(companyFromBridgeReply({ success: true, account: { company: "Exness Technologies Ltd" } })).toBe(
      "Exness Technologies Ltd",
    );
  });

  it("never invents a broker name", () => {
    expect(companyFromBridgeReply({ success: true, account: {} })).toBe("");
    expect(companyFromBridgeReply({ success: true, account: { company: "   " } })).toBe("");
    expect(companyFromBridgeReply(null)).toBe("");
    expect(companyFromBridgeReply("Exness")).toBe("");
  });

  it("reads the server for the secondary line", () => {
    expect(serverFromBridgeReply({ account: { server: "Exness-MT5Real8" } })).toBe("Exness-MT5Real8");
    expect(serverFromBridgeReply({ account: {} })).toBe("");
  });
});
