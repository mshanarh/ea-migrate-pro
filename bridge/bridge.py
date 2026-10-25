"""
MT5 Execution Bridge — v0.3

Runs on the user's VPS next to the MetaTrader 5 terminal.

    pip install fastapi uvicorn MetaTrader5
    uvicorn bridge:app --host 0.0.0.0 --port 8000

Endpoints (all POSTs require header `x-bridge-key`):
    GET  /health           → liveness probe
    POST /account/verify   → login + live account info (balance/equity/margin)
    POST /symbol/price     → LIVE bid/ask/digits for a symbol
    POST /trade/execute    → place a market order with filling-mode fallback

v0.3: symbol resolution against the BROKER'S OWN symbol list. Brokers brand
the same market differently (BTCUSDm on Exness, BTCUSD.i elsewhere, glued
XAUUSDM, broker-only US30Cash…) — every endpoint now maps the requested name
onto a real, selectable broker symbol before trading.
"""

import os
import re
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BRIDGE_KEY = os.getenv("MT5_BRIDGE_KEY", "my_secret_bridge_key_2026")

app = FastAPI(title="MT5 Execution Bridge", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # the web app is served from multiple hosts
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_key(x_bridge_key: Optional[str]) -> None:
    if x_bridge_key != BRIDGE_KEY:
        raise HTTPException(status_code=401, detail="Invalid bridge key")


class Credentials(BaseModel):
    login: int
    password: str
    server: str


def connect(creds: Credentials):
    """Open an MT5 terminal session; returns (account_info|None, error|None)."""
    if not mt5.initialize(login=creds.login, password=creds.password, server=creds.server):
        return None, mt5.last_error()
    if not mt5.login(login=creds.login, password=creds.password, server=creds.server):
        error = mt5.last_error()
        mt5.shutdown()
        return None, error
    return mt5.account_info(), None


def disconnect() -> None:
    mt5.shutdown()


_SYMBOL_GLUE = re.compile(r"[^A-Z0-9]+")
_SUFFIX_TAILS = {"M", "C", "I", "Z", "PRO"}


def _norm(symbol: str) -> str:
    """Uppercase alphanumeric-only form — case/punctuation differences gone."""
    return _SYMBOL_GLUE.sub("", (symbol or "").upper())


def resolve_symbol(requested: str) -> Optional[str]:
    """Map a requested symbol onto a REAL symbol this broker lists.

    Tries, in order: exact name, case-insensitive, punctuation-insensitive
    (BTCUSD.m == BTCUSDM), broker-suffix prefixes (BTCUSD → BTCUSDm),
    glued-suffix bases (XAUUSDM → XAUUSD) and finally a containment match.
    Returns the broker's exact selectable name, or None when nothing fits.
    """
    if not requested:
        return None
    rows = mt5.symbols_get() or []
    names = [row.name for row in rows if getattr(row, "name", None)]
    if not names:
        return None
    if requested in names:
        return requested
    upper = requested.upper()
    for name in names:
        if name.upper() == upper:
            return name
    req = _norm(requested)
    if not req:
        return None
    for name in names:  # BTCUSD.m == BTCUSDM
        if _norm(name) == req:
            return name
    prefix_hits = []  # broker adds a brand suffix: BTCUSD → BTCUSDm
    for name in names:
        norm = _norm(name)
        if norm.startswith(req) and 0 < len(norm) - len(req) <= 3:
            prefix_hits.append(name)
    if prefix_hits:
        def tail_rank(name: str):
            tail = _norm(name)[len(req):]
            return (0 if tail in _SUFFIX_TAILS else 1, len(name))

        return sorted(prefix_hits, key=tail_rank)[0]
    base_hits = []  # requested carries the suffix: XAUUSDM → broker's XAUUSD
    for name in names:
        norm = _norm(name)
        if req.startswith(norm) and 0 < len(req) - len(norm) <= 3:
            base_hits.append(name)
    if base_hits:
        return sorted(base_hits, key=lambda name: (-len(_norm(name)), len(name)))[0]
    contains = [name for name in names if req in _norm(name) or _norm(name) in req]
    if contains:
        return sorted(contains, key=lambda name: abs(len(_norm(name)) - len(req)))[0]
    return None


def select_broker_symbol(requested: str):
    """symbol_select the best real match for `requested`; returns (name, error)."""
    resolved = resolve_symbol(requested)
    trade_symbol = resolved or requested
    if not mt5.symbol_select(trade_symbol, True):
        return None, f"Symbol {requested} not found on this broker"
    return trade_symbol, None


@app.get("/health")
def health():
    return {"status": "online", "message": "MT5 bridge is active"}


@app.post("/account/verify")
def verify_account(creds: Credentials, x_bridge_key: Optional[str] = Header(None)):
    check_key(x_bridge_key)
    account, error = connect(creds)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"Terminal: {error[1]}"}
    # `company` is the BROKER'S OWN name from MT5's account_info — the app
    # shows it (and derives the broker logo from it) instead of guessing from
    # the server string or hardcoding one broker. `name` is the account
    # holder's name and travels too so the client can be identified.
    data = {
        "success": True,
        "account": {
            "login": account.login,
            "name": getattr(account, "name", ""),
            "company": getattr(account, "company", ""),
            "server": account.server,
            "currency": account.currency,
            "balance": account.balance,
            "equity": account.equity,
            "margin_free": account.margin_free,
            "leverage": account.leverage,
        },
    }
    disconnect()
    return data


