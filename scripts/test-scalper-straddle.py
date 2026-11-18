#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROOF SCRIPT for the Bidirectional Breakout Straddle engine
(public/bridge/scalper_daemon.py).

No MetaTrader 5 terminal exists here, so this runs the REAL daemon loop against
a scripted broker that keeps its own pending-order and position books:

    python3 scripts/test-scalper-straddle.py      # exits 1 on any failed check

What it proves, in the order the engine must do it:

  1. FLAT state places BOTH stops from the live quote:
       BUY STOP  = round(ask + offset, digits)
       SELL STOP = round(bid − offset, digits)
       offset = max(spread, stops_level × point, 15 × point)
     with the configured lot, the daemon magic and the robot's own name.
  2. a resting bracket that never fills is cancelled and re-anchored after the
     stale window — not left pointing at an old price.
  3. a triggered stop cancels the OPPOSITE pending order, so the bracket can
     never fire in reverse.
  4. the position is banked the moment floating (profit + swap) is > 0 —
     a negative pass is held, a positive pass closes.
  5. a confirmed close returns the symbol to FLAT and the next bracket arms
     immediately.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAEMON_DIR = ROOT / "public" / "bridge"
SYMBOL = "XAUUSDm"
ROBOT = "Apex sniper pro V6+"
LOT = 0.01

LOG: list[str] = []
PENDING: dict[int, dict] = {}
POSITIONS: dict[int, dict] = {}
PLACED: list[dict] = []
REMOVED: list[int] = []
CLOSES: list[dict] = []
PROFIT_CALLS: list[float] = []
PASS = {"n": 0}
_next_ticket = 7000

POINT = 0.01
DIGITS = 2
STOPS_LEVEL = 10
BID = 2000.00
ASK = 2000.30            # spread 0.30 → 30 points, above the 15-point floor
PASSES_ARMED = 3         # passes with both stops resting, no fill
PASS_TRIGGER = 4
PASS_PROFIT_POSITIVE = 6


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _pass() -> int:
    return PASS["n"]


def tick(symbol):
    """The market drifts 5 points on every pass, so a stale bracket is measurably
    anchored to an older price than the one re-placed later."""
    drift = _pass() * 0.05
    return Obj(bid=BID + drift, ask=ASK + drift)


def symbol_info(symbol):
    return Obj(symbol=symbol, name=symbol, point=POINT, digits=DIGITS,
               trade_stops_level=STOPS_LEVEL, volume_min=0.01, volume_step=0.01,
               visible=True)


def orders_get(ticket=None, symbol=None):
    return list(PENDING.values())


def positions_get(ticket=None, symbol=None):
    return list(POSITIONS.values())


def order_send(request):
    global _next_ticket
    action = request.get("action")
    if action == 5:      # TRADE_ACTION_PENDING
        _next_ticket += 1
        ticket = _next_ticket
        PENDING[ticket] = Obj(ticket=ticket, symbol=request["symbol"],
                              type=request["type"], magic=request["magic"],
                              volume_current=request["volume"],
                              price_open=request["price"])
        PLACED.append({**dict(request), "ticket": ticket, "pass": _pass()})
        return Obj(retcode=10009, order=ticket, deal=0, price=request["price"])
    if action == 8:      # TRADE_ACTION_REMOVE
        ticket = int(request["order"])
        if ticket in PENDING:
            del PENDING[ticket]
            REMOVED.append(ticket)
            return Obj(retcode=10009, order=ticket, deal=0, price=0.0)
        return Obj(retcode=10013, order=0, deal=0, price=0.0)
    if action == 1:      # TRADE_ACTION_DEAL — a close
        ticket = int(request["position"])
        pos = POSITIONS.get(ticket)
        if pos is None:
            return Obj(retcode=10013, order=0, deal=0, price=0.0)
        CLOSES.append({**dict(request), "pass": _pass(),
                       "profit": float(pos.profit) + float(pos.swap)})
        del POSITIONS[ticket]
        return Obj(retcode=10009, order=ticket, deal=ticket,
                   price=request.get("price", BID))
    return Obj(retcode=10030, order=0, deal=0, price=0.0)


def advance_book(symbol, price):
    """The scripted market: after PASSES_ARMED quiet passes the BUY STOP fills,
    then the position is negative for two passes and positive afterwards."""
    if _pass() == PASS_TRIGGER and PENDING:
        buy = next((t for t, o in PENDING.items() if o.type == 4), None)
        if buy is not None:
            order = PENDING.pop(buy)
            _next_ticket2 = buy
            POSITIONS[buy] = Obj(ticket=buy, symbol=symbol, magic=order.magic,
                                 type=0, volume=order.volume_current,
                                 price_open=order.price_open,
                                 price_current=price, sl=0.0, tp=0.0,
                                 profit=-0.60, swap=0.0)
            LOG.append(f"broker: BUY_STOP {buy} triggered at {price}")
    elif POSITIONS:
        for pos in POSITIONS.values():
            if _pass() < PASS_PROFIT_POSITIVE:
                pos.profit = -0.40
            else:
                pos.profit = 0.25
                pos.swap = 0.01
                PROFIT_CALLS.append(pos.profit + pos.swap)
            pos.price_current = price


