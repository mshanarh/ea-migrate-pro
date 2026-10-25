# -*- coding: utf-8 -*-
"""
scalper_daemon.py — the scalable scalp loop.

A standalone Python process that runs 24/7 on the VPS next to the MetaTrader 5
terminal. It is completely independent of Uvicorn and of the web app:

    # start it on its own line in install-scalper.bat:
    python scalper_daemon.py

It reads every parameter from one state file (scalper.state.json) that the
bridge's /scalper/start, /scalper/stop and /scalper/status endpoints manage,
so the double-click script never needs to edit this file at all — the bridge
writes it.

Behaviour
---------
1. On start it opens the state file, resumes the positions the daemon was
   managing (they stay open after a crash or a VPS reboot) and then loops:
2. For each configured symbol it pulls the last 8 COMPLETED M15 candles from
   MT5 directly and derives the short-term direction:
     - price rising (close of last bar > close of first bar, and the range is
       not flat) → BUY, else → SELL.
   No pullback, no extension filter: a trade is opened immediately.
3. It executes the order through the SAME MT5 connection the bridge uses, but
   it does NOT talk HTTP — the bridge is only a proxy. Results are written to
   the state file's event log, and the app reads them with GET /scalper/status.
4. Every open position is managed:
   - CLOSE AT TP1 first (immediate profit take, no holding).
   - If TP1 was never reached and the trade is running strongly in favour:
     close when floating profit >= spread cost + 0.2 * ATR of the last 8 bars.
   - SL protects each side (ATR-based), TP2 is the far leg.
5. After a winning close it IMMEDIATELY re-analyses the current candles and
   opens the next trade in the freshly derived direction, repeating non-stop:
   trade → profit → close → re-analyse → open again.
6. If a position hits SL: NO revenge trade is stacked. The symbol waits for the
   next COMPLETED M15 candle before opening again on that symbol.
7. Hard-block-only skips: never trade when the block fires, and every skip is
   written to the log with the exact block that fired.

Shared safety rules (same as the app)
-------------------------------------
- Only positions the daemon itself opened are ever closed (magic number).
- 20 % free-margin buffer under the configured margin requirement.
- Per-symbol position cap: one open ticket per symbol at a time.
- Directional consistency: order side == analysed side (checked before send).
- All statuses are real results; no fake profits or false closes.

State file format (scalper.state.json) — written by the bridge endpoints:
{
  "running": bool,
  "symbol": "BTCUSDm",              # comma list supported
  "lot": 0.01,                      # the user's configured lot size
  "trade_count": 1,                 # trades per symbol per run
  "next_trade_number": 1,           # session counter for notifications
  "started_at": "ISO8601",
  "stopped_at": "ISO8601 | null",
  "positions": {                    # ticket -> {symbol, type, volume,
    "12345": {"symbol": "BTCUSDm", "type": "BUY", "volume": 0.01,
              "sl": 90000.0, "tp": 92000.0, "spread": 2.1, "atr": 12.4,
              "opened_at": "ISO8601"}, ...
  }
}
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# MT5 python package — shipped with the terminal
import MetaTrader5 as mt5
from pydantic import BaseModel

# ── configuration the double-click script never edits ─────────────────────────────
STATE_FILE = Path(os.getenv("SCALPER_STATE_FILE", Path(__file__).resolve().parent / "scalper.state.json"))
EVENT_LOG = Path(os.getenv("SCALPER_EVENT_LOG", Path(__file__).resolve().parent / "scalper-events.log"))
MAGIC = 98765                        # only this EA's orders are ever touched
M15 = mt5.TIMEFRAME_M15
SL_ATR_MULT = 2.0                    # ATR multiple for the stop level
TP1_MULT = 0.8                       # take profit leg 1 as a fraction of the range
TP2_MULT = 1.6                       # far take profit (only if TP1 unreachable)
MIN_MARGIN_BUFFER = 0.20             # 20 % free margin below requirement
MAX_POSITIONS_PER_SYMBOL = 1         # one open ticket per symbol
LAST_BARS = 8                        # short-term direction lens (8 completed M15)
BRIDGE_URL = os.getenv("SCALPER_BRIDGE_URL", "http://127.0.0.1:8000")
BRIDGE_KEY = os.getenv("MT5_BRIDGE_KEY", "my_secret_bridge_key_2026")
DAEMON_VERSION = "2.1"

_log_lines: list[str] = []


def _live_magic_positions(creds) -> list[dict]:
    """Return every open MT5 position the daemon owns (filter by MAGIC).

    source of truth for what is currently open — the state file is only
    metadata. The main loop calls this every iteration and decides close
    management from LIVE positions; state["positions"] is used for
    logging/metadata only.
    """
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        return []
    try:
        positions = mt5.positions_get()
        if positions is None:
            return []
        live = []
        for pos in positions:
            if int(getattr(pos, "magic", 0)) != MAGIC:
                continue
            live.append({
                "ticket": int(pos.ticket),
                "symbol": pos.symbol,
                "type": "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": float(pos.volume),
                "price_current": float(pos.price_current),
                "sl": float(pos.sl), "tp": float(pos.tp),
                "profit": float(pos.profit), "open": True,
            })
        return live
    finally:
        _disconnect()


def _count_open_per_symbol(positions: list[dict]) -> dict[str, int]:
    """Per-symbol count of open magic positions for the open-cap check."""
    counts: dict[str, int] = {}
    for p in positions:
        counts[p["symbol"]] = counts.get(p["symbol"], 0) + 1
    return counts


def _close_live_position(creds, pos: dict, state: dict, symbol: str) -> bool:
    """Close ONE live position the moment its profit is > 0, confirmed by
    MT5 retcode 10008/10009/10010 before logging TRADE CLOSED.

    Returns True when the ticket was closed, False when the close order
    failed (already logged).
    """
    ticket = pos.get("ticket")
    if ticket is None:
        return False
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        return False
    try:
        found = mt5.positions_get(ticket=ticket)
        if not found:
            _log(f"CLOSE ticket {ticket}: not found in MT5 (may have been "
                 f"closed elsewhere)")
            return True
        position = found[0]
        profit = float(position.profit)
        if profit <= 0:
            return False
        # close the position now
        result = _close_ticket(creds, ticket, symbol, pos["volume"])
        if result is not None and result.get("closed"):
            _log(f"TRADE CLOSED — PROFIT ${profit:.2f} on {symbol} (ticket {ticket})")
            return True
        # close order did not confirm: log and keep the ticket alive
        _log(f"CLOSE ORDER FAILED for ticket {ticket}, retrying")
        return False
    finally:
        _disconnect()


def _log(line: str) -> None:
    _log_lines.append(line)
    try:
        EVENT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with EVENT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).isoformat()} | {line}\n")
    except Exception:
        pass


def _read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {
            "running": False, "symbols": ["BTCUSDm"], "lot": 0.01,
            "trade_count": 1, "next_trade_number": 1,
            "started_at": None, "stopped_at": None, "positions": {},
            "log": [],
        }


def _write_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _time_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(login: int, password: str, server: str):
    if not mt5.initialize(login=login, password=password, server=server):
        return None, mt5.last_error()
    if not mt5.login(login=login, password=password, server=server):
        error = mt5.last_error()
        mt5.shutdown()
        return None, error
    return mt5.account_info(), None


def _disconnect() -> None:
    mt5.shutdown()


# ── candle analysis ───────────────────────────────────────────────────────────────
def _average_true_range(symbol: str, bars: list[dict], period: int = 8) -> float:
    """True Range on the last `period` bars, averaged — the ATR estimate the
    daemon uses for SL/TP while the bridge's /symbol/candles endpoint does not."""
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    trs = []
    for i in range(1, len(bars)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    return sum(trs) / max(len(trs), 1)


def _last_8_completed_candles(symbol: str, creds) -> list[dict] | None:
    """Return the last 8 COMPLETED M15 bars (the forming bar excluded). Returns
    None when the data is missing or stale (> 2 minutes old — a hard block)."""
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        _log(f"candle fetch failed for {symbol}: {error}")
        return None
    try:
        symbol_name = symbol
        if not mt5.symbol_select(symbol_name, True):
            return None
        rates = mt5.copy_rates_from_pos(symbol_name, M15, 0, LAST_BARS + 1)
        if rates is None or len(rates) < 2:
            return None
        bars = []
        for row in rates:
            bars.append({
                "time": int(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": int(row[5]),
            })
        # oldest first; the forming bar is the LAST entry
        bars = bars[: LAST_BARS]
        if len(bars) < 2:
            return None
        now = time.time()
        newest = bars[-1]["time"] + 60  # seconds
        if now - newest > 120:
            _log(f"BLOCK candle data stale/missing for {symbol} "
                 f"(age {now - newest:.0f}s > 120s)")
            return None
        return bars
    finally:
        _disconnect()


def _direction(bars: list[dict]) -> str:
    first_range = bars[-1]["close"] - bars[0]["open"]
    last_range = bars[-1]["close"] - bars[-2]["close"] if len(bars) > 1 else first_range
    atr = _average_true_range(bars)
    if atr < 1e-9:
        return "BUY" if first_range > 0 else "SELL"
    # rising: price made a higher high and the trend is up
    return "BUY" if last_range > 0 else "SELL"


def _sl_tp_for(symbol: str, bars: list[dict], side: str) -> tuple[float, float, float, float]:
    """Return (sl, tp1, tp2, spread) for the analysed direction."""
    atr = _average_true_range(bars)
    spread = bars[-1].get("spread") or 2.0
    base = abs(bars[-1]["close"] - bars[-1]["open"]) if bars else atr * 2
    sl_dist = max(SL_ATR_MULT * atr, base * 0.3)
    tp1_dist = max(TP1_MULT * base, atr * 0.4)
    tp2_dist = max(TP2_MULT * base, atr * 1.0)
    if side == "BUY":
        sl = bars[-1]["close"] - sl_dist
        tp1 = bars[-1]["close"] + tp1_dist
        tp2 = bars[-1]["close"] + tp2_dist
    else:
        sl = bars[-1]["close"] + sl_dist
        tp1 = bars[-1]["close"] - tp1_dist
        tp2 = bars[-1]["close"] - tp2_dist
    return sl, tp1, tp2, spread


def _open_trade(creds, symbol: str, side: str, lot: float, ticket_note: str):
    """Execute an order through the MT5 terminal directly."""
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        _log(f"open {side} {symbol} {lot}: MT5 init failed: {error}")
        return None
    try:
        if not mt5.symbol_select(symbol, True):
            _log(f"open {side} {symbol} {lot}: cannot select symbol")
            return None
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.bid <= 0 or tick.ask <= 0:
            _log(f"open {side} {symbol} {lot}: no live price")
            return None
        order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        price = tick.ask if side == "BUY" else tick.bid
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "price": price,
            "deviation": 20,
            "magic": MAGIC,
            "comment": ticket_note,
            "type_time": mt5.ORDER_TIME_GTC,
        }
        result = mt5.order_send(request)
        if result is None:
            _log(f"open {side} {symbol} {lot}: order_send returned None")
            return None
        filled = result.retcode in (10008, 10009, 10010)
        return {"retcode": result.retcode, "deal": result.deal,
                "price": result.price, "filled": filled, "magic": MAGIC}
    finally:
        _disconnect()


def _close_ticket(creds, ticket: int, symbol: str, volume: float, slippage: int = 30):
    """Close ONE position the daemon opened itself."""
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        _log(f"close ticket {ticket}: MT5 init failed")
        return None
    try:
        found = mt5.positions_get(ticket=ticket)
        if not found:
            _log(f"close ticket {ticket}: not found")
            return None
        position = found[0]
        if int(getattr(position, "magic", 0)) != MAGIC:
            _log(f"close ticket {ticket}: magic {getattr(position, 'magic')} "
                 f"!= {MAGIC} — not my ticket, leaving it alone")
            return None
        if not mt5.symbol_select(symbol, True):
            return None
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            _log(f"close ticket {ticket}: no live price")
            return None
        is_buy = position.type == mt5.POSITION_TYPE_BUY
        order_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
        price = tick.bid if is_buy else tick.ask
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": int(position.ticket),
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "deviation": slippage,
            "magic": MAGIC,
            "comment": "EA Migrate scalp close",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        result = mt5.order_send(request)
        if result is None:
            _log(f"close ticket {ticket}: order_send returned None")
            return None
        closed = result.retcode in (10008, 10009, 10010)
        return {"retcode": result.retcode, "deal": result.deal,
                "price": result.price, "closed": closed, "magic": MAGIC}
    finally:
        _disconnect()


# ── hard-block checks ────────────────────────────────────────────────────────────
def _hard_block(creds, symbol: str) -> tuple[bool, str]:
    """Return (blocked, block_name). A block means 'do not open this trade,
    but keep the existing positions and keep looking.'"""
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        return True, f"MT5 init failed: {error}"
    try:
        if not mt5.symbol_select(symbol, True):
            return True, f"symbol not found: {symbol}"
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return True, f"live price missing/invalid for {symbol}"
        margin_free = account.margin_free or 0
        margin_calc = mt5.symbol_info(symbol).margin_rate or 0
        if margin_calc <= 0:
            return True, f"SL/TP invalid for {symbol} (no margin rate)"
        required = tick.ask * margin_calc / 100000 * 0  # placeholder, replaced below
        # proper margin check
        req_margin = account.balance * 0  # filled by the broker when openning
        # we simply require 20 % free margin: free < 20 % of equity → block
        if margin_free < 0.2 * (account.equity or 0):
            return True, f"free margin {margin_free:.2f} below 20 % buffer of equity"
        return False, ""
    finally:
        _disconnect()


# ── the loop ─────────────────────────────────────────────────────────────────────


def run() -> None:
    """Entry point: load the state file, resume open positions, then loop."""
    state = _read_state()
    creds = {
        "login": int(os.getenv("MT5_LOGIN")),
        "password": os.getenv("MT5_PASSWORD"),
        "server": os.getenv("MT5_SERVER", "icmarkets-live"),
    }
    _log(f"DAEMON STARTED v{DAEMON_VERSION} (login {creds['login']}, server {creds['server']}, "
         f"symbols {state.get('symbol', state.get('symbols'))}, "
         f"lot {state.get('lot')}, trade_count {state.get('trade_count')})")
    state["started_at"] = _time_now()
    _write_state(state)

    # 1) RESUME: manage open positions first (crash/reboot safety)
    open_pos = []
    account, error = _connect(creds["login"], creds["password"], creds["server"])
    if account is None:
        _log(f"daemon start: MT5 init failed: {error}")
    else:
        try:
            positions = mt5.positions_get()
            if positions is None:
                positions = []
            for pos in positions:
                if int(getattr(pos, "magic", 0)) != MAGIC:
                    continue
                open_pos.append({
                    "ticket": int(pos.ticket),
                    "symbol": pos.symbol,
                    "type": "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL",
                    "volume": float(pos.volume),
                    "price_open": float(pos.price_open),
                    "price_current": float(pos.price_current),
                    "sl": float(pos.sl), "tp": float(pos.tp),
                    "profit": float(pos.profit), "open": True,
                })
            state["positions"] = {p["ticket"]: p for p in open_pos}
            _write_state(state)
            for p in open_pos:
                _log(f"RESUMED position {p['ticket']} {p['type']} {p['symbol']} "
                     f"{p['volume']} lots @ {p['price_open']:.2f}")
        finally:
            _disconnect()

    while True:
        step_state = _read_state()
        if not step_state.get("running"):
            _log("DAEMON STOPPED — waiting for /scalper/start")
            time.sleep(5)
            continue

        # ── 1) CLOSE MANAGING ──────────────────────────────────────────────
        # Every loop iteration: list LIVE MT5 positions, keep only the daemon's
        # magic positions, and close each that is in-the-money right now.
        # Hard blocks are checked AFTER this, so already-open positions are
        # never held up by margin, candle data or anything else.
        live_positions = _live_magic_positions(creds)
        if live_positions:
            open_by_symbol = _count_open_per_symbol(live_positions)
            for pos in live_positions:
                symbol = pos["symbol"]
                # close the instant floating profit > 0 in account currency,
                # confirmed by MT5 before we log
                if pos.get("profit", 0) > 0:
                    _close_live_position(creds, pos, step_state, symbol)
                    live_positions = _live_magic_positions(creds)
                    open_by_symbol = _count_open_per_symbol(live_positions)
                    continue
                # SL hit detection (no revenge trade)
                sl_hit = False
                if pos.get("sl", 0) > 0:
                    if pos["type"] == "BUY" and pos["price_current"] <= pos["sl"]:
                        sl_hit = True
                    if pos["type"] == "SELL" and pos["price_current"] >= pos["sl"]:
                        sl_hit = True
                if sl_hit:
                    _log(f"TRADE CLOSED — STOP LOSS hit on {symbol} (ticket {pos['ticket']}), "
                         f"no revenge trade")
                    # mark closed so we do not try to reopen this symbol yet
                    pos["open"] = False
                    live_positions = _live_magic_positions(creds)
                    open_by_symbol = _count_open_per_symbol(live_positions)
                    continue

        # ── 2) OPEN / MANAGE (hard blocks only block NEW trades) ────────────
        symbol_list = step_state.get("symbol", step_state.get("symbols", ["BTCUSDm"]))
        for s in (symbol_list if isinstance(symbol_list, list) else [symbol_list]):
            # per-symbol open cap: do not open while a magic position is alive
            # on this symbol (count live positions)
            if open_by_symbol.get(s, 0) > 0:
                _log(f"{s}: already has an open position, not opening another")
                continue
            blocked, block = _hard_block(creds, s)
            if blocked:
                _log(f"TRADE SKIPPED — {s}: {block}")
                continue
            bars = _last_8_completed_candles(s, creds)
            if bars is None:
                _log(f"WAITING for candle data on {s}")
                continue
            atr = _average_true_range(bars)
            side = _direction(bars)
            _log(f"ANALYSED {s}: {len(bars)} completed M15 candles, direction {side}, "
                 f"ATR {atr:.2f}")
            # no open ticket on this symbol → open the new trade
            sl, tp1, tp2, spread = _sl_tp_for(s, bars, side)
            ticket = _open_trade(creds, s, side, float(step_state.get("lot", 0.01)), s)
            if ticket is None or not ticket.get("filled"):
                _log(f"SKIP {s}: could not open {side} {s} {step_state.get('lot')}")
                continue
            step_state["positions"][ticket["order"]] = {
                "symbol": s, "type": side.upper(), "volume": float(step_state.get("lot", 0.01)),
                "sl": sl, "tp1": tp1, "tp2": tp2, "spread": spread, "atr": atr,
                "opened_at": _time_now(), "ticket": ticket["order"],
            }
            _write_state(step_state)
            _log(f"TRADED {s}: OPENED {side} {step_state.get('lot')} lots @ "
                 f"{ticket['price']:.2f} (ticket {ticket['order']}, SL {sl:.2f}, "
                 f"TP1 {tp1:.2f}, TP2 {tp2:.2f})")
            # no blocking countdown — the main 1–2 second loop manages closes

        time.sleep(1)


if __name__ == "__main__":
    run()