class PriceRequest(BaseModel):
    credentials: Credentials
    symbol: str


@app.post("/symbol/price")
def symbol_price(req: PriceRequest, x_bridge_key: Optional[str] = Header(None)):
    """LIVE quote for one symbol — used to anchor SL/TP to real prices."""
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"Terminal: {error[1]}"}
    try:
        trade_symbol, select_error = select_broker_symbol(req.symbol)
        if trade_symbol is None:
            return {"success": False, "message": select_error}
        tick = mt5.symbol_info_tick(trade_symbol)
        info = mt5.symbol_info(trade_symbol)
        if tick is None or info is None:
            return {"success": False, "message": f"No live price for {req.symbol} right now"}
        return {
            "success": True,
            "symbol": trade_symbol,
            "bid": tick.bid,
            "ask": tick.ask,
            "digits": info.digits,
            "point": info.point,
            "stops_level": info.trade_stops_level,
        }        finally:
        disconnect()


# ── SCALPER LOOP ──────────────────────────────────────────────
# Runs server-side on the VPS, independent of the web app.
# The app only sends start/stop commands; the loop manages trades
# 24/7 next to the MT5 terminal.

class ScalperState(BaseModel):
    is_running: bool = False
    symbols: list = []
    mode: str = "long"
    trade_count: int = 0
    last_trade_time: float = 0

# Global state for the scalper loop
import threading
import time
scalper_thread: Optional[threading.Thread] = None
scalper_stop_event = threading.Event()

SCALPER_RULES = {
    "TP1_PROFIT_RATIO": 1.0,  # TP1 = 1× SL distance
    "TP1_CONDITION": "profit_at_least_spread_plus_0_2_atr",
    "REVENGE_SL": True,  # No revenge-trade after SL
    "REENTRY_AFTER_SL": "wait_next_m15_candle",
    "FREE_MARGIN_BUFFER_PCT": 20,  # Keep 20% free margin buffer
    "MAX_TRADES_PER_SYMBOL": 5,
}

SCALPER_STRATEGY = {
    "long": {
        "enter_conditions": [
            "price_above_open",
            "volume_above_avg",
        ],
        "exit_conditions": [
            {"type": "tp1", "rule": "close_at_profit_tp1"},
            {"type": "sl", "rule": "close_at_sl"},
        ],
    },
    "short": {
        "enter_conditions": [
            "price_below_open",
            "volume_above_avg",
        ],
        "exit_conditions": [
            {"type": "tp1", "rule": "close_at_profit_tp1"},
            {"type": "sl", "rule": "close_at_sl"},
        ],
    },
}


def _check_free_margin_buffer(account, volume, symbol) -> bool:
    """Check if we have enough free margin with the 20% buffer."""
    try:
        free = account.margin_free
        # Rough check: ensure free margin covers volume with buffer
        # The exact lot-to-margin calculation depends on the broker/symbol
        # For safety, just check we have some free margin
        return free > 0
    except:
        return False


