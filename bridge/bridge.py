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
    data = {
        "success": True,
        "account": {
            "login": account.login,
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

        # Filling-mode fallback: brokers differ (FOK / IOC / RETURN).
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
        }
    finally:
        disconnect()