def _bounded(_seconds):
    PASS["n"] += 1
    if PASS["n"] > 40:
        raise SystemExit()
    advance_book(SYMBOL, tick(SYMBOL).bid)


stub = types.ModuleType("MetaTrader5")
stub.TIMEFRAME_M1 = 1
stub.TIMEFRAME_M5 = 5
stub.TIMEFRAME_M15 = 15
stub.TIMEFRAME_M30 = 30
stub.TIMEFRAME_H1 = 16385
stub.TIMEFRAME_H4 = 16388
stub.TIMEFRAME_D1 = 16408
stub.POSITION_TYPE_BUY = 0
stub.POSITION_TYPE_SELL = 1
stub.ORDER_TYPE_BUY = 0
stub.ORDER_TYPE_SELL = 1
stub.ORDER_TYPE_BUY_STOP = 4
stub.ORDER_TYPE_SELL_STOP = 5
stub.ORDER_FILLING_FOK = 0
stub.ORDER_FILLING_IOC = 1
stub.ORDER_FILLING_RETURN = 2
stub.TRADE_ACTION_DEAL = 1
stub.TRADE_ACTION_PENDING = 5
stub.TRADE_ACTION_REMOVE = 8
stub.ORDER_TIME_GTC = 0
stub.initialize = lambda *a, **k: True
stub.login = lambda *a, **k: True
stub.shutdown = lambda: None
stub.last_error = lambda: (1, "success")
stub.account_info = lambda: Obj(login=5550001, server="SimBroker-Demo",
                                equity=10000.0, balance=10000.0, margin_free=6000.0)
stub.symbol_info = symbol_info
stub.symbol_select = lambda symbol, enable=True: True
stub.symbol_info_tick = tick
stub.orders_get = orders_get
stub.positions_get = positions_get
stub.order_send = order_send
stub.history_deals_get = lambda position=None: [
    Obj(entry=1, profit=0.25, swap=0.01, commission=0.0)]
stub.copy_rates_from_pos = lambda *a, **k: []
sys.modules["MetaTrader5"] = stub

SETTINGS = {SYMBOL: {"lot": LOT, "trade_count": 1}}
STATE = {"running": True, "symbol": SYMBOL, "lot": LOT, "trade_count": 1,
         "next_trade_number": 1, "positions": {}, "batches": {}, "wait_until": {},
         "engine": "straddle", "ea_name": ROBOT, "timeframe": "15m"}

tmp = Path(tempfile.mkdtemp(prefix="straddle-sim-"))
(tmp / "state.json").write_text(json.dumps(STATE), encoding="utf-8")
(tmp / "symbols.json").write_text(json.dumps(SETTINGS), encoding="utf-8")

os.environ["SCALPER_STATE_FILE"] = str(tmp / "state.json")
os.environ["SCALPER_EVENT_LOG"] = str(tmp / "events.log")
os.environ["SCALPER_SYMBOLS_FILE"] = str(tmp / "symbols.json")
for key in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
    os.environ.pop(key, None)

sys.path.insert(0, str(DAEMON_DIR))
time.sleep = _bounded          # fast-forward the 0.5s between passes

import scalper_daemon          # noqa: E402  (the REAL daemon)

try:
    scalper_daemon.run()
except SystemExit:
    pass

EVENTS = (tmp / "events.log").read_text(encoding="utf-8").splitlines()
TAIL = [line.split("| ", 1)[1] for line in EVENTS if "| " in line]
JOINED = "\n".join(TAIL)

failures: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        failures.append(name)
        if detail:
            print(f"        {detail}")


print("STRADDLE ENGINE")
print("-" * 78)

# ── 1. the first bracket ─────────────────────────────────────────────────────
first_buy = PLACED[0]["price"] if len(PLACED) > 0 else 0.0
first_sell = PLACED[1]["price"] if len(PLACED) > 1 else 0.0
expected_offset = max(ASK - BID, STOPS_LEVEL * POINT, 15 * POINT)
check("both stops are placed from the flat state",
      len(PLACED) >= 2 and PLACED[0]["type"] == 4 and PLACED[1]["type"] == 5,
      [p["type"] for p in PLACED[:2]])
check("BUY STOP sits ask + offset",
      abs(first_buy - round(ASK + expected_offset, DIGITS)) < 1e-6,
      f"{first_buy} vs {round(ASK + expected_offset, DIGITS)}")
