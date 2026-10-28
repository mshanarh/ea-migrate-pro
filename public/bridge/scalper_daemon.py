# -*- coding: utf-8 -*-
"""
scalper_daemon.py — the BATCH scalp cycle.

A standalone Python process that runs 24/7 on the VPS next to the MetaTrader 5
terminal. It is completely independent of Uvicorn and of the web app:

    # start it on its own line in install-scalper.bat:
    python scalper_daemon.py

Every parameter comes from the state file (scalper.state.json) that the
bridge's /scalper/start, /scalper/stop and /scalper/status endpoints manage, so
the double-click script never edits this file — the bridge writes it.

THE CYCLE (one batch per symbol, independently, forever)
-------------------------------------------------------
1. CYCLE START — analyse fresh broker candles (the last 8 COMPLETED M15 bars,
   nothing hardcoded) to read the direction, then open the WHOLE BATCH at once:
   that symbol's configured Number of Trades positions at its configured lot
   size, all in the analysed direction. BTCUSDm set to 4 trades × 0.01 opens
   4 × 0.01; XAUUSDm set to 10 × 0.01 opens 10 × 0.01.
2. HOLD THE BATCH — individual positions are NOT closed when they turn
   positive. A batch rides through the negative legs while the others are up
   (the reference demo sat on -2.12 and -1.82 next to +1.71 and +1.42 and the
   batch stayed open). There is no TP-wait, no spread-recovery wait and no
   countdown anywhere in this file.
   The stop sits just past the extreme of the completed window, exactly the
   rule the app's auto-trader uses.
3. CLOSE THE BATCH — live MT5 positions are polled every 1–2 seconds. The
   moment the batch's COMBINED floating profit across its open positions is
   greater than zero, EVERY position in that batch is closed; each close is
   confirmed by MT5 (retcode 10008/10009/10010) and a failed close is retried
   on the next pass. The combined result is banked, then the daemon
   immediately re-analyses fresh candles and opens the next batch for that
   symbol. Repeat until stopped.
4. AFTER A STOP LOSS — the symbol waits for the next COMPLETED M15 candle
   before a new cycle starts. No revenge stacking.
5. SAFETY — hard blocks only: fresh candle data, executable levels, the 20 %
   free-margin buffer, and the per-symbol trade-count cap (a cycle can never
   exceed the configured Number of Trades). Nothing is ever reported as filled
   that MT5 did not confirm, and both the ANALYSED and the EXECUTED direction
   of every batch are written to the log.

Settings source
---------------
Per symbol, taken from the Allowed Quotes settings the app/bridge wrote into
the state file. Accepted shapes:

    "symbols": [{"symbol": "BTCUSDm", "lot": 0.01, "trade_count": 4},
                {"symbol": "XAUUSDm", "lot": 0.01, "trade_count": 10}]

    "pairs": {"BTCUSDm": {"lot": 0.01, "trade_count": 4}, ...}
    "symbol_settings" / "symbols_detail":   (same two shapes)

A per-symbol entry may carry "enabled": false to be skipped (only enabled
symbols cycle). Whichever source was used is named in the startup log, so the
Applied settings are never a guess.

Those keys only exist once something writes them, and /scalper/start still
sends one flat trio. So the daemon also reads an optional per-symbol file next
to it — scalper.symbols.json — which needs no bridge change at all:

    {"BTCUSDm": {"lot": 0.01, "trade_count": 4},
     "XAUUSDm": {"lot": 0.01, "trade_count": 10}}

Precedence: a per-symbol block in the state file, then scalper.symbols.json,
then the flat symbol/lot/trade_count trio for every listed symbol.

Shared safety rules (unchanged)
-------------------------------
- Only positions carrying this daemon's MAGIC number are ever touched.
- Directional consistency: the side sent == the side analysed (checked).
- All statuses are real broker results; no invented profits or false closes.

State file (scalper.state.json) — written by the bridge, updated by the daemon:
{
  "running": bool,
  "symbol"/"symbols"/"pairs": the per-symbol settings (see above),
  "lot": 0.01,                     # fallback lot when no per-symbol block
  "trade_count": 4,                # fallback trades when no per-symbol block
  "next_trade_number": 1,          # per-session batch numbering
  "started_at"/"stopped_at": ISO8601,
  "wait_until": {"BTCUSDm": epoch},# next-M15 wait after a stop loss
  "batches": {"BTCUSDm": {...}},   # the live batch per symbol
  "positions": {ticket: {...}}     # metadata for the status view
}
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

# MT5 python package — shipped with the terminal
import MetaTrader5 as mt5

# ── configuration the double-click script never edits ─────────────────────────
STATE_FILE = Path(os.getenv("SCALPER_STATE_FILE", Path(__file__).resolve().parent / "scalper.state.json"))
# Optional per-symbol settings file the operator (or the app) can drop next to
# the daemon: {"BTCUSDm": {"lot": 0.01, "trade_count": 4}, ...}. It is read
# BEFORE the flat symbol/lot/trade_count fields, so per-symbol counts always
# win. The bridge does not have to know about it.
SYMBOLS_FILE = Path(os.getenv("SCALPER_SYMBOLS_FILE", Path(__file__).resolve().parent / "scalper.symbols.json"))
EVENT_LOG = Path(os.getenv("SCALPER_EVENT_LOG", Path(__file__).resolve().parent / "scalper-events.log"))
MAGIC = 98765                        # only this EA's orders are ever touched
M15 = mt5.TIMEFRAME_M15
M15_SECONDS = 15 * 60
LAST_BARS = 8                        # the direction lens: 8 completed M15 bars
# The direction and the stop are read EXACTLY like the app's auto-trader
# (src/lib/auto-trade.ts): the net move of the last closes decides the side, the
# live quote only breaks a flat tie, and the stop sits just past the extreme of
# the completed window.
DIRECTION_LOOKBACK = 5               # closes compared: newest vs 5 bars earlier
STOP_PAD_RATIO = 0.0005              # pad beyond the window extreme, as a ratio
MIN_MARGIN_BUFFER = 0.20             # 20 % of equity must stay free
POLL_SECONDS = 1.0                   # between daemon passes: every 1–2 seconds
# THE CLOSE SWEEP's own cadence — every pass re-queries MT5 and closes whatever
# is still open, then waits this long. There is no early exit: the sweep runs
# until the symbol has ZERO positions.
SWEEP_PAUSE_SECONDS = 1.0
# How many times a close is re-read from MT5 before it counts as UNCONFIRMED.
# A retcode alone is not proof: the position must be gone from the book.
CLOSE_CONFIRM_TRIES = 3
CLOSE_CONFIRM_PAUSE = 0.4
# The newest COMPLETED bar must be the current one: catch a dead or behind feed
# without pretending a bar that legitimately closed 14 minutes ago is stale.
MAX_CANDLE_LAG_SECONDS = M15_SECONDS + 60
# A sanity ceiling on the configured Number of Trades. It is NOT a strategy
# setting: it exists so a typo in the settings cannot fire a thousand orders.
TRADE_COUNT_CEILING = 200
DAEMON_VERSION = "3.1"

_log_lines: list[str] = []


def _log(line: str) -> None:
    """Every daemon line lands in scalper-events.log — that IS the app's feed."""
    _log_lines.append(line)
    try:
        EVENT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with EVENT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).isoformat()} | {line}\n")
    except Exception:
        pass


