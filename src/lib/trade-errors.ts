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
  if (text.includes("invalid \"comment\"") || (text.includes("comment") && text.includes("invalid"))) {
    return "MT5 rejected the order comment — the app strips unsafe characters automatically; simplify the bot's name if this keeps happening.";
  }
  if (text.includes("symbol") && (text.includes("unknown") || text.includes("not found") || text.includes("invalid"))) {
    return "Couldn't match that symbol on your broker under any known name — open MT5 → Market Watch, find the exact symbol there and use that exact name in your robot's pairs.";
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
    case 10007:
      return "The order was cancelled before it could be filled — try again.";
    case 10010:
      return null; // DONE_PARTIAL — a (partial) fill still happened
    case 10011:
      return "The trade server reported an internal error — try again in a moment.";
    case 10012:
      return "The broker timed out processing the order — check your MT5 Trade tab before retrying.";
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
    case 10020:
      return "The price changed while placing the order — try again.";
    case 10021:
      return "No live price for this symbol right now — the broker has no quotes for it at the moment.";
    case 10022:
      return "Invalid order expiration — the broker rejected the expiry setting.";
    case 10023:
      return "The order state changed before execution — check your MT5 Trade tab.";
    case 10024:
      return "Too many requests — the broker is rate-limiting. Wait a few seconds and try fewer trades at once.";
    case 10025:
      return "No changes — the order matched what the broker already has.";
    case 10026:
      return "AutoTrading is disabled by the BROKER's server for this account — enable it in your MT5 app (or contact the broker).";
    case 10027:
      return "AutoTrading (Algo Trading) is OFF in the MT5 terminal on the trading server — click the AutoTrading ⚡ button in its toolbar, then execute again.";
    case 10028:
      return "The order or position is locked by the broker right now — try again shortly.";
    case 10029:
      return "The order or position is frozen — modifications are temporarily blocked.";
    case 10030:
      return "The broker does not support this order filling mode — the bridge needs its filling-mode setting adjusted for your account.";
    case 10031:
      return "No connection to the broker's trade server — check the MT5 terminal on the trading server shows a live connection (bottom-right corner).";
    case 10032:
      return "This order type is only allowed on real accounts — demo accounts cannot place it.";
    case 10033:
      return "Too many pending orders on the account — the broker's order limit was reached.";
    case 10034:
      return "Total volume limit reached — the account's open volume exceeds the broker's cap.";
    case 10038:
      return "The close volume exceeds the open position volume.";
    default:
      return `The broker refused the order (MT5 code ${code}).`;
  }
}
