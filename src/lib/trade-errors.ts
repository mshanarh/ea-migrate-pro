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

/**
 * MetaTrader order_send retcodes — the broker's own verdict on an order.
 * The bridge can answer HTTP 200 while the BROKER rejected the trade, so
 * the retcode (or success flag) in the body is the only source of truth.
 */
export function friendlyRetcode(code: number): string | null {
  switch (code) {
    case 10008:
    case 10009:
      return null; // PLACED / DONE — genuine success
    case 10004:
      return "The broker requoted — market moved before the order was accepted. Try again.";
    case 10006:
      return "The broker rejected the order — check the lot size and try again.";
    case 10013:
      return "The broker rejected the request as invalid — often a wrong/renamed symbol or bad price. Check the exact symbol name in your MT5 app.";
    case 10014:
      return "Invalid lot size for this symbol — try a larger lot (many brokers start at 0.10).";
    case 10015:
      return "Invalid price — the planned price is too far from the live market. Scan again for fresh levels.";
    case 10016:
      return "Invalid stops — the SL/TP sit inside the broker's minimum stop distance. Try again after a fresh scan, or execute without SL/TP.";
    case 10017:
      return "Trading is disabled for this symbol on your account — check it in your MT5 app.";
    case 10018:
      return "This market is closed right now — try again when it reopens.";
    case 10019:
      return "Not enough free margin — lower the lot size or the number of trades.";
    case 10030:
      return "The broker does not support this order filling mode — the bridge needs its filling-mode setting adjusted for your account.";
    default:
      return `The broker refused the order (MT5 code ${code}).`;
  }
}
