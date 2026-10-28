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

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
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
        }
    finally:
        disconnect()


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
    # Every order carries a magic number so the app can later find and close
    # ONLY the positions it opened itself — never manual trades, never another
    # EA's positions.
    magic: int = 0


class ScalperStartRequest(BaseModel):
    credentials: Credentials
    symbol: str
    lot: float = 0.01
    trade_count: int = 1
    ea_name: str = ""
    # Optional direction tag appended to the EA name in the trade comment.
    direction: str = ""
    # Comma-separated symbol list, e.g. "BTCUSDm,ETHUSDm"
    symbols: str = "BTCUSDm"


class ScalperStopRequest(BaseModel):
    pass


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
            "magic": req.magic,
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
        }
    finally:
        disconnect()


@app.post("/scalper/start")
def scalper_start(req: ScalperStartRequest, x_bridge_key: Optional[str] = Header(None)):
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"MT5 init failed: {error}"}
    try:
        # Build the EA comment: use the provided name, append direction if needed
        ea_name = req.ea_name.strip() if req.ea_name.strip() else "EA Migrate batch"
        # If direction is provided or can be inferred, append it
        direction = req.direction.strip() if req.direction and req.direction.strip() else None
        if direction and ea_name:
            comment = f"{ea_name} {direction}"
        elif ea_name:
            comment = ea_name
        else:
            comment = "EA Migrate batch"
        # Ensure comment fits MT5's 31-char limit
        comment = comment[:31]
        # Write the state file so the daemon reads it immediately
        state = {
            "running": True,
            "symbol": req.symbol,
            "lot": req.lot,
            "trade_count": req.trade_count,
            "ea_name": req.ea_name,
            "symbols": req.symbols,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "positions": {},
        }
        STATE_FILE = Path("./scalper.state.json")
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
        # Return the analysis data for the AI Trade Analysis card
        return {
            "success": True,
            "analysis": {
                "symbol": req.symbol,
                "direction": direction or "SELL",
                "entry": None,  # will be filled by the daemon's first trade
                "sl": None,  # will be filled by the daemon's first trade
                "tp1": None,  # will be filled by the daemon's first trade
                "lot": req.lot,
                "trade_count": req.trade_count,
                "timeframe": "M15",
                "status": "Analyzing…",
            },
            "comment": comment,
            # The app's start flow reads these three: a start only counts as
            # started when the bridge says the daemon is running.
            "ok": True,
            "running": True,
            "message": "Scalper daemon started",
        }
    finally:
        disconnect()


@app.post("/scalper/stop")
def scalper_stop(req: ScalperStopRequest, x_bridge_key: Optional[str] = Header(None)):
    check_key(x_bridge_key)
    # Acknowledge immediately - the daemon will stop on its next loop iteration
    state = {
        "running": False,
        "stopped_at": datetime.now(timezone.utc).isoformat(),
        "positions": {},
    }
    STATE_FILE = Path("./scalper.state.json")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return {
        "success": True,
        "acknowledged": True,
        "ok": True,
        "running": False,
        "message": "Scalper daemon stopped",
    }


class PositionsRequest(BaseModel):
    credentials: Credentials
    magic: Optional[int] = None


class CloseRequest(BaseModel):
    credentials: Credentials
    ticket: int
    slippage: int = 30


def _position_row(position) -> dict:
    return {
        "ticket": int(position.ticket),
        "symbol": position.symbol,
        "type": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
        "volume": float(position.volume),
        "price_open": float(position.price_open),
        "price_current": float(position.price_current),
        "sl": float(position.sl),
        "tp": float(position.tp),
        "profit": float(position.profit),
        "swap": float(getattr(position, "swap", 0.0)),
        "magic": int(getattr(position, "magic", 0)),
        "comment": getattr(position, "comment", ""),
    }


@app.post("/positions/list")
def positions_list(req: PositionsRequest, x_bridge_key: Optional[str] = Header(None)):
    """Open positions, optionally limited to one magic number (the app's own)."""
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"Terminal: {error[1]}"}
    try:
        positions = mt5.positions_get()
        if positions is None:
            return {"success": False, "message": f"positions_get failed: {mt5.last_error()}"}
        rows = [
            _position_row(position)
            for position in positions
            if req.magic is None or int(getattr(position, "magic", 0)) == int(req.magic)
        ]
        return {"success": True, "positions": rows, "total": len(rows)}
    finally:
        disconnect()


@app.post("/positions/close")
def positions_close(req: CloseRequest, x_bridge_key: Optional[str] = Header(None)):
    """Close ONE position by ticket, in its own opposite direction."""
    check_key(x_bridge_key)
    account, error = connect(req.credentials)
    if account is None:
        disconnect()
        return {"success": False, "error_code": error[0], "message": f"Terminal: {error[1]}"}
    try:
        found = mt5.positions_get(ticket=req.ticket)
        if not found:
            return {"success": False, "message": f"Position {req.ticket} is no longer open"}
        position = found[0]
        symbol = position.symbol
        if not mt5.symbol_select(symbol, True):
            return {"success": False, "message": f"Could not select {symbol} to close it"}
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return {"success": False, "message": f"No live price for {symbol} to close it"}

        is_buy = position.type == mt5.POSITION_TYPE_BUY
        # Closing a BUY means selling it back, and the other way round.
        order_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
        price = tick.bid if is_buy else tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": int(position.ticket),
            "symbol": symbol,
            "volume": float(position.volume),
            "type": order_type,
            "price": price,
            "deviation": req.slippage,
            "magic": int(getattr(position, "magic", 0)),
            "comment": "EA Migrate scalp close",
            "type_time": mt5.ORDER_TIME_GTC,
        }

        last_result = None
        for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            request["type_filling"] = filling
            result = mt5.order_send(request)
            if result is None:
                return {"success": False, "message": f"OrderSend returned None: {mt5.last_error()}"}
            last_result = result
            if result.retcode == 10030:  # unsupported filling mode — try the next
                continue
            break
        if last_result is None:
            return {"success": False, "message": "Close was not sent"}

        closed = last_result.retcode in (10008, 10009, 10010)
        return {
            "success": closed,
            "retcode": last_result.retcode,
            "ticket": int(position.ticket),
            "symbol": symbol,
            "order": last_result.order,
            "deal": last_result.deal,
            "price": float(last_result.price),
            "profit": float(position.profit),
            "message": "" if closed else f"Close rejected (retcode {last_result.retcode})",
        }
    finally:
        disconnect()
