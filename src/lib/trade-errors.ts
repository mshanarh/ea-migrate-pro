/**
 * Translates raw MT5/bridge errors into clear, actionable guidance. The
 * bridge passes through MetaTrader's own codes (e.g. "MT5 init failed:
 * (-6, 'Terminal: Authorization failed')"), which mean nothing to traders.
 * Shared by the scanner's Execute flow and the MetaTrader TEST CONNECTION.
 */
export function friendlyTradeError(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("authorization failed") || text.includes("-6") || text.includes("auth")) {
    return "Login failed — check your MT5 login, MASTER password and exact server name, then re-save them on the MetaTrader page.";
  }
  if (text.includes("invalid volume") || text.includes("volume")) {
    return "The broker rejected the lot size — try a larger lot (many brokers start at 0.10 on synthetics).";
  }
  if (text.includes("invalid stops") || text.includes("invalid price") || text.includes("stops")) {
    return "The broker rejected the stop levels — try the trade without SL/TP or scan again for fresh levels.";
  }
  if (text.includes("market closed") || text.includes("trading disabled")) {
    return "This market is closed right now — try again when it reopens or pick another symbol.";
  }
  if (text.includes("not enough money") || text.includes("margin") || text.includes("no money")) {
    return "Not enough free margin for this trade — lower the lot size or the number of trades.";
  }
  if (text.includes("symbol") && (text.includes("unknown") || text.includes("not found") || text.includes("invalid"))) {
    return "This broker does not list that symbol — check the exact name in your MT5 app (e.g. HW_100 vs FLAME).";
  }
  return raw;
}
