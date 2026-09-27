"""
MT5 Execution Bridge — v0.2

Runs on the user's VPS next to the MetaTrader 5 terminal.

    pip install fastapi uvicorn MetaTrader5
    uvicorn bridge:app --host 0.0.0.0 --port 8000

Endpoints (all POSTs require header `x-bridge-key`):
    GET  /health           → liveness probe
    POST /account/verify   → login + live account info (balance/equity/margin)
    POST /symbol/price     → LIVE bid/ask/digits for a symbol (NEW in v0.2 —
                             lets the web app anchor SL/TP to real prices)
    POST /trade/execute    → place a market order with filling-mode fallback
"""

import os
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BRIDGE_KEY = os.getenv("MT5_BRIDGE_KEY", "my_secret_bridge_key_2026")

app = FastAPI(title="MT5 Execution Bridge", version="0.2.0")
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
        if not mt5.symbol_select(req.symbol, True):
            return {"success": False, "message": f"Symbol {req.symbol} not found on this broker"}
        tick = mt5.symbol_info_tick(req.symbol)
        info = mt5.symbol_info(req.symbol)
        if tick is None or info is None:
            return {"success": False, "message": f"No live price for {req.symbol} right now"}
        return {
            "success": True,
            "symbol": req.symbol,
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
        if not mt5.symbol_select(req.symbol, True):
            return {"success": False, "message": f"Symbol {req.symbol} not found on this broker"}
        tick = mt5.symbol_info_tick(req.symbol)
        if tick is None or tick.bid <= 0 or tick.ask <= 0:
            return {"success": False, "message": f"No live price for {req.symbol}"}

        is_buy = req.action.strip().upper() == "BUY"
        order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        price = tick.ask if is_buy else tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": req.symbol,
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
            "order": last_result.order,
            "deal": last_result.deal,
            "price": last_result.price,
            "volume": last_result.volume,
            "comment": last_result.comment,
        }
    finally:
        disconnect()
