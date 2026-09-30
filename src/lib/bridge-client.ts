/**
 * MT5 bridge connection details for DIRECT browser → bridge calls.
 *
 * The production app is a static Vite site (no server functions), so the
 * scanner's Execute flow, the live-price lookup for SL/TP and the
 * MetaTrader TEST CONNECTION hit the bridge straight from the browser. The
 * bridge allows CORS from the app's origins (verified).
 *
 * ⚠️ The trycloudflare URL is ephemeral: restarting `cloudflared` mints a
 * new one — update BRIDGE_URL here (one line) when that happens.
 */
export const BRIDGE_URL = "https://camping-geology-operates-consistency.trycloudflare.com";
export const BRIDGE_KEY = "my_secret_bridge_key_2026";

/**
 * Ordered candidates to try when a broker refuses the robot's exact symbol
 * name — brokers brand the same market differently (BTCUSDm on Exness,
 * BTCUSD.i elsewhere, glued XAUUSDM…). The bridge (v0.3+) resolves names
 * itself against the broker's own symbol list; this candidate list keeps the
 * retry working against older bridges too.
 */
export function bridgeSymbolCandidates(symbol: string): string[] {
  const raw = symbol.trim();
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return raw ? [raw] : [];
  // Glued broker suffix (XAUUSDM → XAUUSD): strip one trailing brand letter
  // only when a real base remains (mirrors the scanner's stripBrokerSuffixes).
  let base = cleaned;
  if (/[MCIZ]$/.test(base) && base.length - 1 >= 5) base = base.slice(0, -1);
  const out: string[] = [];
  const push = (value: string) => {
    if (!value) return;
    if (out.some((item) => item.toUpperCase() === value.toUpperCase())) return;
    out.push(value);
  };
  push(raw);
  push(base);
  for (const suffix of ["m", ".m", "c", ".c", "i", ".i", "z", ".z", "M"]) push(base + suffix);
  push(cleaned);
  return out.slice(0, 12);
}
