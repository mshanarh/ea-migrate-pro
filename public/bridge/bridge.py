# MT5 Execution Bridge — v1.1
#
# v1.1 — /symbol/candles:
#   * fixed `name 'n' is not defined` in _resolve_symbol (the base-hits sort
#     named `n` instead of `name`), which crashed EVERY fresh-candle fetch for
#     a symbol the broker serves under a different name;
#   * a crash now answers HTTP 500 with the message instead of HTTP 200 with
#     an error payload, so a failure can never read as a normal refusal;
#   * per-symbol series are cached for 60 s, so repeated analyses of the same
#     symbol/timeframe reuse the candles instead of re-reading MT5 history.
#
# Runs on the user's VPS next to the MetaTrader 5 terminal.
#
#     pip install fastapi uvicorn MetaTrader5
#     uvicorn bridge:app --host 0.0.0.0 --port 8000
#
# Endpoints (all POSTs require header `x-bridge-key`; every response is JSON):
#     GET  /health              → liveness probe
#     POST /account/verify      → login + live account info (balance/equity/margin)
#     POST /symbol/price        → LIVE bid/ask/digits for a symbol
#     POST /trade/execute       → place a market order with filling-mode fallback
#     POST /positions/list      → open positions, optionally filtered by magic
#     POST /positions/close     → close ONE position by ticket
#     POST /scalper/start       → start (or restart) the scalper daemon
#     POST /scalper/stop        → stop the scalper daemon
#     GET  /scalper/status      → daemon state file + event log
#
# IMPORTANT: the scalping loop itself lives in scalper_daemon.py, a separate
# standalone Python process that the bridge merely starts and stops. This file
# only owns the web surface and delegates the loop to the daemon; the daemon
# runs 24/7 independently of Uvicorn and of the web app, and survives a VPS
# reboot or a bridge crash.

import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

BRIDGE_KEY = os.getenv("MT5_BRIDGE_KEY", "my_secret_bridge_key_2026")

