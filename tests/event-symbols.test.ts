import { describe, expect, it } from "vitest";
import {
  allSymbolsForEvent,
  catalogForEvent,
  legsOf,
  sideForCurrency,
  symbolsForEvent,
} from "../src/lib/event-symbols";

/**
 * A USD event used to offer gold alone, because the old rule was a substring
 * match on the symbol. These assertions pin the real behaviour: every leg is
 * matched, and the side a currency fixes is mechanical.
 */

const ALLOWED = ["XAUUSDm", "EURUSDm", "GBPUSDm", "USDJPYm", "US30m", "BTCUSDm", "GBPJPY", "AUDNZD"];

describe("legsOf", () => {
  it("splits an FX pair with a broker suffix", () => {
    expect(legsOf("EURUSDm")).toMatchObject({ base: "EUR", quote: "USD", fx: true });
    expect(legsOf("US30m")).toMatchObject({ base: "US30", quote: "USD", fx: false, inverts: false });
  });

  it("reads a metal or crypto quoted in USD", () => {
    expect(legsOf("XAUUSDm")).toMatchObject({ base: "XAU", quote: "USD", inverts: true });
    expect(legsOf("BTCUSD")).toMatchObject({ base: "BTC", quote: "USD", inverts: true });
  });

  it("returns null for a symbol with no currency it understands", () => {
    expect(legsOf("GERMANY40X")).toBeNull();
  });
});

describe("symbolsForEvent", () => {
  it("lists every allowed quote a USD event acts on — FX, then metals/crypto, then indices", () => {
    expect(symbolsForEvent("USD", ALLOWED)).toEqual([
      "EURUSDm",
      "GBPUSDm",
      "USDJPYm",
      "XAUUSDm",
      "BTCUSDm",
      "US30m",
    ]);
    // A pair with no USD leg is never offered for a USD event.
    expect(symbolsForEvent("USD", ALLOWED)).not.toContain("GBPJPY");
    expect(symbolsForEvent("USD", ALLOWED)).not.toContain("AUDNZD");
  });

  it("offers the GBP pairs for a GBP event", () => {
    expect(symbolsForEvent("GBP", ALLOWED)).toEqual(["GBPUSDm", "GBPJPY"]);
  });

  it("offers nothing when no allowed quote carries the currency", () => {
    expect(symbolsForEvent("CAD", ALLOWED)).toEqual([]);
  });
});

describe("sideForCurrency", () => {
  it("follows the currency whose strength lifts the pair", () => {
    expect(sideForCurrency("EURUSDm", "EUR", "BUY")).toBe("BUY");
  });

  it("mirrors the side when the currency is the pair's quote", () => {
    expect(sideForCurrency("EURUSDm", "USD", "BUY")).toBe("SELL");
    expect(sideForCurrency("XAUUSDm", "USD", "BUY")).toBe("SELL");
  });

  it("refuses to fix a side for an index CFD the currency only prices", () => {
    expect(sideForCurrency("US30m", "USD", "BUY")).toBeNull();
  });

  it("returns null for a symbol the event does not touch", () => {
    expect(sideForCurrency("AUDNZD", "USD", "BUY")).toBeNull();
  });
});

/**
 * THE EVENT'S OWN LIST — every name it is quoted in, not only this account's
 * Allowed Quotes. That was the report: a USD event showed gold and little
 * else, because the list only ever held the pairs already added.
 */
describe("allSymbolsForEvent", () => {
  it("lists the account's own affected pairs first, then every other name", () => {
    const names = allSymbolsForEvent("USD", ALLOWED);
    // Own, affected, still carrying their broker spelling and at the top.
    expect(names.slice(0, 6)).toEqual([
      "EURUSDm",
      "GBPUSDm",
      "USDJPYm",
      "XAUUSDm",
      "BTCUSDm",
      "US30m",
    ]);
    // …and the rest of the currency's names are there too.
    expect(names).toContain("USDCHF");
    expect(names).toContain("USDCAD");
    expect(names).toContain("NAS100");
    expect(names.length).toBeGreaterThan(15);
  });

  it("never repeats an instrument under a second spelling", () => {
    const names = allSymbolsForEvent("USD", ALLOWED);
    // The account's own suffixed pairs already cover these instruments, so the
    // plain catalog spelling must not appear beside them.
    expect(names).not.toContain("XAUUSD");
    expect(names).not.toContain("BTCUSD");
    expect(names).not.toContain("US30");
    expect(names).toContain("XAUUSDm");
    expect(new Set(names.map((name) => name.toUpperCase())).size).toBe(names.length);
  });

  it("still answers when nothing in Allowed Quotes is affected", () => {
    // GBP is not in this account's list at all — the page must not go empty.
    const names = allSymbolsForEvent("GBP", ["XAUUSDm", "BTCUSDm"]);
    expect(names).toEqual(catalogForEvent("GBP"));
    expect(names).toContain("GBPUSD");
    expect(names).toContain("EURGBP");
  });

  it("falls back to the two USD directions for a currency with no catalog", () => {
    expect(catalogForEvent("ZAR")).toEqual(["ZARUSD", "USDZAR"]);
  });
});