def _time_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_state() -> dict:
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        # The bridge's /scalper/start writes ea_name; keep it always readable
        # so the comment logic below never has to special-case a missing key.
        if "ea_name" not in data:
            data["ea_name"] = "EA Migrate batch"
        return data
    except Exception:
        return {
            "running": False, "symbol": "BTCUSDm", "lot": 0.01, "trade_count": 1,
            "next_trade_number": 1, "started_at": None, "stopped_at": None,
            "positions": {}, "batches": {}, "wait_until": {}, "log": [],
            "ea_name": "EA Migrate batch",
        }


def _write_state(state: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception as exc:
        _log(f"state write failed: {exc}")


def _ea_name(state: dict) -> str:
    """The bot/EA name the bridge was started with, else the default batch tag."""
    name = str(state.get("ea_name", "") or "").strip()
    return name or "EA Migrate batch"


def _trade_comment(state: dict, direction: str) -> str:
    """MT5's comment: the bot's own name, with the direction appended when the
    name is a real bot name (31 chars is MT5's hard limit)."""
    name = _ea_name(state)
    side = (direction or "").strip()
    if name != "EA Migrate batch" and side:
        return f"{name} {side}"[:31]
    return name[:31]


# ── settings: the per-symbol plan ────────────────────────────────────────────

def _as_float(value, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _as_int(value, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _entry_plan(entry: dict, default_lot: float, default_trades: int) -> dict | None:
    """Normalise ONE per-symbol settings entry. None when it is not usable."""
    symbol = str(
        entry.get("symbol") or entry.get("s") or entry.get("name") or ""
    ).strip()
    if not symbol:
        return None
    enabled = entry.get("enabled", entry.get("active", True))
    lot = _as_float(
        entry.get("lot", entry.get("lots", entry.get("lot_size", entry.get("volume")))),
        default_lot,
    )
    trades = _as_int(
        entry.get("trade_count", entry.get("trades", entry.get("max_trades", entry.get("count")))),
        default_trades,
    )
    return {"symbol": symbol, "lots": lot, "trades": trades, "enabled": bool(enabled)}


def _symbols_file_settings() -> object:
    """The optional per-symbol settings file, or None when absent/unreadable."""
    try:
        if SYMBOLS_FILE.exists():
            return json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        _log(f"{SYMBOLS_FILE.name} ignored — not valid JSON: {exc}")
    return None


def _symbol_plans(state: dict) -> tuple[list[dict], str]:
    """(the per-symbol plan, where it came from).

    The plan is [{symbol, lots, trades}] for the ENABLED symbols. Per-symbol
    settings win wherever they are found — inside the state file first, then in
    scalper.symbols.json — and the flat trio the bridge writes today is only
    the fallback for every symbol in its list.
    """
    default_lot = _as_float(state.get("lot"), 0.01)
    default_trades = min(_as_int(state.get("trade_count"), 1), TRADE_COUNT_CEILING)

    plans: list[dict] = []
    source = "the flat symbol/lot/trade_count fields"
    raw = None
    for key in ("symbols", "pairs", "symbol_settings", "symbols_detail"):
        if state.get(key):
            raw = state[key]
            source = f"the state file's \"{key}\" block"
            break
    if raw is None:
        file_settings = _symbols_file_settings()
        if file_settings:
            raw = file_settings
            source = SYMBOLS_FILE.name

    if isinstance(raw, dict):
        # {"BTCUSDm": {"lot": 0.01, "trade_count": 4}, ...}
        for symbol, value in raw.items():
            if isinstance(value, dict):
                plan = _entry_plan({**value, "symbol": symbol}, default_lot, default_trades)
            else:
                # {"BTCUSDm": 0.01} — the value is the lot size
                plan = _entry_plan({"symbol": symbol, "lot": value}, default_lot, default_trades)
            if plan:
                plans.append(plan)
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                plan = _entry_plan(item, default_lot, default_trades)
            else:
                plan = _entry_plan({"symbol": str(item)}, default_lot, default_trades)
            if plan:
                plans.append(plan)

    if not plans:
        # FLAT FALLBACK — one lot/trade count for every symbol in the list.
        symbols_raw = state.get("symbol", state.get("symbols"))
        if isinstance(symbols_raw, str):
            symbols = [s.strip() for s in symbols_raw.split(",")]
        elif isinstance(symbols_raw, list):
            symbols = [str(s).strip() for s in symbols_raw]
        else:
            symbols = []
        for symbol in symbols:
            if symbol:
                plans.append({"symbol": symbol, "lots": default_lot,
                              "trades": default_trades, "enabled": True})
        if plans:
            source = f"{source} (no per-symbol settings found)"

    # Dedupe (first wins) and apply the ceiling + the enabled flag.
    seen: set[str] = set()
    resolved: list[dict] = []
    for plan in plans:
        key = plan["symbol"].upper()
        if key in seen:
            continue
        seen.add(key)
        if not plan["enabled"]:
            continue
        trades = min(plan["trades"], TRADE_COUNT_CEILING)
        if trades != plan["trades"]:
            _log(f"SETTINGS {plan['symbol']}: trade count {plan['trades']} capped at "
                 f"{TRADE_COUNT_CEILING} (the safety ceiling, not a strategy value)")
        resolved.append({"symbol": plan["symbol"], "lots": plan["lots"], "trades": trades})
    return resolved, source


# ── MT5 connection (broker-agnostic) ─────────────────────────────────────────

def _build_creds() -> dict:
    """Build the MT5 connection credentials, broker-agnostic.

    If MT5_LOGIN / MT5_PASSWORD / MT5_SERVER are all set, connect to that
    account exactly as before. If they are NOT set, call mt5.initialize() with
    NO login/password/server arguments so it attaches to the MT5 terminal
    already running on the VPS and uses whatever account and broker are logged
    in there. Never crashes or exits with int(None).
    """
    login = os.getenv("MT5_LOGIN")
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")
    if login is not None and password is not None and server is not None:
        return {"login": int(login), "password": password, "server": server, "account": None}
    if not mt5.initialize():
        error = mt5.last_error()
        _log(f"DAEMON STARTED v{DAEMON_VERSION}: MT5 initialize failed: {error}")
        return {"login": None, "password": None, "server": None, "account": None}
    account = mt5.account_info()
    if account is None:
        _log(f"DAEMON STARTED v{DAEMON_VERSION}: MT5 account info is None after initialize")
    return {"login": None, "password": None, "server": None, "account": account}


def _connect(creds):
    """Attach to MT5 for one operation. See _build_creds for the two modes."""
    login = creds.get("login")
    if login is None:
        account = mt5.account_info()
        if account is None:
            if not mt5.initialize():
                return None, mt5.last_error()
            account = mt5.account_info()
            if account is None:
                return None, "account_info() returned None after re-initialize"
        return account, None
    if not mt5.login(login=login, password=creds.get("password"), server=creds.get("server")):
        error = mt5.last_error()
        mt5.shutdown()
        return None, error
    return mt5.account_info(), None


def _disconnect() -> None:
    mt5.shutdown()


# ── candles + direction ──────────────────────────────────────────────────────

def _last_8_completed_candles(creds, symbol: str) -> list[dict] | None:
    """The last 8 COMPLETED M15 bars, OLDEST → NEWEST (the forming bar dropped).

    The broker's ordering is ASSERTED rather than assumed (the same lesson the
    app's candle helper learned): the rows are sorted by time, then the newest
    entry — the still-forming bar — is dropped. Returns None — a hard block —
    when the data is missing or the feed is behind.
    """
    account, error = _connect(creds)
    if account is None:
        _log(f"BLOCK {symbol}: candle fetch failed — {error}")
        return None
    try:
        if not mt5.symbol_select(symbol, True):
            _log(f"BLOCK {symbol}: symbol not selectable in Market Watch")
            return None
        rates = mt5.copy_rates_from_pos(symbol, M15, 0, LAST_BARS + 1)
        if rates is None or len(rates) < 3:
            _log(f"BLOCK {symbol}: no M15 candles returned")
            return None
        ascending = sorted(
            (
                {"time": int(row[0]), "open": float(row[1]), "high": float(row[2]),
                 "low": float(row[3]), "close": float(row[4]), "volume": int(row[5])}
                for row in rates
            ),
            key=lambda bar: bar["time"],
        )
        bars = ascending[:-1]            # drop the forming bar (newest)
        if len(bars) < LAST_BARS:
            _log(f"BLOCK {symbol}: only {len(bars)} completed M15 candles "
                 f"(need {LAST_BARS})")
            return None
        bars = bars[-LAST_BARS:]
        lag = time.time() - (bars[-1]["time"] + M15_SECONDS)
        if lag > MAX_CANDLE_LAG_SECONDS:
            _log(f"BLOCK {symbol}: the newest completed M15 candle closed {lag:.0f}s "
                 f"ago (> {MAX_CANDLE_LAG_SECONDS}s) — the feed is behind")
            return None
        return bars
    finally:
        _disconnect()


def _direction(bars: list[dict], price: float) -> tuple[str | None, str]:
    """(side, reason) — the app's rule: the net move of the closes decides.

    `bars` is OLDEST → NEWEST completed. The live quote only breaks a genuine
    flat tie; when the closes are flat AND the quote points nowhere there is no
    direction to trade, so the side is None (a hard block, never a default).
    """
    if len(bars) <= DIRECTION_LOOKBACK:
        return None, f"only {len(bars)} completed candles — no direction readable"
    newest = bars[-1]
    reference = bars[-1 - DIRECTION_LOOKBACK]
    net_move = newest["close"] - reference["close"]
    if net_move > 0:
        return "BUY", f"net move {net_move:+.5f} over the last {DIRECTION_LOOKBACK + 1} closes"
    if net_move < 0:
        return "SELL", f"net move {net_move:+.5f} over the last {DIRECTION_LOOKBACK + 1} closes"
    move_now = price - newest["close"]
    if move_now == 0:
        return None, (f"flat closes ({newest['close']:.5f}) and a flat live quote "
                      f"({price:.5f}) point nowhere")
    return ("BUY" if move_now > 0 else "SELL"), f"flat closes, live quote {move_now:+.5f}"


def _sl_for(creds, symbol: str, bars: list[dict], side: str) -> float | None:
    """The stop for the whole batch, or None when the level is not executable.

    Same rule as the app's auto-trader: just past the extreme of the completed
    window, padded by STOP_PAD_RATIO of the window height, and never inside the
    broker's minimum stop distance.
    """
    high = max(bar["high"] for bar in bars)
    low = min(bar["low"] for bar in bars)
    height = high - low
    if not (height > 0):
        _log(f"BLOCK {symbol}: the completed window forms no usable stop range")
        return None
    pad = height * STOP_PAD_RATIO
    account, error = _connect(creds)
    if account is None:
        _log(f"BLOCK {symbol}: no price for the stop level — {error}")
        return None
    try:
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if info is None or tick is None or tick.bid <= 0 or tick.ask <= 0:
            _log(f"BLOCK {symbol}: live price missing — the stop cannot be placed")
            return None
        point = float(info.point or 0)
        min_distance = float(getattr(info, "trade_stops_level", 0) or 0) * point * 1.2
        price = tick.ask if side == "BUY" else tick.bid
        raw = low - pad if side == "BUY" else high + pad
        distance = abs(price - raw)
        if distance < min_distance:
            raw = price - min_distance if side == "BUY" else price + min_distance
        sl = raw
        if sl <= 0:
            _log(f"BLOCK {symbol}: computed stop {sl} is not a usable price")
            return None
        return sl
    finally:
        _disconnect()


# ── live positions (the source of truth) ─────────────────────────────────────

def _live_magic_positions(creds) -> list[dict]:
    """Every open MT5 position this daemon owns (filtered by MAGIC).

    LIVE positions are the source of truth for what is open; the state file is
    metadata only.
    """
    account, error = _connect(creds)
    if account is None:
        _log(f"position list failed: {error}")
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
                "price_open": float(pos.price_open),
                "price_current": float(pos.price_current),
                "sl": float(pos.sl), "tp": float(pos.tp),
                "profit": float(pos.profit), "open": True,
            })
        return live
    finally:
        _disconnect()


def _group_by_symbol(positions: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for pos in positions:
        grouped.setdefault(pos["symbol"], []).append(pos)
    return grouped


# ── orders ───────────────────────────────────────────────────────────────────

def _open_position(creds, symbol: str, side: str, lot: float, sl: float):
    """Send ONE market order with the batch's stop. No take profit: the batch
    itself is the exit (combined profit > 0 closes every leg together), so a
    per-position TP could never fire first."""
    account, error = _connect(creds)
    if account is None:
        _log(f"open {side} {symbol} {lot}: MT5 init failed: {error}")
        return None
    try:
        info = mt5.symbol_info(symbol)
        if info is None or not mt5.symbol_select(symbol, True):
            _log(f"open {side} {symbol} {lot}: symbol not available")
            return None
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.bid <= 0 or tick.ask <= 0:
            _log(f"open {side} {symbol} {lot}: no live price")
            return None
        price = tick.ask if side == "BUY" else tick.bid
        order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        # The comment carries the bot's own name (state written by
        # /scalper/start), never a hard-coded tag.
        comment = _trade_comment(_read_state(), side)
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": 0.0,
            "deviation": 20,
            "magic": MAGIC,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
        }
        # Filling modes differ per broker: FOK → IOC → RETURN, and 10030
        # ("unsupported filling mode") is retried with the next one.
        result = None
        for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            request["type_filling"] = filling
            result = mt5.order_send(request)
            if result is None:
                _log(f"open {side} {symbol} {lot}: order_send returned None "
                     f"({mt5.last_error()})")
                return None
            if result.retcode == 10030:
                continue
            break
        if result is None:
            return None
        filled = result.retcode in (10008, 10009, 10010)
        if not filled:
            _log(f"open {side} {symbol} {lot}: MT5 refused (retcode {result.retcode})")
        return {
            "retcode": result.retcode,
            "order": int(getattr(result, "order", 0) or 0),
            "deal": int(getattr(result, "deal", 0) or 0),
            "price": float(result.price),
            "filled": filled,
        }
    finally:
        _disconnect()


def _realized_profit(ticket: int, fallback: float) -> float:
    """The position's REALIZED result from MT5 history after the close.

    The floating profit read just before the close is an approximation that
    ignores the closing spread, swap and commission. The out-deal in history is
    the broker's own number, so it is used whenever MT5 returns it; the
    floating reading is only the fallback when history is not available yet.
    """
    try:
        deals = mt5.history_deals_get(position=ticket)
    except Exception:
        deals = None
    if not deals:
        return fallback
    out = [deal for deal in deals if int(getattr(deal, "entry", 0)) == 1]  # DEAL_ENTRY_OUT
    if not out:
        return fallback
    return sum(float(getattr(deal, "profit", 0.0)) + float(getattr(deal, "swap", 0.0))
               + float(getattr(deal, "commission", 0.0)) for deal in out)


# ── hard blocks ──────────────────────────────────────────────────────────────
#
# NOTE (v3.1): the old single-ticket `_close_ticket` is DELETED, not wrapped.
# There is exactly one close implementation in this file —
# `_close_ticket_confirmed`, driven by `_sweep_close_symbol`. Two close paths
# is how a leg could be "closed" by one and still be open to the other.

def _hard_block(creds, symbol: str, open_on_symbol: int, plan_trades: int) -> tuple[bool, str]:
    """(blocked, reason). A block stops a NEW batch from opening and never
    stops the management of a batch that is already open."""
    account, error = _connect(creds)
    if account is None:
        return True, f"MT5 not reachable ({error})"
    try:
        info = mt5.symbol_info(symbol)
        if info is None or not mt5.symbol_select(symbol, True):
            return True, f"symbol not available: {symbol}"
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.bid <= 0 or tick.ask <= 0:
            return True, f"live price missing/invalid for {symbol}"
        equity = float(account.equity or 0)
        margin_free = float(account.margin_free or 0)
        if equity > 0 and margin_free < MIN_MARGIN_BUFFER * equity:
            return True, (f"free margin {margin_free:.2f} is below the "
                          f"{MIN_MARGIN_BUFFER * 100:.0f}% buffer of equity {equity:.2f}")
        if open_on_symbol >= plan_trades:
            return True, (f"per-symbol cap reached — {open_on_symbol} open magic "
                          f"position(s) for a configured batch of {plan_trades}")
        return False, ""
    finally:
        _disconnect()


def _can_open_one_more(creds, lots: float) -> tuple[bool, str]:
    """The 20 % buffer re-checked before EVERY order of the batch, so a batch
    can never drain the account on its way in."""
    account, error = _connect(creds)
    if account is None:
        return False, f"MT5 not reachable ({error})"
    try:
        equity = float(account.equity or 0)
        margin_free = float(account.margin_free or 0)
        if equity > 0 and margin_free < MIN_MARGIN_BUFFER * equity:
            return False, (f"free margin {margin_free:.2f} below the "
                           f"{MIN_MARGIN_BUFFER * 100:.0f}% buffer of equity {equity:.2f}")
        return True, ""
    finally:
        _disconnect()


# ── the batch ────────────────────────────────────────────────────────────────

def _session_batch_number(state: dict) -> int:
    return _as_int(state.get("next_trade_number"), 1)


def _next_m15_boundary() -> float:
    """The moment the next M15 candle completes (plus a few seconds to settle)."""
    now = time.time()
    return (int(now // (15 * 60)) + 1) * 15 * 60 + 5


def _open_batch(creds, symbol: str, plan: dict, state: dict) -> dict | None:
    """ANALYSE FRESH CANDLES → OPEN THE WHOLE BATCH AT ONCE.

    Returns the batch record when at least one order was confirmed, else None
    (the reason is already in the log).
    """
    bars = _last_8_completed_candles(creds, symbol)
    if bars is None:
        _log(f"BATCH SKIPPED — {symbol}: no usable fresh candle data")
        return None

    account, error = _connect(creds)
    tick = mt5.symbol_info_tick(symbol) if account is not None else None
    if tick is None or tick.bid <= 0 or tick.ask <= 0:
        _log(f"BATCH SKIPPED — {symbol}: no live price ({error or 'quote empty'})")
        return None
    price = (tick.ask + tick.bid) / 2

    side, basis = _direction(bars, price)
    if side is None:
        _log(f"BATCH SKIPPED — {symbol}: {basis} — nothing to trade")
        return None
    _log(f"ANALYSED {symbol}: {len(bars)} completed M15 candles ({bars[0]['time']} → "
         f"{bars[-1]['time']}) → direction {side} ({basis}, newest close "
         f"{bars[-1]['close']:.5f}, live {price:.5f})")

    sl = _sl_for(creds, symbol, bars, side)
    if sl is None:
        _log(f"BATCH SKIPPED — {symbol}: the stop level is not executable")
        return None

    lots = float(plan["lots"])
    trades = int(plan["trades"])
    batch_no = _session_batch_number(state)

    # The per-symbol cap is absolute: whatever is ALREADY open for this symbol
    # (a batch still closing, a resumed batch, an older one) is counted, so a
    # symbol can never hold more than its configured Number of Trades.
    # SYMBOL-WIDE, not magic-filtered — a leg the app opened on this symbol is
    # still a position the cap has to count, or a new batch lands on top of it.
    already_open = len(_live_symbol_positions(creds, symbol) or [])
    if already_open >= trades:
        _log(f"BATCH SKIPPED — {symbol}: {already_open} position(s) already open for a "
             f"configured batch of {trades} — the per-symbol cap")
        return None
    if already_open:
        _log(f"BATCH {batch_no} {symbol}: {already_open} position(s) already open — "
             f"opening the remaining {trades - already_open} of the configured {trades}")
    wanted = trades - already_open

    opened: list[dict] = []
    failure: str | None = None
    for index in range(wanted):
        allowed, why = _can_open_one_more(creds, lots)
        if not allowed:
            failure = failure or why
            _log(f"BATCH {batch_no} {symbol}: stopped after {index} of {wanted} — {why}")
            break
        fill = _open_position(creds, symbol, side, lots, sl)
        if fill is None or not fill.get("filled"):
            failure = failure or f"MT5 did not confirm order {index + 1}"
            break
        opened.append(fill)

    if not opened:
        _log(f"BATCH {batch_no} NOT OPENED — {symbol}: {failure or 'no order was confirmed'}")
        return None

    entries = ", ".join(f"{fill['price']:.5f}" for fill in opened)
    batch = {
        "cycle": batch_no,
        "symbol": symbol,
        "side": side,
        "lots": lots,
        "trades": trades,
        "opened": len(opened),
        "tickets": [fill["order"] or fill["deal"] for fill in opened],
        "entries": [fill["price"] for fill in opened],
        "sl": sl,
        "opened_at": _time_now(),
        "closing": False,
        "banked": 0.0,
        "closed_legs": 0,
        "stop_window": [round(min(bar["low"] for bar in bars), 5),
                        round(max(bar["high"] for bar in bars), 5)],
    }
    # PER-SESSION NUMBERING: the number is spent only here, on a real batch.
    state["next_trade_number"] = batch_no + 1

    partial = "" if len(opened) == wanted else f" (asked {wanted}, confirmed {len(opened)})"
    if already_open:
        partial += f" — {already_open} already open, cap {trades}"
    _log(f"BATCH {batch_no} OPENED — EXECUTED {side} {symbol} · {len(opened)} × {lots} "
         f"lots{partial} · entries {entries} · SL {sl:.5f} · analysed direction {side}")
    return batch


def _live_symbol_positions(creds, symbol: str) -> list[dict] | None:
    """EVERY open position on this symbol, straight from MT5 — or None when the
    book could not be read.

    THIS IS THE CLOSE PATH'S ONLY SOURCE OF TRUTH, and it is deliberately NOT
    magic-filtered. A batch's legs can be opened by the app's own Execute (magic
    0), by an older build, or by hand; filtering on MAGIC here is what let the
    daemon see ONE leg of an eight-leg batch, "close the batch" and open a new
    one while seven stayed open.

    `None` (not `[]`) on an unreadable book is what keeps the sweep honest: an
    empty list means MT5 said the symbol is empty, so the cycle may advance; a
    failed read must retry instead of being mistaken for a clean symbol.
    """
    account, error = _connect(creds)
    if account is None:
        _log(f"symbol positions failed ({symbol}): {error}")
        return None
    try:
        try:
            positions = mt5.positions_get(symbol=symbol)
        except Exception as exc:
            _log(f"symbol positions failed ({symbol}): {exc!r}")
            return None
        if positions is None:
            return None
        live = []
        for pos in positions:
            live.append({
                "ticket": int(pos.ticket),
                "symbol": pos.symbol,
                "type": "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": float(pos.volume),
                "price_open": float(pos.price_open),
                "price_current": float(pos.price_current),
                "sl": float(pos.sl), "tp": float(pos.tp),
                "profit": float(pos.profit),
                "magic": int(getattr(pos, "magic", 0)),
                "open": True,
            })
        return live
    finally:
        _disconnect()


def _close_ticket_confirmed(creds, ticket: int, symbol: str) -> dict | None:
    """Close ONE ticket and CONFIRM it is gone from MT5.

    Returns `{"ticket", "profit", "retcode"}` only when MT5 accepted the close
    AND the position no longer exists in the book. Returns None otherwise — the
    sweep then re-queries and retries, so an unconfirmed close can never be
    counted as a closed leg.
    """
    account, error = _connect(creds)
    if account is None:
        _log(f"SWEEP close ticket {ticket}: MT5 init failed: {error}")
        return None
    try:
        found = mt5.positions_get(ticket=ticket)
        if not found:
            # Already gone (SL, TP, a manual close or the previous pass) — the
            # caller's fresh re-query sees the truth; there is nothing to close.
            _log(f"SWEEP close ticket {ticket} {symbol}: already closed in MT5")
            return None
        position = found[0]
        if not mt5.symbol_select(symbol, True):
            _log(f"SWEEP close ticket {ticket} {symbol}: symbol not available")
            return None
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            _log(f"SWEEP close ticket {ticket} {symbol}: no live price")
            return None
        is_buy = position.type == mt5.POSITION_TYPE_BUY
        order_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
        price = tick.bid if is_buy else tick.ask
        profit = float(position.profit)
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": int(position.ticket),
            "symbol": symbol,
            # The POSITION's own volume, read on this pass — never a snapshot's.
            "volume": float(position.volume),
            "type": order_type,
            "price": price,
            "deviation": 30,
            "magic": int(getattr(position, "magic", 0)),
            "comment": _trade_comment(_read_state(), ""),
            "type_time": mt5.ORDER_TIME_GTC,
        }
        result = None
        for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            request["type_filling"] = filling
            result = mt5.order_send(request)
            if result is None:
                _log(f"SWEEP close ticket {ticket} {symbol}: order_send returned None "
                     f"({mt5.last_error()})")
                return None
            if result.retcode == 10030:
                continue
            break
        if result is None:
            return None
        if result.retcode not in (10008, 10009, 10010):
            _log(f"SWEEP close ticket {ticket} {symbol}: MT5 refused (retcode "
                 f"{result.retcode}) — retrying next pass")
            return None
        # THE RETCODE IS NOT THE PROOF — the empty slot in the book is.
        for attempt in range(CLOSE_CONFIRM_TRIES):
            still = mt5.positions_get(ticket=ticket)
            if not still:
                return {"ticket": ticket, "profit": _realized_profit(ticket, profit),
                        "retcode": result.retcode}
            if attempt + 1 < CLOSE_CONFIRM_TRIES:
                time.sleep(CLOSE_CONFIRM_PAUSE)
        _log(f"SWEEP close ticket {ticket} {symbol}: MT5 accepted retcode "
             f"{result.retcode} but the position is still in the book — NOT confirmed")
        return None
    finally:
        _disconnect()


def _sweep_close_symbol(creds, symbol: str, batch: dict) -> bool:
    """THE CLOSE PATH. Close EVERY position of this symbol, then say it is clean.

    Structure, deliberately spelled out (no helper in between, no early return):

        while True:
            positions = fresh mt5.positions_get(symbol=<symbol>)   # every pass
            if not positions: break
            for p in positions:
                close p.ticket · confirm · record
            sleep 1s

    The previous version walked ONE snapshot list and then advanced the cycle if
    each call in that list reported success. A leg that MT5 did not close (a
    requote, a different magic, a volume mismatch) dropped out of the picture on
    the next pass, so the batch was declared closed while seven positions were
    still open and a new batch was opened on top of them. Here the symbol itself
    is the exit condition: only ZERO open positions ends the loop, and only then
    does the caller advance the cycle.

    Returns True when the symbol is empty. Never returns early — a close that
    fails keeps the loop running, one second at a time, until it succeeds.
    """
    batch["closing"] = True
    cycle = batch.get("cycle")
    opening_combined = None
    passes = 0
    _log(f"SWEEP START — cycle {cycle} {symbol}: closing EVERY open position; "
         f"the cycle cannot advance until this symbol is empty")

    while True:
        passes += 1
        positions = _live_symbol_positions(creds, symbol)   # FRESH every pass
        if positions is None:
            _log(f"SWEEP pass {passes} — {symbol}: the position book could not be "
                 f"read · retrying (the cycle stays here)")
            time.sleep(SWEEP_PAUSE_SECONDS)
            continue
        if not positions:
            _log(f"SYMBOL CLEAN — 0 positions remain · {symbol} · cycle {cycle} · "
                 f"{passes} pass(es)")
            break

        combined = sum(pos["profit"] for pos in positions)
        if opening_combined is None:
            opening_combined = combined
        _log(f"SWEEP pass {passes} — {symbol}: {len(positions)} position(s) still "
             f"open · combined {combined:+.2f} · tickets "
             f"{', '.join(str(pos['ticket']) for pos in positions)}")

        for pos in positions:
            result = _close_ticket_confirmed(creds, pos["ticket"], symbol)
            if result is None:
                _log(f"SWEEP close NOT CONFIRMED — ticket {pos['ticket']} {symbol} "
                     f"({pos['type']} {pos['volume']}) · retrying next pass")
                continue
            batch["banked"] = float(batch.get("banked") or 0.0) + result["profit"]
            batch["closed_legs"] = int(batch.get("closed_legs") or 0) + 1
            _log(f"SWEEP close CONFIRMED — ticket {pos['ticket']} {symbol} "
                 f"({pos['type']} {pos['volume']}) · realized {result['profit']:+.2f} · "
                 f"leg {batch['closed_legs']} banked")

        if passes % 30 == 0:
            still = _live_symbol_positions(creds, symbol)
            still_state = "unreadable" if still is None else str(len(still))
            _log(f"SWEEP still working — {symbol}: {still_state} position(s) left after "
                 f"{passes} passes · {int(batch.get('closed_legs') or 0)} leg(s) confirmed "
                 f"so far · the cycle cannot advance")
        time.sleep(SWEEP_PAUSE_SECONDS)

    judge = _live_symbol_positions(creds, symbol)
    book_state = "unreadable" if judge is None else f"{len(judge)} position(s)"
    banked = float(batch.get("banked") or 0.0)
    legs = int(batch.get("closed_legs") or 0)
    _log(f"BATCH {cycle} CLOSED — {batch['side']} {symbol} · {legs} positions "
         f"MT5-CONFIRMED · combined result {'+' if banked >= 0 else '-'}${abs(banked):.2f} "
         f"(floating at trigger: {'+' if (opening_combined or 0) >= 0 else '-'}"
         f"${abs(opening_combined or 0):.2f}) · book now {book_state}")
    return True


def _settle_state(state: dict, batches: dict[str, dict], waiting: dict[str, float],
                  live: list[dict]) -> None:
    """Write the metadata the status view reads. Never a claimed fill."""
    state["batches"] = {
        symbol: {key: value for key, value in batch.items()}
        for symbol, batch in batches.items()
    }
    state["wait_until"] = {symbol: until for symbol, until in waiting.items() if until}
    state["positions"] = {
        str(pos["ticket"]): {
            "symbol": pos["symbol"], "type": pos["type"], "volume": pos["volume"],
            "price_open": pos["price_open"], "price_current": pos["price_current"],
            "sl": pos["sl"], "tp": pos["tp"], "profit": pos["profit"], "open": True,
            "batch": (batches.get(pos["symbol"], {}) or {}).get("cycle"),
        }
        for pos in live
    }
    state["last_tick"] = _time_now()
    state["daemon_version"] = DAEMON_VERSION
    _write_state(state)


def _adopt_batch(symbol: str, positions: list[dict], state: dict) -> dict:
    """A batch that survived a restart: the open positions ARE the batch."""
    saved = (state.get("batches") or {}).get(symbol) or {}
    batch = {
        "cycle": _as_int(saved.get("cycle"), _session_batch_number(state)),
        "symbol": symbol,
        "side": positions[0]["type"],
        "lots": float(positions[0]["volume"]),
        "trades": _as_int(saved.get("trades"), len(positions)),
        "opened": len(positions),
        "tickets": [pos["ticket"] for pos in positions],
        "entries": [pos["price_open"] for pos in positions],
        "sl": float(positions[0]["sl"]),
        "opened_at": saved.get("opened_at") or _time_now(),
        "closing": False,
        "banked": float(saved.get("banked") or 0.0),
        "closed_legs": int(saved.get("closed_legs") or 0),
        "resumed": True,
    }
    _log(f"BATCH {batch['cycle']} {symbol} RESUMED — {len(positions)} open magic "
         f"position(s) {batch['side']} {batch['lots']} lots, "
         f"combined floating ${sum(p['profit'] for p in positions):+.2f}")
    return batch


def run() -> None:
    """Entry point: load settings, resume any live batch, then cycle forever."""
    state = _read_state()
    creds = _build_creds()
    if creds.get("login") is not None:
        _log(f"DAEMON STARTED v{DAEMON_VERSION} (login {creds['login']}, "
             f"server {creds['server']})")
    else:
        account = creds.get("account")
        where = f"account {account.login} @ {account.server}" if account else "no account read"
        _log(f"DAEMON STARTED v{DAEMON_VERSION} (no MT5_LOGIN/MT5_PASSWORD/MT5_SERVER set — "
             f"attached to the running MT5 terminal, {where})")

    plans, source = _symbol_plans(state)
    if plans:
        _log(f"SETTINGS from {source}: " + " · ".join(
            f"{plan['symbol']} {plan['trades']} × {plan['lots']}" for plan in plans))
    else:
        _log("SETTINGS: no enabled symbol in the state file — waiting for /scalper/start")

    state["started_at"] = _time_now()
    state["daemon_version"] = DAEMON_VERSION
    _write_state(state)
    _log(f"CLOSE PATH: symbol-wide sweep v{DAEMON_VERSION} — every pass re-queries "
         f"mt5.positions_get(symbol=…), closes each ticket, and the cycle advances "
         f"only after 'SYMBOL CLEAN — 0 positions remain'")

    batches: dict[str, dict] = {}
    waiting: dict[str, float] = {
        symbol: float(until) for symbol, until in (state.get("wait_until") or {}).items()
    }
    # Resume: whatever is open right now belongs to this daemon.
    for symbol, positions in _group_by_symbol(_live_magic_positions(creds)).items():
        batches[symbol] = _adopt_batch(symbol, positions, state)

    stopped_notice = False
    while True:
        try:
            step_state = _read_state()
            if not step_state.get("running"):
                if not stopped_notice:
                    _log(f"DAEMON v{DAEMON_VERSION} idle — waiting for /scalper/start")
                    stopped_notice = True
                time.sleep(5)
                continue
            stopped_notice = False

            plans, _source = _symbol_plans(step_state)
            plan_by_symbol = {plan["symbol"]: plan for plan in plans}
            live = _live_magic_positions(creds)
            grouped = _group_by_symbol(live)

            # A symbol with live positions outside the current plan is still
            # OURS: it is managed to a close, it just cannot open a new batch.
            # `batches` is part of the list as well: a batch whose legs carry a
            # foreign magic is invisible to the magic-filtered snapshot, and it
            # must still be swept.
            symbols = list(dict.fromkeys([
                *plan_by_symbol.keys(), *grouped.keys(), *batches.keys(),
            ]))

            # WHAT THE STATUS VIEW SHOWS — the symbol-wide truth for every symbol
            # this pass touched, so a leg with a foreign magic is visible in the
            # app instead of being filtered out of its own batch.
            shown: list[dict] = []
            for symbol in symbols:
                batch = batches.get(symbol)
                plan = plan_by_symbol.get(symbol)

                # ── THE SYMBOL'S OWN BOOK, FRESH — the close path's truth. ──
                # Not the magic-filtered snapshot above: a batch's legs can
                # carry another magic (the app's own Execute uses 0), and those
                # are exactly the legs that used to be invisible to the close
                # path while they showed in the trader's profit.
                positions = _live_symbol_positions(creds, symbol)
                if positions is None:
                    _log(f"{symbol}: position book unreadable this pass — not judging "
                         f"the batch and NOT opening anything")
                    continue
                shown.extend(positions)

                # ── nothing known about these positions yet (restart) ──────
                if batch is None and positions:
                    batch = _adopt_batch(symbol, positions, step_state)
                    batches[symbol] = batch

                # ── 1) MANAGE AN OPEN BATCH ────────────────────────────────
                if batch is not None:
                    if not positions:
                        # every leg is gone: stop loss, or a close we did not
                        # make. Either way the cycle is over and the symbol
                        # waits for the next completed M15 candle.
                        waiting[symbol] = _next_m15_boundary()
                        batches.pop(symbol, None)
                        _log(f"BATCH {batch['cycle']} {symbol} GONE — every position was "
                             f"closed by the broker (stop loss or manual). Waiting for the "
                             f"next completed M15 candle before a new cycle")
                        continue

                    combined = sum(pos["profit"] for pos in positions)
                    # A close that already started MUST finish, whatever the
                    # market does to the combined figure mid-flight.
                    if batch["closing"] or combined > 0:
                        # ── THE SWEEP: returns only when the symbol is EMPTY ──
                        _sweep_close_symbol(creds, symbol, batch)
                        batches.pop(symbol, None)

                        # NOTHING OPENS UNTIL THE BOOK ITSELF SAYS ZERO.
                        left = _live_symbol_positions(creds, symbol)
                        if not left:
                            # ── 3) IMMEDIATE NEXT CYCLE ───────────────
                            if plan is None:
                                _log(f"BATCH {batch['cycle']} CLOSED — no reopen: {symbol} "
                                     f"is not in the enabled settings any more")
                                continue
                            blocked, reason = _hard_block(
                                creds, symbol, 0, int(plan["trades"]))
                            if blocked:
                                _log(f"REOPEN SKIPPED — {symbol}: {reason} · no batch opened")
                                continue
                            nxt = _open_batch(creds, symbol, plan, step_state)
                            if nxt is not None:
                                batches[symbol] = nxt
                            else:
                                waiting[symbol] = _next_m15_boundary()
                        else:
                            left_state = ("unreadable book" if left is None
                                          else f"{len(left)} position(s) still open")
                            _log(f"REOPEN HELD — {symbol}: {left_state} after the sweep "
                                 f"· no new batch")
                        continue

                    # HOLD — the batch rides through negative legs. Nothing to
                    # do here on purpose: no per-position close, no TP wait, no
                    # countdown.
                    continue

                # ── 2) NO BATCH: start one when the settings allow it ──────
                if plan is None:
                    continue
                # A symbol with ANY open position is mid-cycle: never stack a
                # fresh batch on top of it, whatever the batch book believes.
                if positions:
                    _log(f"BATCH NOT OPENED — {symbol}: {len(positions)} position(s) already "
                         f"open · the symbol must be clean first")
                    continue
                until = waiting.get(symbol, 0.0)
                if until and time.time() < until:
                    continue
                if until:
                    waiting.pop(symbol, None)

                blocked, reason = _hard_block(creds, symbol, 0, int(plan["trades"]))
                if blocked:
                    _log(f"BATCH SKIPPED — {symbol}: {reason}")
                    continue

                batch = _open_batch(creds, symbol, plan, step_state)
                if batch is not None:
                    batches[symbol] = batch
                else:
                    waiting[symbol] = _next_m15_boundary()

            _settle_state(step_state, batches, waiting, shown or live)
        except Exception as exc:  # a thrown pass must never kill a 24/7 loop
            _log(f"LOOP ERROR (v{DAEMON_VERSION}): {exc!r}")
            time.sleep(POLL_SECONDS)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run()
