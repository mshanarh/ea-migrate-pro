/**
 * Live scanner verification — runs the REAL analysis engine against the
 * REAL public feeds, exactly as the deployed server function will.
 * Run: bun scripts/test-scanner.ts HW_100 XAUUSD FLAME BTCUSD US30
 *
 * NEW ENGINE CONTRACT (strict confluence):
 *  • Real-feed symbols can produce actionable BUY/SELL (gate passed) or
 *    WAIT (gate blocked) — both are valid, correct outcomes.
 *  • Synthesized/synthetic symbols MUST always be WAIT + not executionReady.
 */
import { analyzeMarket } from "../src/lib/market-scanner-core";

const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["US30", "XAUUSD", "BTCUSD", "HW_100", "FLAME"];

let failures = 0;
for (const symbol of symbols) {
  const result = await analyzeMarket({ symbol, timeframe: "1h" });
  if (!result.ok) {
    failures += 1;
    console.log(`❌ ${symbol}: FAILED — ${result.message}`);
    continue;
  }
  const a = result.analysis;
  const simulated = /SIMULATED|synthetic proxy/.test(a.dataSource);
  const contractOk = simulated ? a.strength === "WAIT" && !a.executionReady : true;
  const rr = a.riskReward;
  if (a.dataStatus !== "no-data" && contractOk) {
    const label =
      a.strength === "WAIT"
        ? `WAIT — ${a.reasons.find((r) => r.startsWith("NO TRADE"))?.slice(9, 110) ?? "gate blocked"}`
        : `${a.signal} @ ${a.entry} | SL ${a.stopLoss} | TP ${a.takeProfit} | RR ${rr} | conf ${a.confidence}%`;
    console.log(`✅ ${symbol}: ${label} | candles ${a.candleCount} | ${a.dataSource}`);
  } else {
    failures += 1;
    console.log(`❌ ${symbol}: CONTRACT VIOLATION — strength ${a.strength}, executionReady ${a.executionReady}, source ${a.dataSource}`);
  }
}

console.log(failures === 0 ? "RESULT: ALL SYMBOLS OK" : `RESULT: ${failures} SYMBOL(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
