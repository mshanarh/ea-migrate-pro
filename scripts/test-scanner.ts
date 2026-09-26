/**
 * Live scanner verification — runs the REAL analysis engine against the
 * REAL public feeds, exactly as the deployed server function will.
 * Run: bun scripts/test-scanner.ts HW_100 XAUUSD FLAME BTCUSD US30
 */
import { analyzeMarket } from "../src/lib/market-scanner-core";

const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["HW_100", "XAUUSD", "FLAME"];

let failures = 0;
for (const symbol of symbols) {
  const result = await analyzeMarket({ symbol, timeframe: "1h" });
  if (result.ok && result.analysis.dataStatus !== "no-data") {
    const a = result.analysis;
    console.log(
      `✅ ${symbol}: ${a.signal} @ ${a.entry} | SL ${a.stopLoss} | TP ${a.takeProfit} | RR ${a.riskReward} | conf ${a.confidence}% | candles ${a.candleCount} | ${a.dataSource}`,
    );
  } else if (result.ok) {
    failures += 1;
    console.log(`❌ ${symbol}: NO DATA — ${result.analysis.reasons[0]}`);
  } else {
    failures += 1;
    console.log(`❌ ${symbol}: FAILED — ${result.message}`);
  }
}

console.log(failures === 0 ? "RESULT: ALL SYMBOLS OK" : `RESULT: ${failures} SYMBOL(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
