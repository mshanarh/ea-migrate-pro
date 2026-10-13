import { analyzeMarket } from "../src/lib/market-scanner-core";

// Broker symbol styles across brokers: Exness glued "m", dotted ".m",
// underscore "_m", Headway "HW_", plus plain and synthetic names.
const symbols = ["XAUUSDM", "XAUUSD.m", "XAUUSD_m", "HW_100", "US30m", "BTCUSDM", "EURUSDm", "FLAME", "V75"];
for (const symbol of symbols) {
  const result = await analyzeMarket({ symbol, timeframe: "1h" });
  if (result.ok) {
    const a = result.analysis;
    console.log(
      `${symbol.padEnd(10)} -> ${(a.signal + " " + a.strength).padEnd(14)} src: ${(a.dataSource ?? "").slice(0, 55)}`,
    );
  } else {
    console.log(`${symbol} -> FAIL ${"message" in result ? result.message : ""}`);
  }
}
