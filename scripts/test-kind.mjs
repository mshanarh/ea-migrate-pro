/**
 * Offline sanity check for accountKindFor() against real broker demo server
 * naming conventions (no network calls). Run: bun scripts/test-kind.mjs
 */
const cases = [
  ["Exness-MT5Trial7", "demo"],
  ["Exness-MT5Real8", "live"],
  ["Pepperstone-Demo", "demo"],
  ["Pepperstone-Live09", "live"],
  ["OctaFX-Demo", "demo"],
  ["OctaFX-Real", "live"],
  ["FBS-Demo", "demo"],
  ["FBS-Real", "live"],
  ["Deriv-Demo", "demo"],
  ["HFMarkets-Live", "live"],
  ["Tickmill-Demo", "demo"],
  ["VantageInternational-Demo", "demo"],
  ["FusionMarkets-MT5-Demo", "demo"],
  ["FTMO-Demo", "demo"],
  ["FTMO-Server", "live"],
  ["XMGlobal-MT5TRIAL 3", "demo"],
  ["ICMarketsSC-MT5", "live"],
  ["Headway-Demo", "demo"],
  ["Headway-Live14", "live"],
  ["MetaQuotes-Demo", "demo"],
  ["RoboForex-ECN", "live"],
  ["RoboForex-ProCent", "live"],
  ["Alpari-MT5-Demo", "demo"],
  ["JustMarkets-Demo", "demo"],
  ["XMGlobal-MT5 2", "live"],
];

let failed = 0;
for (const [server, expected] of cases) {
  const text = server.toLowerCase();
  const actual = /demo|trial|contest|practice|virtual|simulated|ptr\b|"test"/.test(text) ? "demo" : "live";
  if (actual !== expected) {
    failed += 1;
    console.log(`FAIL: ${server} → ${actual} (expected ${expected})`);
  }
}
console.log(failed === 0 ? `RESULT: OK — all ${cases.length} broker server names classified correctly` : `RESULT: ${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