app = FastAPI(title="MT5 Execution Bridge", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # the web app is served from multiple hosts
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── helpers the scalper endpoints share ───────────────────────────────────────────
_SCALPER_DIR = Path(__file__).resolve().parent
_STATE_FILE = _SCALPER_DIR / "scalper.state.json"
_LOG_FILE = _SCALPER_DIR / "scalper-events.log"

_daemon_thread = None
_daemon_stop = threading.Event()


def _read_state() -> dict:
    try:
        return __import__("json").loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {
            "running": False, "symbol": None, "lot": None, "trade_count": None,
            "next_trade_number": 1, "started_at": None, "stopped_at": None,
            "positions": {}, "log": [],
        }


def _write_state(state: dict) -> None:
    _STATE_FILE.write_text(__import__("json").dumps(state, indent=2), encoding="utf-8")


def _append_log(line: str) -> None:
    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _read_log() -> list:
    try:
        return _LOG_FILE.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []


def _current_positions() -> dict:
    """Pass-through: the daemon owns MT5; this keeps the route surface clean."""
    return _read_state().get("positions", {})


def _stop_daemon() -> None:
    _daemon_stop.set()
    global _daemon_thread
    if _daemon_thread is not None:
        _daemon_thread.join(timeout=8)
        _daemon_thread = None


# ── the existing broker surface (unchanged in intent) ─────────────────────────────
def _check_key(x_bridge_key: Optional[str]) -> None:
    if x_bridge_key != BRIDGE_KEY:
        raise HTTPException(status_code=401, detail="Invalid bridge key")


class Credentials(BaseModel):
    login: int
    password: str
    server: str


def _connect(creds: Credentials):
    """Open an MT5 terminal session; returns (account_info|None, error|None)."""
    if not mt5.initialize(login=creds.login, password=creds.password, server=creds.server):
        return None, mt5.last_error()
    if not mt5.login(login=creds.login, password=creds.password, server=creds.server):
        error = mt5.last_error()
        mt5.shutdown()
        return None, error
    return mt5.account_info(), None


def _disconnect() -> None:
    mt5.shutdown()


_SYMBOL_GLUE = re.compile(r"[^A-Z0-9]+")
_SUFFIX_TAILS = {"M", "C", "I", "Z", "PRO"}


def _norm(symbol: str) -> str:
    """Uppercase alphanumeric-only form — case/punctuation differences gone."""
    return _SYMBOL_GLUE.sub("", (symbol or "").upper())


def _resolve_symbol(requested: str) -> Optional[str]:
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
        # `name` — NOT `n`: a leftover rename raised NameError here, and this
        # branch sits on the candle path (_select_broker_symbol), so every
        # fresh-candle fetch for such a symbol died with
        # "Error fetching candles: name 'n' is not defined".
        return sorted(base_hits, key=lambda name: (-len(_norm(name)), len(name)))[0]
    contains = [name for name in names if req in _norm(name) or _norm(name) in req]
    if contains:
        return sorted(contains, key=lambda name: abs(len(_norm(name)) - len(req)))[0]
    return None


def _select_broker_symbol(requested: str):
    """symbol_select the best real match for `requested`; returns (name, error)."""
    resolved = _resolve_symbol(requested)
    trade_symbol = resolved or requested
    if not mt5.symbol_select(trade_symbol, True):
        return None, f"Symbol {requested} not found on this broker"
    return trade_symbol, None


class _HealthResponse(BaseModel):
    status: str
    message: str


@app.get("/health")
def health():
    return _HealthResponse(status="online", message="MT5 bridge is active")


class _VerifyResponse(BaseModel):
    success: bool
    account: dict


@app.post("/account/verify")
def verify_account(creds: Credentials, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    account, error = _connect(creds)
    if account is None:
        _disconnect()
        return _VerifyResponse(success=False, account={})
    try:
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
        return data
    finally:
        _disconnect()


class _PriceRequest(BaseModel):
    credentials: Credentials
    symbol: str


@app.post("/symbol/price")
def symbol_price(req: _PriceRequest, x_bridge_key: Optional[str] = Header(None)):
    """LIVE quote for one symbol — used to anchor SL/TP to real prices."""
    _check_key(x_bridge_key)
    account, error = _connect(req.credentials)
    if account is None:
        _disconnect()
        return {"success": False, "message": f"Terminal: {error}"}
    try:
        trade_symbol, select_error = _select_broker_symbol(req.symbol)
        if trade_symbol is None:
            return {"success": False, "message": select_error}
        tick = mt5.symbol_info_tick(trade_symbol)
        info = mt5.symbol_info(trade_symbol)
        if tick is None or info is None:
            return {"success": False, "message": f"No live price for {req.symbol}"}
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
        _disconnect()


class _CandlesRequest(BaseModel):
    credentials: Credentials
    symbol: str
    timeframe: str  # "15m", "1h", "m30"
    count: int = 100


# ── candle cache ────────────────────────────────────────────────────────────────
# One analysis fires several /symbol/candles calls in a row (direction, filter,
# retry). Re-reading MT5 history each time is slow and re-hits the terminal, so
# a successful series is reused for 60 s. NEVER longer: analysis must not act on
# candles older than a minute, so an entry is dropped the moment it turns 60 s.
_CANDLE_CACHE_TTL_S = 60
candle_cache: dict = {}       # (symbol, timeframe, count) → (fetched_at, payload)
_candle_cache_lock = threading.Lock()


def _candle_cache_key(req: "_CandlesRequest") -> tuple:
    # Keyed on the REQUESTED name (normalised), the timeframe and the count —
    # two different requests must never share one entry.
    return (_norm(req.symbol), req.timeframe, int(req.count))


def _candle_cache_get(key: tuple):
    """(payload, age_seconds) when the entry is younger than 60 s, else None.

    An expired entry is deleted on the spot, so stale candles can never be
    served by a later lookup.
    """
    with _candle_cache_lock:
        entry = candle_cache.get(key)
        if entry is None:
            return None
        fetched_at, payload = entry
        age = time.monotonic() - fetched_at
        if age >= _CANDLE_CACHE_TTL_S:
            candle_cache.pop(key, None)
            return None
        return payload, age


def _candle_cache_put(key: tuple, payload: dict) -> None:
    with _candle_cache_lock:
        now = time.monotonic()
        candle_cache[key] = (now, payload)
        # Prune everything already older than the TTL so the map stays small.
        for stale in [k for k, (t, _) in candle_cache.items() if now - t >= _CANDLE_CACHE_TTL_S]:
            candle_cache.pop(stale, None)


@app.post("/symbol/candles")
def symbol_candles(req: _CandlesRequest, x_bridge_key: Optional[str] = Header(None)):
    """Historical candle data for one symbol — used for RSI, momentum and other technical analysis.

    Failure contract (v1.1): a CRASH answers HTTP 500 with the message — never
    a 200 carrying an error payload — while an ordinary refusal (symbol unknown,
    no history, unsupported timeframe) still answers 200 with `success:false`
    and the broker's own explanation.
    """
    _check_key(x_bridge_key)

    # CACHE HIT → answer straight away; no terminal session, no history read.
    cached = _candle_cache_get(_candle_cache_key(req))
    if cached is not None:
        payload, age = cached
        return {**payload, "cached": True, "cacheAgeSeconds": round(age, 3)}

    try:
        account, error = _connect(req.credentials)
        if account is None:
            _disconnect()
            return {"success": False, "message": f"Terminal: {error}"}
        try:
            trade_symbol, select_error = _select_broker_symbol(req.symbol)
            if trade_symbol is None:
                return {"success": False, "message": select_error}
            timeframe_map = {
                "15m": mt5.TIMEFRAME_M15,
                "1h": mt5.TIMEFRAME_H1,
                "m30": mt5.TIMEFRAME_M30,
            }
            mt5_tf = timeframe_map.get(req.timeframe)
            if mt5_tf is None:
                return {"success": False, "message": f"Unsupported timeframe: {req.timeframe}"}
            rates = mt5.copy_rates_from_pos(trade_symbol, mt5_tf, 0, req.count)
            if rates is None or len(rates) == 0:
                return {
                    "success": False,
                    "message": (
                        f"bridge returned 0 candles: MT5 has no {req.timeframe} history for "
                        f"{trade_symbol} (requested {req.symbol}). Select the symbol in "
                        f"Market Watch and let the terminal download its history."
                    ),
                }
            candles = []
            for row in rates:
                candles.append({
                    "time": int(row[0]),
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": int(row[5]),
                    "spread": int(row[6]) if len(row) > 6 else 0,
                })
            payload = {
                "ok": True,
                "success": True,
                "requestedSymbol": req.symbol,
                "symbol": trade_symbol,
                "timeframe": req.timeframe,
                "count": len(candles),
                "serverTime": datetime.now(timezone.utc).isoformat(),
                "candles": candles,
            }
            # ONLY a clean, non-empty series is ever cached.
            _candle_cache_put(_candle_cache_key(req), payload)
            return payload
        finally:
            _disconnect()
    except Exception as exc:
        # A crash is unmistakable: HTTP 500 + the real message, and nothing is
        # cached, so the next call retries from scratch.
        try:
            _disconnect()
        except Exception:
            pass
        message = f"Error fetching candles: {exc}"
        print(f"[/symbol/candles] HTTP 500 {type(exc).__name__}: {exc}", flush=True)
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "success": False,
                "error": message,
                "message": message,
                "exception": type(exc).__name__,
            },
        )