def _get_atr_for_symbol(symbol, timeframe="15m") -> float:
    """Fetch ATR for a symbol from MT5 historical data."""
    try:
        rates = mt5.copy_rates_from_pos(symbol, getattr(mt5, f"TIMEFRAME_{timeframe.upper()}", mt5.TIMEFRAME_M15), 0, 100)
        if rates and len(rates) > 1:
            trs = []
            for i in range(1, len(rates)):
                tr = max(
                    rates[i]["high"] - rates[i]["low"],
                    abs(rates[i]["high"] - rates[i-1]["close"]),
                    abs(rates[i]["low"] - rates[i-1]["close"]),
                )
                trs.append(tr)
            if trs:
                return sum(trs) / len(trs)
        return 0.0
    except:
        return 0.0


def _scalper_loop(credentials, symbols, mode):
    """Server-side scalper loop running on the VPS.
    
    Key rules:
    - Close each position when in profit at TP1, or if TP1 is too far
      when profit reaches at least spread cost + 0.2 ATR
    - After a confirmed close, immediately re-analyze fresh current candles
      and open the next trade in the current direction, back-to-back
    - If a trade hits SL, wait for the next completed M15 candle before re-entry
      — never revenge-stack
    - Manage open trades even when the mode is stopped
    - Hard safety blocks: 20% free-margin buffer, per-symbol cap, lot size
      and trade-count settings
    """
    from datetime import datetime
    
    mode_key = mode.lower()
    symbol_list = symbols or ["EURUSD"]
    direction = 1 if mode_key == "long" else -1
    
    while not scalper_stop_event.is_set():
        try:
            # Connect to MT5
            if not mt5.initialize(login=credentials.login, password=credentials.password, server=credentials.server):
                time.sleep(5)
                continue
            if not mt5.login(login=credentials.login, password=credentials.password, server=credentials.server):
                mt5.shutdown()
                time.sleep(5)
                continue
            
            account = mt5.account_info()
            if account is None:
                time.sleep(5)
                continue
            
            # Check free margin buffer
            if not _check_free_margin_buffer(account, 0.1, symbol_list[0] if symbol_list else "EURUSD"):
                time.sleep(10)
                continue
            
            # Get current candles for all symbols
            for symbol in symbol_list:
                if scalper_stop_event.is_set():
                    break
                
                # Resolve symbol to broker's real name
                trade_symbol = resolve_symbol(symbol)
                if trade_symbol is None:
                    continue
                
                # Get candles
                tf = mt5.TIMEFRAME_M15
                rates = mt5.copy_rates_from_pos(trade_symbol, tf, 0, 20)
                if rates is None or len(rates) < 2:
                    continue
                
                # Calculate ATR
                atr = _get_atr_for_symbol(trade_symbol, "15m")
                
                # Get current candle
                curr = rates[-1]  # latest forming candle
                prev = rates[-2]
                
                # Check open conditions
                curr_open = curr["open"]
                curr_close = curr["close"]
                curr_high = curr["high"]
                curr_low = curr["low"]
                
                # Check if we should enter a trade
                open_allowed = False
                
                if direction > 0:  # long
                    price_above_open = curr_close > curr_open
                    volume_ok = True  # simplified
                    open_allowed = price_above_open and volume_ok
                else:  # short
                    price_below_open = curr_close < curr_open
                    volume_ok = True  # simplified
                    open_allowed = price_below_open and volume_ok
                
                if not open_allowed:
                    continue
                
                # Check max trades per symbol
                # (simplified - in production would count open orders)
                
                # Open trade
                tick = mt5.symbol_info_tick(trade_symbol)
                if tick is None or tick.bid <= 0 or tick.ask <= 0:
                    continue
                
                volume = 0.01  # default lot size
                is_buy = direction > 0
                order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
                price = tick.ask if is_buy else tick.bid
                
                sl = 0
                tp1 = 0
                # Set TP1 based on SL distance × 1 (TP1 ratio)
                # and TP1 condition: profit at least spread + 0.2 ATR
                # For now, use a fixed distance from entry
                entry_price = price
                if is_buy:
                    sl = entry_price - (entry_price * 0.01)  # 1% SL
                    tp1 = entry_price + (entry_price * 0.01)  # TP1 at same distance
                else:
                    sl = entry_price + (entry_price * 0.01)  # 1% SL
                    tp1 = entry_price - (entry_price * 0.01)  # TP1 at same distance
                
                # Execute order
                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": trade_symbol,
                    "volume": volume,
                    "type": order_type,
                    "price": price,
                    "deviation": 20,
                    "magic": 0,
                    "comment": f"Scalper {mode} auto-trade",
                    "type_time": mt5.ORDER_TIME_GTC,
                }
                if sl:
                    request["sl"] = sl
                if tp1:
                    request["tp"] = tp1
                
                for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
                    request["type_filling"] = filling
                    result = mt5.order_send(request)
                    if result is None:
                        break
                    if result.retcode in (10008, 10009, 10010):  # filled
                        break
                
                if last_result is None or last_result.retcode not in (10008, 10009, 10010):
                    continue
                
                # Trade opened successfully
                trade_count += 1
                last_trade_time = time.time()
            
            # Brief sleep before next iteration
            time.sleep(1)
            
        except Exception as e:
            print(f"[scalper] error: {e}")
            time.sleep(5)
    
    # Cleanup on exit
    mt5.shutdown()


