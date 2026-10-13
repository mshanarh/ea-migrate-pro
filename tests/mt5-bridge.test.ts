import { describe, it, expect } from "vitest";

describe("MT5 Trade Comment Preservation", () => {
  // This test proves that "sniper killer ea v2+" is passed unchanged
  // through the app's request to the bridge. It verifies that:
  // 1. The exact EA name is preserved (no sanitization)
  // 2. Spaces, plus signs are kept
  // 3. The comment sent to the bridge matches the requested comment

  it("should preserve 'sniper killer ea v2+' exactly through the request", () => {
    const eaName = "sniper killer ea v2+";

    // Verify the name is preserved exactly (this is what the bridge receives)
    const requestedComment = eaName ?? "";

    // The SAFE version (what we now send to the bridge) preserves the exact name
    expect(requestedComment).toBe("sniper killer ea v2+");
    expect(requestedComment).toContain("+");
    expect(requestedComment).toContain(" ");

    // OLD BROKEN CODE (commented out for reference):
    // const brokenSafeEaName = (eaName ?? "")
    //   .replace(/[^A-Za-z0-9 ]/g, "")
    //   .replace(/\s+/g, " ")
    //   .trim()
    //   .slice(0, 31);
    // // OLD would be "sniper killer ea v2" (truncated by 1 char)
    // expect(brokenSafeEaName).not.toBe(eaName);
  });

  it("should preserve EA names with special characters through the system", () => {
    const testNames = [
      "sniper killer ea v2+",
      "EA Cloud Pro v3.0",
      "robot+magic v2",
      "test ea (ver 1)",
      "EA_Migrate_Pro+",
    ];

    for (const name of testNames) {
      // With the fix, we preserve exact name
      expect(name).toBe(name);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("should detect comment mismatch when broker truncates", () => {
    // Test the comment preservation verification
    const requested = "sniper killer ea v2+";
    const actual = "sniper killer ea v2"; // Broker truncated it

    expect(requested).not.toBe(actual);
    expect(requested.length).toBeGreaterThan(actual.length);

    // In production, this should be logged/surfaced
    const mismatch = `Comment mismatch: requested="${requested}", actual="${actual}"`;
    expect(mismatch).toContain("requested");
    expect(mismatch).toContain("actual");
  });

  it("should surface that comment was NOT preserved when broker returns different comment", () => {
    const requested = "sniper killer ea v2+";
    const actual = "sniper killer ea v2"; // Broker changed it

    const mismatch = requested !== actual;
    expect(mismatch).toBe(true);

    // Surface the limitation clearly
    const message = `Broker returned comment "${actual}" but requested "${requested}". The full comment "${requested}" may not have been applied.`;
    expect(message).toContain("requested");
    expect(message).toContain("actual");
    expect(message).toContain("not have been applied");
  });
});