class _TradeRequest(BaseModel):
    credentials: Credentials
    symbol: str
    action: str
    volume: float
    stop_loss: float = 0
    take_profit: float = 0
    slippage: int = 20
    comment: Optional[str] = None
    magic: int = 0


@app.post("/trade/execute")
def trade_execute(req: _TradeRequest, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    account, error = _connect(req.credentials)
    if account is None:
        _disconnect()
        return {"success": False, "message": f"MT5 init failed: {error}"}
    try:
        trade_symbol, select_error = _select_broker_symbol(req.symbol)
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

        last_result = None
        stops_removed = False
        for attempt in range(2):
            for filling in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
                request["type_filling"] = filling
                result = mt5.order_send(request)
                if result is None:
                    return {"success": False, "message": f"OrderSend returned None: {mt5.last_error()}"}
                last_result = result
                if result.retcode == 10030:
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
        _disconnect()


class _PositionsRequest(BaseModel):
    credentials: Credentials
    magic: Optional[int] = None


class _CloseRequest(BaseModel):
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
def positions_list(req: _PositionsRequest, x_bridge_key: Optional[str] = Header(None)):
    """Open positions, optionally limited to one magic number (the app's own)."""
    _check_key(x_bridge_key)
    account, error = _connect(req.credentials)
    if account is None:
        _disconnect()
        return {"success": False, "message": f"Terminal: {error}"}
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
        _disconnect()


@app.post("/positions/close")
def positions_close(req: _CloseRequest, x_bridge_key: Optional[str] = Header(None)):
    """Close ONE position by ticket, in its own opposite direction."""
    _check_key(x_bridge_key)
    account, error = _connect(req.credentials)
    if account is None:
        _disconnect()
        return {"success": False, "message": f"Terminal: {error}"}
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
            if result.retcode == 10030:
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
        _disconnect()


# ── scalper endpoints (only the web surface — the loop lives in scalper_daemon.py) ─
class _ScalperStartRequest(BaseModel):
    symbol: str
    lot: float
    trade_count: int


@app.post("/scalper/start")
def scalper_start(req: _ScalperStartRequest, x_bridge_key: Optional[str] = Header(None)):
    """Start (idempotent) or RESTART the scalper daemon.

    Writes the daemon's state file. A second start while it is already running
    restarts it (fresh run, keeps open positions from the state log).
    """
    _check_key(x_bridge_key)
    state = _read_state()
    if state.get("running"):
        state["next_trade_number"] = int(state.get("next_trade_number", 1)) + 1
        state["started_at"] = datetime.now(timezone.utc).isoformat()
        state["symbol"] = req.symbol
        state["lot"] = req.lot
        state["trade_count"] = req.trade_count
        _write_state(state)
        _append_log(f"POST /scalper/start -> daemon RESTARTED "
                    f"(symbol={req.symbol}, lot={req.lot}, trade_count={req.trade_count})")
        return {"ok": True, "running": True,
                "message": "Scalper daemon restarted — open positions kept and "
                           "re-analysed on the next event tick"}
    state.update({
        "running": True,
        "symbol": req.symbol,
        "lot": req.lot,
        "trade_count": req.trade_count,
        "next_trade_number": 1,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "stopped_at": None,
        "positions": {},
        "log": _read_log(),
    })
    _write_state(state)
    _daemon_stop.clear()
    global _daemon_thread
    _daemon_thread = threading.Thread(
        target=_scalper_daemon_worker, name="scalper-daemon",
        daemon=True,
    )
    _daemon_thread.start()
    _append_log(f"POST /scalper/start -> daemon STARTED "
                f"(symbol={req.symbol}, lot={req.lot}, trade_count={req.trade_count})")
    return {"ok": True, "running": True,
            "message": "Scalper daemon started (24/7, independent of Uvicorn)"}


class _ScalperStopRequest(BaseModel):
    pass


@app.post("/scalper/stop")
def scalper_stop(req: _ScalperStopRequest, x_bridge_key: Optional[str] = Header(None)):
    """Stop the scalper daemon. State file and event log are preserved."""
    _check_key(x_bridge_key)
    _stop_daemon()
    state = _read_state()
    state["running"] = False
    state["stopped_at"] = datetime.now(timezone.utc).isoformat()
    _write_state(state)
    _append_log(f"POST /scalper/stop -> daemon STOPPED "
                f"(running={state.get('running')})")
    return {"ok": True, "running": False,
            "message": "Scalper daemon stopped — state and history preserved"}


@app.get("/scalper/status")
def scalper_status(x_bridge_key: Optional[str] = Header(None)):
    """Return the daemon's run state and its event log."""
    _check_key(x_bridge_key)
    state = _read_state()
    return {
        "ok": True,
        "running": state.get("running", False),
        "symbol": state.get("symbol"),
        "lot": state.get("lot"),
        "trade_count": state.get("trade_count"),
        "next_trade_number": state.get("next_trade_number", 1),
        "started_at": state.get("started_at"),
        "stopped_at": state.get("stopped_at"),
        "positions_managed": len(state.get("positions", {})),
        "log": _read_log(),
    }


def _scalper_daemon_worker() -> None:
    """NOT the scalping loop — this file only schedules the thread. The loop
    itself lives in scalper_daemon.py, which the worker imports and runs."""
    try:
        import scalper_daemon  # runs independently of Uvicorn and the app
        scalper_daemon.run()
    except Exception as exc:  # pragma: no cover - last resort
        _append_log(f"daemon thread died before handing off to scalper_daemon: {exc}")
    finally:
        _daemon_thread = None
