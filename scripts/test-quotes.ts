import { fetchLiveQuotes, fmtQuotePrice } from "../src/lib/live-quotes";

const quotes = await fetchLiveQuotes(["XAUUSD.m", "EURUSD", "US30.m", "BTCUSD", "HW_100", "V75"]);
for (const q of quotes) {
  console.log(
    `${q.symbol.padEnd(10)} -> ${(q.resolved || "-").padEnd(8)} ${fmtQuotePrice(q.price).padStart(10)} ${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% ${q.simulated ? "(SIMULATED)" : "(live)"}`
  );
}