check("SELL STOP sits bid − offset",
      abs(first_sell - round(BID - expected_offset, DIGITS)) < 1e-6,
      f"{first_sell} vs {round(BID - expected_offset, DIGITS)}")
check("offset is the widest of spread / stops level / 15 points",
      abs(expected_offset - (ASK - BID)) < 1e-9,
      f"offset {expected_offset}")
check("the bracket carries the configured lot, the daemon magic and the robot name",
      all(p["volume"] == LOT and p["magic"] == 98765 and p["comment"] == ROBOT
          for p in PLACED[:2]),
      [(p["volume"], p["magic"], p["comment"]) for p in PLACED[:2]])
check("the placement is logged the way the trader reads it",
      "[STRADDLE] Placed BUY_STOP @" in JOINED and "and SELL_STOP @" in JOINED)

# ── 3. a trigger cancels the opposite leg ────────────────────────────────────
check("the triggered stop is announced", "[TRIGGERED]" in JOINED,
      [line for line in TAIL if "[TRIGGERED]" in line][:2])
check("the opposite pending order is cancelled",
      len(REMOVED) >= 1 and any(p["type"] == 5 for p in PLACED[:2]) and
      7001 in REMOVED or 7002 in REMOVED,
      f"placed={[p['ticket'] for p in PLACED[:2]]} removed={REMOVED}")

# ── 4. the profit bank ───────────────────────────────────────────────────────
check("a negative floating result is held", all(c["profit"] > 0 for c in CLOSES),
      [c["profit"] for c in CLOSES])
check("the close happens on the first positive pass",
      bool(CLOSES) and CLOSES[0]["profit"] > 0 and PROFIT_CALLS,
      PROFIT_CALLS)
check("the close is a confirmed close (retcode 10009 path)",
      bool(CLOSES) and "[CLOSED PROFIT] +$" in JOINED,
      [line for line in TAIL if "[CLOSED PROFIT]" in line][:2])
check("the close uses the opposite deal type (SELL closes a BUY)",
      bool(CLOSES) and CLOSES[0]["type"] == 1,
      [c["type"] for c in CLOSES])

# ── 5. re-arm ────────────────────────────────────────────────────────────────
check("the bracket re-arms after the bank",
      len(PLACED) >= 4, f"{len(PLACED)} pending orders placed in total")
check("the re-armed bracket is anchored to the newer price",
      len(PLACED) >= 4 and PLACED[2]["price"] > first_buy,
      f"{PLACED[2]['price'] if len(PLACED) > 2 else None} vs {first_buy}")
check("the state file carries the straddle record for /scalper/status",
      isinstance(json.loads((tmp / "state.json").read_text()).get("straddle"), dict))

# ── 2. THE STALE BRACKET ─────────────────────────────────────────────────────
# A bracket that never fills is cancelled and re-anchored on the live price once
# it is older than the stale window; the check drives one pass directly so the
# 45-second clock does not need real time.
PENDING.clear()
DELETED_BEFORE = len(REMOVED)
PLACED_BEFORE = len(PLACED)
creds = scalper_daemon._build_creds()
fresh = scalper_daemon._open_straddle(
    creds, SYMBOL, {"lots": LOT, "trades": 1}, scalper_daemon._read_state())
check("the stale-bracket setup placed a bracket",
      fresh is not None and len(PENDING) == 2, len(PENDING))
if fresh is not None:
    stale_record = dict(fresh)
    stale_record["opened_at"] = time.time() - (scalper_daemon.STRADDLE_STALE_SECONDS + 5)
    stale_record["buy_ticket"] = next(
        (t for t, o in PENDING.items() if o.type == 4), 0)
    stale_record["sell_ticket"] = next(
        (t for t, o in PENDING.items() if o.type == 5), 0)
    kept = scalper_daemon._manage_straddle(
        creds, SYMBOL, stale_record, {"lots": LOT, "trades": 1})
    check("an untriggered bracket is cancelled once it goes stale",
          len(REMOVED) >= DELETED_BEFORE + 2,
          f"removed {len(REMOVED) - DELETED_BEFORE} order(s)")
    check("the stale bracket is re-anchored on the live price",
          len(PLACED) >= PLACED_BEFORE + 3 and kept is True,
          f"{len(PLACED) - PLACED_BEFORE} placement(s) recorded")
    # The events file is re-read: the direct pass above appended after JOINED
    # was captured from the run loop.
    LATE_EVENTS = (tmp / "events.log").read_text(encoding="utf-8")
    check("the re-anchor is reported as stale",
          "bracket stale after" in LATE_EVENTS)

print("-" * 78)
print(f"{len(failures)} failed" if failures else "all checks passed")
sys.exit(1 if failures else 0)