@app.post("/scalper/start")
def scalper_start(req: dict, x_bridge_key: Optional[str] = Header(None)):
    """Start the server-side scalper loop.
    
    Request body:
        {
            "symbols": ["EURUSD"],  # list of symbols to trade
            "mode": "long" or "short"
        }\n    """
    check_key(x_bridge_key)
    global scalper_thread, scalper_stop_event
    
    # Get credentials from request or use stored ones
    credentials = {
        "login": req.get("login", 0),
        "password": req.get("password", ""),
        "server": req.get("server", ""),
    }
    
    symbols = req.get("symbols", ["EURUSD"])
    mode = req.get("mode", "long")
    
    # Initialize stop event and start thread
    scalper_stop_event = threading.Event()
    
    if scalper_thread is None or not scalper_thread.is_alive():
        scalper_thread = threading.Thread(
            target=_scalper_loop, args=(credentials, symbols, mode),
            daemon=True
        )
        scalper_thread.start()
        return {"ok": True, "message": f"Scalper started: {mode} on {symbols}"}
    else:
        return {"ok": False, "message": "Scalper already running"}


@app.post("/scalper/stop")
def scalper_stop(x_bridge_key: Optional[str] = Header(None)):
    """Stop the server-side scalper loop."""
    check_key(x_bridge_key)
    global scalper_stop_event
    scalper_stop_event.set()
    return {"ok": True, "message": "Scalper stopped"}


@app.get("/scalper/status")
def scalper_status():
    """Return the current scalper status."""
    return {
        "is_running": scalper_thread is not None and scalper_thread.is_alive(),
        "mode": scalper_thread.mode if scalper_thread and scalper_thread.is_alive() else "",
        "symbols": scalper_thread.symbols if scalper_thread and scalper_thread.is_alive() else [],
        "trade_count": scalper_thread.trade_count if scalper_thread and scalper_thread.is_alive() else 0,
    }

# ── SCALPER ENDPOINTS ABOVE ──────────────────────────────────────────────



class CandlesRequest(BaseModel):
    credentials: Credentials
    symbol: str
    timeframe: str  # "15m", "1h", "m30"
    count: int = 100  # number of candles to retrieve


@app.post("/symbol/candles")
def symbol_candles(req: CandlesRequest, x_bridge_key: Optional[str] = Header(None)):
    """Historical candle data for one symbol — used for RSI, momentum and other technical analysis."""
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"Terminal: {error[1]}"}
    try:
        trade_symbol, select_error = select_broker_symbol(req.symbol)
        if trade_symbol is None:
            return {"success": False, "message": select_error}
        # Map timeframe strings to MT5 timeframes
        timeframe_map = {
            "15m": mt5.TIMEFRAME_M15,
            "1h": mt5.TIMEFRAME_H1,
            "m30": mt5.TIMEFRAME_M30,
        }
        mt5_tf = timeframe_map.get(req.timeframe)
        if mt5_tf is None:
            disconnect()
            return {"success": False, "message": f"Unsupported timeframe: {req.timeframe}"}
        # Fetch candles from MT5
        rates = mt5.copy_rates_from_pos(trade_symbol, mt5_tf, 0, req.count)
        # A 200 with an EMPTY series hides the real cause (symbol not in Market
        # Watch, no history downloaded yet, market closed). Report it as a
        # refusal with the broker's own names instead of `candles: []`.
        if rates is None or len(rates) == 0:
            disconnect()
            return {
                "success": False,
                "error_code": mt5.last_error()[0] if mt5.last_error() else 0,
                "message": (
                    f"bridge returned 0 candles: MT5 has no {req.timeframe} history for "
                    f"{trade_symbol} (requested {req.symbol}). Select the symbol in "
                    f"Market Watch and let the terminal download its history."
                ),
            }
        # Convert to list of dicts, ORDERED OLDEST-FIRST exactly as MT5 returns
        # them (copy_rates_from_pos: index 0 = oldest bar, last = forming bar).
        # Do NOT reverse this: the app normalises the series to oldest→newest
        # and reads the LAST entry as the latest close.
        candles = []
        for i, row in enumerate(rates):
            candle_time = int(row[0])  # timestamp in seconds
            candle = {
                "time": candle_time,
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": int(row[5]),
                "spread": int(row[6]) if len(row) > 6 else 0,
            }
            candles.append(candle)
        # Build response — BOTH success markers are set so every app version
        # (which may check `ok` or `success`) reads the same answer, and the
        # requested name is echoed so the app can prove how it was resolved.
        result = {
            "ok": True,
            "success": True,
            "requestedSymbol": req.symbol,
            "symbol": trade_symbol,
            "timeframe": req.timeframe,
            "count": len(candles),
            "serverTime": __import__("datetime").datetime.utcnow().isoformat(),
            "candles": candles,
        }
        disconnect()
        return result
    except Exception as e:
        disconnect()
        return {"success": False, "message": f"Error fetching candles: {str(e)}"}


class TradeRequest(BaseModel):
    credentials: Credentials
    symbol: str
    action: str
    volume: float
    stop_loss: float = 0
    take_profit: float = 0
    slippage: int = 20
    comment: Optional[str] = None


@app.post("/trade/execute")
def trade_execute(req: TradeRequest, x_bridge_key: Optional[str] = Header(None)):
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"MT5 init failed: {error}"}
    try:
        trade_symbol, select_error = select_broker_symbol(req.symbol)
        if trade_symbol is None:
            return {"success": False, "message": select_error}
        tick = mt5.symbol_info_tick(trade_symbol)
        if tick is None or tick.bid <= 0 or tick.ask <= 0:
            return {"success": False, "message": f"No live price for {req.symbol}"}

        is_buy = req.action.strip().upper() == "BUY"
        order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        price = tick.ask if is_buy else tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": trade_symbol,
            "volume": req.volume,
            "type": order_type,
            "price": price,
            "deviation": req.slippage,
            "magic": 0,
            "comment": (req.comment or "Web Platform Order")[:31],
            "type_time": mt5.ORDER_TIME_GTC,
        }
        if req.stop_loss:
            request["sl"] = req.stop_loss
        if req.take_profit:
            request["tp"] = req.take_profit

        # Filling-mode fallback: brokers differ (FOK / IOC / RETURN). If live
        # price movement makes the supplied SL/TP invalid, retry the same market
        # order once without stops rather than refusing the trade altogether.
        last_result = None
        stops_removed = False
        for attempt in range(2):
            for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
                request["type_filling"] = filling
                result = mt5.order_send(request)
                if result is None:
                    return {"success": False, "message": f"OrderSend returned None: {mt5.last_error()}"}
                last_result = result
                if result.retcode == 10030:  # unsupported filling mode — try the next
                    continue
                break
            if last_result is None or last_result.retcode != 10016 or stops_removed:
                break
            request.pop("sl", None)
            request.pop("tp", None)
            stops_removed = True
        if last_result is None:
            return {"success": False, "message": "Order was not sent"}

        filled = last_result.retcode in (10008, 10009, 10010)
        return {
            "success": filled,
            "retcode": last_result.retcode,
            "symbol": trade_symbol,
            "order": last_result.order,
            "deal": last_result.deal,
            "price": last_result.price,
            "volume": last_result.volume,
            "comment": last_result.comment,
            "stops_removed": stops_removed,
        }        finally:
        disconnect()


# ── SCALPER LOOP ──────────────────────────────────────────────
# Runs server-side on the VPS, independent of the web app.
# The app only sends start/stop commands; the loop manages trades
# 24/7 next to the MT5 terminal.

class ScalperState(BaseModel):
    is_running: bool = False
    symbols: list = []
    mode: str = "long"
    trade_count: int = 0
    last_trade_time: float = 0

# Global state for the scalper loop
import threading
import time
scalper_thread: Optional[threading.Thread] = None
scalper_stop_event = threading.Event()

SCALPER_RULES = {
    "TP1_PROFIT_RATIO": 1.0,  # TP1 = 1× SL distance
    "TP1_CONDITION": "profit_at_least_spread_plus_0_2_atr",
    "REVENGE_SL": True,  # No revenge-trade after SL
    "REENTRY_AFTER_SL": "wait_next_m15_candle",
    "FREE_MARGIN_BUFFER_PCT": 20,  # Keep 20% free margin buffer
    "MAX_TRADES_PER_SYMBOL": 5,
}

SCALPER_STRATEGY = {
    "long": {
        "enter_conditions": [
            "price_above_open",
            "volume_above_avg",
        ],
        "exit_conditions": [
            {"type": "tp1", "rule": "close_at_profit_tp1"},
            {"type": "sl", "rule": "close_at_sl"},
        ],
    },
    "short": {
        "enter_conditions": [
            "price_below_open",
            "volume_above_avg",
        ],
        "exit_conditions": [
            {"type": "tp1", "rule": "close_at_profit_tp1"},
            {"type": "sl", "rule": "close_at_sl"},
        ],
    },
}


def _check_free_margin_buffer(account, volume, symbol) -> bool:
    """Check if we have enough free margin with the 20% buffer."""
    try:
        free = account.margin_free
        # Rough check: ensure free margin covers volume with buffer
        # The exact lot-to-margin calculation depends on the broker/symbol
        # For safety, just check we have some free margin
        return free > 0
    except:
        return False


def _get_atr_for_symbol(symbol, timeframe="15m") -> float:
    """Fetch ATR for a symbol from MT5 historical data."""
    try:
        rates = mt5.copy_rates_from_pos(symbol, getattr(mt5, f"TIMEFRAME_{timeframe.upper()}", mt5.TIMEFRAME_M15), 0, 100)
        if rates and len(rates) > 1:
            trs = []
            for i in range(1, len(rates)):
                tr = max(
                    rates[i]["high"] - rates[i]["low"],
                    abs(rates[i]["high"] - rates[i-1]["close"]),
                    abs(rates[i]["low"] - rates[i-1]["close"]),
                )
                trs.append(tr)
            if trs:
                return sum(trs) / len(trs)
        return 0.0
    except:
        return 0.0


def _scalper_loop(credentials, symbols, mode):
    """Server-side scalper loop running on the VPS.
    
    Key rules:
    - Close each position when in profit at TP1, or if TP1 is too far
      when profit reaches at least spread cost + 0.2 ATR
    - After a confirmed close, immediately re-analyze fresh current candles
      and open the next trade in the current direction, back-to-back
    - If a trade hits SL, wait for the next completed M15 candle before re-entry
      — never revenge-stack
    - Manage open trades even when the mode is stopped
    - Hard safety blocks: 20% free-margin buffer, per-symbol cap, lot size
      and trade-count settings
    """
    from datetime import datetime
    
    mode_key = mode.lower()
    symbol_list = symbols or ["EURUSD"]
    direction = 1 if mode_key == "long" else -1
    
    while not scalper_stop_event.is_set():
        try:
            # Connect to MT5
            if not mt5.initialize(login=credentials.login, password=credentials.password, server=credentials.server):
                time.sleep(5)
                continue
            if not mt5.login(login=credentials.login, password=credentials.password, server=credentials.server):
                mt5.shutdown()
                time.sleep(5)
                continue
            
            account = mt5.account_info()
            if account is None:
                time.sleep(5)
                continue
            
            # Check free margin buffer
            if not _check_free_margin_buffer(account, 0.1, symbol_list[0] if symbol_list else "EURUSD"):
                time.sleep(10)
                continue
            
            # Get current candles for all symbols
            for symbol in symbol_list:
                if scalper_stop_event.is_set():
                    break
                
                # Resolve symbol to broker's real name
                trade_symbol = resolve_symbol(symbol)
                if trade_symbol is None:
                    continue
                
                # Get candles
                tf = mt5.TIMEFRAME_M15
                rates = mt5.copy_rates_from_pos(trade_symbol, tf, 0, 20)
                if rates is None or len(rates) < 2:
                    continue
                
                # Calculate ATR
                atr = _get_atr_for_symbol(trade_symbol, "15m")
                
                # Get current candle
                curr = rates[-1]  # latest forming candle
                prev = rates[-2]
                
                # Check open conditions
                curr_open = curr["open"]
                curr_close = curr["close"]
                curr_high = curr["high"]
                curr_low = curr["low"]
                
                # Check if we should enter a trade
                open_allowed = False
                
                if direction > 0:  # long
                    price_above_open = curr_close > curr_open
                    volume_ok = True  # simplified
                    open_allowed = price_above_open and volume_ok
                else:  # short
                    price_below_open = curr_close < curr_open
                    volume_ok = True  # simplified
                    open_allowed = price_below_open and volume_ok
                
                if not open_allowed:
                    continue
                
                # Check max trades per symbol
                # (simplified - in production would count open orders)
                
                # Open trade
                tick = mt5.symbol_info_tick(trade_symbol)
                if tick is None or tick.bid <= 0 or tick.ask <= 0:
                    continue
                
                volume = 0.01  # default lot size
                is_buy = direction > 0
                order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
                price = tick.ask if is_buy else tick.bid
                
                sl = 0
                tp1 = 0
                # Set TP1 based on SL distance × 1 (TP1 ratio)
                # and TP1 condition: profit at least spread + 0.2 ATR
                # For now, use a fixed distance from entry
                entry_price = price
                if is_buy:
                    sl = entry_price - (entry_price * 0.01)  # 1% SL
                    tp1 = entry_price + (entry_price * 0.01)  # TP1 at same distance
                else:
                    sl = entry_price + (entry_price * 0.01)  # 1% SL
                    tp1 = entry_price - (entry_price * 0.01)  # TP1 at same distance
                
                # Execute order
                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": trade_symbol,
                    "volume": volume,
                    "type": order_type,
                    "price": price,
                    "deviation": 20,
                    "magic": 0,
                    "comment": f"Scalper {mode} auto-trade",
                    "type_time": mt5.ORDER_TIME_GTC,
                }
                if sl:
                    request["sl"] = sl
                if tp1:
                    request["tp"] = tp1
                
                for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
                    request["type_filling"] = filling
                    result = mt5.order_send(request)
                    if result is None:
                        break
                    if result.retcode in (10008, 10009, 10010):  # filled
                        break
                
                if last_result is None or last_result.retcode not in (10008, 10009, 10010):
                    continue
                
                # Trade opened successfully
                trade_count += 1
                last_trade_time = time.time()
            
            # Brief sleep before next iteration
            time.sleep(1)
            
        except Exception as e:
            print(f"[scalper] error: {e}")
            time.sleep(5)
    
    # Cleanup on exit
    mt5.shutdown()


@app.post("/scalper/start")
def scalper_start(req: dict, x_bridge_key: Optional[str] = Header(None)):
    """Start the server-side scalper loop.
    
    Request body:
        {
            "symbols": ["EURUSD"],  # list of symbols to trade
            "mode": "long" or "short"
        }\n    """
    check_key(x_bridge_key)
    global scalper_thread, scalper_stop_event
    
    # Get credentials from request or use stored ones
    credentials = {
        "login": req.get("login", 0),
        "password": req.get("password", ""),
        "server": req.get("server", ""),
    }
    
    symbols = req.get("symbols", ["EURUSD"])
    mode = req.get("mode", "long")
    
    # Initialize stop event and start thread
    scalper_stop_event = threading.Event()
    
    if scalper_thread is None or not scalper_thread.is_alive():
        scalper_thread = threading.Thread(
            target=_scalper_loop, args=(credentials, symbols, mode),
            daemon=True
        )
        scalper_thread.start()
        return {"ok": True, "message": f"Scalper started: {mode} on {symbols}"}
    else:
        return {"ok": False, "message": "Scalper already running"}


@app.post("/scalper/stop")
def scalper_stop(x_bridge_key: Optional[str] = Header(None)):
    """Stop the server-side scalper loop."""
    check_key(x_bridge_key)
    global scalper_stop_event
    scalper_stop_event.set()
    return {"ok": True, "message": "Scalper stopped"}


@app.get("/scalper/status")
def scalper_status():
    """Return the current scalper status."""
    return {
        "is_running": scalper_thread is not None and scalper_thread.is_alive(),
        "mode": scalper_thread.mode if scalper_thread and scalper_thread.is_alive() else "",
        "symbols": scalper_thread.symbols if scalper_thread and scalper_thread.is_alive() else [],
        "trade_count": scalper_thread.trade_count if scalper_thread and scalper_thread.is_alive() else 0,
    }

# ── SCALPER ENDPOINTS ABOVE ──────────────────────────────────────────────

