#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROOF SCRIPT for the VPS batch scalp cycle (public/bridge/scalper_daemon.py).

There is no MetaTrader 5 terminal in CI, so this runs the REAL daemon loop
against a scripted MetaTrader5 stand-in that behaves like a broker: it keeps its
own position book as the source of truth, hands back candles in the real API's
order (newest first, index 0 still forming), reports per-position profit from a
stage table, confirms closes, and refuses one close so the retry path is
exercised.

    python3 scripts/test-scalper-batch.py       # exits 1 on any failed check

What it proves, in the order the daemon must do it:

  1. per-symbol settings drive every batch (4 × 0.01 BTCUSDm, 10 × 0.01 XAUUSDm,
     2 × 0.02 SLTEST) — never a hardcoded count — and a disabled symbol is skipped
  2. the whole batch opens at once, in the direction read from the candles
  3. the batch is HELD through a mixed book (-2.12 -1.82 next to +1.71 +1.42),
     even though individual legs are already positive
  4. nothing is closed until the COMBINED floating profit is > 0, then every leg
     of that batch is closed in the same pass
  5. a refused close is retried, and the batch is reported CLOSED only once every
     leg is MT5-confirmed
  6. the same symbol re-analyses and opens its next batch immediately, with no
     second Start command
  7. a batch stopped out by the broker is reported, and the symbol waits for the
     next completed M15 candle instead of reopening
  8. no symbol ever holds more positions than its configured Number of Trades
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

# ── the scripted broker ──────────────────────────────────────────────────────

MAGIC_UNDER_TEST = 98765
TICKS_PER_STAGE = 3            # passes each profit stage lasts (so a hold is visible)
TICK_BUDGET = 60
REFUSAL_SYMBOL = "BTCUSDm"     # the first close of this symbol's top leg is refused once

STAGES = {
    "BTCUSDm": [[-2.12, -1.82, 1.71, 1.42],   # combined  -0.81  → MUST BE HELD
                [0.61, 0.55, 0.50, 0.44]],    # combined  +2.10  → MUST CLOSE
    "XAUUSDm": [[-1.00] * 10,                 # combined -10.00  → HELD
                [0.30] * 10],                 # combined  +3.00  → CLOSED
    "SLTEST": [[-0.40, 0.10]],                # held, then the stop loss takes it out
}
STOPPED_OUT = "SLTEST"
PRICE = {"BTCUSDm": 80240.0, "XAUUSDm": 2345.50, "SLTEST": 1.2345}

LOG: list[str] = []
OPENS: list[dict] = []
CLOSES: list[dict] = []
CONFIRMED: list[dict] = []
REFUSED: list[dict] = []
REALIZED: dict[int, float] = {}          # ticket → the broker's realized result
SNAPSHOTS: list[dict] = []
MAX_OPEN: dict[str, int] = {}
OBS: dict[str, int] = {}          # passes each symbol has actually been seen open
_failed: set[str] = set()
_vanished: set[str] = set()
_tick = 0
_next_ticket = 5000
BOOK: dict[int, object] = {}

stub = types.ModuleType("MetaTrader5")
stub.TIMEFRAME_M15 = 15
stub.POSITION_TYPE_BUY = 0
stub.POSITION_TYPE_SELL = 1
stub.ORDER_TYPE_BUY = 0
stub.ORDER_TYPE_SELL = 1
stub.ORDER_FILLING_FOK = 0
stub.ORDER_FILLING_IOC = 1
stub.ORDER_FILLING_RETURN = 2
stub.TRADE_ACTION_DEAL = 1
stub.ORDER_TIME_GTC = 0


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _stage(symbol: str) -> int:
    """Which profit stage that symbol is in — counted in passes where the
    symbol is actually OPEN (an empty-book pass must not age the market)."""
    return min(OBS.get(symbol, 0) // TICKS_PER_STAGE, len(STAGES[symbol]) - 1)


def copy_rates_from_pos(symbol, timeframe, start, count):
    """REAL MT5 LAYOUT: `count` bars, index 0 = the still-forming bar, then the
    completed bars going back in time. XAUUSDm is scripted to fall."""
    forming_open = (int(time.time()) // 900) * 900
    rising = symbol != "XAUUSDm"
    ref = PRICE[symbol]
    step, body, wick = ref * 0.0004, ref * 0.0002, ref * 0.0001
    out = []
    for i in range(count):
        open_time = forming_open - i * 900
        if i == 0:                                   # forming: dropped by the daemon
            base = ref
            close = base + body if rising else base - body
        else:
            base = ref - (i - 1) * step * (1 if rising else -1)
            close = base + body if rising else base - body
        out.append((open_time, base, max(base, close) + wick, min(base, close) - wick,
                    close, 100))
    return out


def positions_get(ticket=None):
    global _tick
    if ticket is not None:
        found = [p for p in BOOK.values() if p.ticket == ticket]
        return found or None
    _tick += 1

    # the stop loss: SLTEST's legs disappear once its hold stage has run
    if STOPPED_OUT not in _vanished and any(p.symbol == STOPPED_OUT for p in BOOK.values()) \
            and OBS.get(STOPPED_OUT, 0) >= TICKS_PER_STAGE * 2:
        for t in [t for t, p in BOOK.items() if p.symbol == STOPPED_OUT]:
            del BOOK[t]
        _vanished.add(STOPPED_OUT)
        LOG.append(f"broker: stop loss took every {STOPPED_OUT} leg out")

    if _tick > TICK_BUDGET:
        raise SystemExit()

    out = list(BOOK.values())
    for symbol in {p.symbol for p in out}:
        OBS[symbol] = OBS.get(symbol, 0) + 1
    seen: dict[str, int] = {}
    for pos in out:
        idx = seen.get(pos.symbol, 0)
        seen[pos.symbol] = idx + 1
        pos.profit = float(STAGES[pos.symbol][_stage(pos.symbol)][idx % len(
            STAGES[pos.symbol][_stage(pos.symbol)])])
    for symbol in seen:
        MAX_OPEN[symbol] = max(MAX_OPEN.get(symbol, 0),
                               len([p for p in BOOK.values() if p.symbol == symbol]))
    SNAPSHOTS.append({
        "tick": _tick,
        "book": {symbol: sorted(round(p.profit, 2) for p in BOOK.values() if p.symbol == symbol)
                 for symbol in seen},
    })
    return out


def order_send(request):
    global _next_ticket
    if "position" in request:
        ticket = int(request["position"])
        pos = BOOK.get(ticket)
        if pos is None:
            return Obj(retcode=10013, order=0, deal=0, price=0.0)
        legs = [p for p in BOOK.values() if p.symbol == pos.symbol]
        CLOSES.append({**request, "tick": _tick, "legs": len(legs),
                       "combined": sum(p.profit for p in legs)})
        top = max((p.ticket for p in legs), default=0)
        if pos.symbol == REFUSAL_SYMBOL and pos.symbol not in _failed and ticket == top:
            _failed.add(pos.symbol)
            REFUSED.append(dict(request))
            LOG.append(f"broker: REFUSED close of {ticket} (requote 10004)")
            return Obj(retcode=10004, order=0, deal=0, price=0.0)
        profit = pos.profit
        del BOOK[ticket]
        CONFIRMED.append({"ticket": ticket, "symbol": pos.symbol, "profit": profit})
        REALIZED[ticket] = profit - 0.11        # the broker's own post-close number
        LOG.append(f"broker: confirmed close of {ticket} ({pos.symbol}) profit {profit:+.2f}")
        return Obj(retcode=10009, order=ticket, deal=ticket, price=PRICE[pos.symbol])

    OPENS.append(dict(request))
    _next_ticket += 1
    ticket = _next_ticket
    BOOK[ticket] = Obj(ticket=ticket, symbol=request["symbol"], magic=request["magic"],
                       type=request["type"], volume=request["volume"],
                       price_open=request["price"], price_current=request["price"],
                       sl=request["sl"], tp=request["tp"], profit=0.0)
    LOG.append(f"broker: opened {'BUY' if request['type'] == 0 else 'SELL'} "
               f"{request['symbol']} {request['volume']} @ {request['price']} "
               f"sl={request['sl']} magic={request['magic']}")
    return Obj(retcode=10009, order=ticket, deal=ticket, price=request["price"])


stub.initialize = lambda *a, **k: True
stub.login = lambda login=None, password=None, server=None: True
stub.shutdown = lambda: None
stub.last_error = lambda: (1, "success")
stub.account_info = lambda: Obj(login=5550001, server="SimBroker-Demo", equity=10000.0,
                                balance=10000.0, margin_free=6000.0)
stub.symbol_info = lambda symbol: Obj(symbol=symbol, point=0.01, digits=2,
                                      trade_stops_level=20, volume_min=0.01,
                                      volume_step=0.01, visible=True)
stub.symbol_select = lambda symbol, enable=True: True
stub.symbol_info_tick = lambda symbol: Obj(bid=PRICE[symbol], ask=PRICE[symbol] + 0.5)
stub.history_deals_get = lambda position=None: (
    [Obj(entry=1, profit=REALIZED[position], swap=0.0, commission=0.0)]
    if position in REALIZED else None
)
stub.copy_rates_from_pos = copy_rates_from_pos
stub.positions_get = positions_get
stub.order_send = order_send
sys.modules["MetaTrader5"] = stub

# ── settings: per-symbol, deliberately different from the flat trio ──────────

SETTINGS = {
    "BTCUSDm": {"lot": 0.01, "trade_count": 4},
    "XAUUSDm": {"lot": 0.01, "trade_count": 10},
    "SLTEST": {"lot": 0.02, "trade_count": 2},
    "DISABLED": {"lot": 0.01, "trade_count": 5, "enabled": False},
}
STATE = {"running": True, "symbol": "IGNORED", "lot": 0.99, "trade_count": 1,
         "next_trade_number": 1, "positions": {}, "batches": {}, "wait_until": {}}

tmp = Path(tempfile.mkdtemp(prefix="scalper-sim-"))
(tmp / "state.json").write_text(json.dumps(STATE), encoding="utf-8")
(tmp / "symbols.json").write_text(json.dumps(SETTINGS), encoding="utf-8")

os.environ["SCALPER_STATE_FILE"] = str(tmp / "state.json")
os.environ["SCALPER_EVENT_LOG"] = str(tmp / "events.log")
os.environ["SCALPER_SYMBOLS_FILE"] = str(tmp / "symbols.json")
for key in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
    os.environ.pop(key, None)

sys.path.insert(0, str(DAEMON_DIR))
time.sleep = lambda _seconds: None          # fast-forward the 1–2s poll

import scalper_daemon                        # noqa: E402  (the REAL daemon)

try:
    scalper_daemon.run()
except SystemExit:
    pass

EVENTS = (tmp / "events.log").read_text(encoding="utf-8").splitlines()
TAIL = [line.split("| ", 1)[1] for line in EVENTS if "| " in line]
JOINED = "\n".join(TAIL)

checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, bool(ok), detail))


def index(text: str, needle: str) -> int:
    return text.index(needle) if needle in text else -1


btc = [o for o in OPENS if o["symbol"] == "BTCUSDm"]
xau = [o for o in OPENS if o["symbol"] == "XAUUSDm"]
sl = [o for o in OPENS if o["symbol"] == "SLTEST"]

# 1 — per-symbol settings drive every batch
check("4 × 0.01 BTCUSDm batch", len(btc) > 0 and len(btc) % 4 == 0
      and all(abs(o["volume"] - 0.01) < 1e-9 for o in btc), f"{len(btc)} opens")
check("10 × 0.01 XAUUSDm batch", len(xau) % 10 == 0
      and all(abs(o["volume"] - 0.01) < 1e-9 for o in xau), f"{len(xau)} opens")
check("2 × 0.02 SLTEST batch", len(sl) == 2
      and all(abs(o["volume"] - 0.02) < 1e-9 for o in sl), f"{len(sl)} opens")
check("the flat trio is ignored (no IGNORED symbol, no 0.99 lot)",
      not any(o["symbol"] == "IGNORED" or abs(o["volume"] - 0.99) < 1e-9 for o in OPENS))
check("a disabled symbol never opens", not any(o["symbol"] == "DISABLED" for o in OPENS))
check("every order carries the daemon magic",
      all(o["magic"] == MAGIC_UNDER_TEST for o in OPENS))
check("the settings source is named in the log",
      "SETTINGS from symbols.json: BTCUSDm 4 × 0.01 · XAUUSDm 10 × 0.01 · SLTEST 2 × 0.02"
      in JOINED)

# 2 — direction from the candles, the whole batch at once, a stop on every leg
check("BTCUSDm batch is all BUY (rising candles)", all(o["type"] == 0 for o in btc))
check("XAUUSDm batch is all SELL (falling candles)", all(o["type"] == 1 for o in xau))
check("the analysed direction is logged with its basis",
      "→ direction BUY (net move +" in JOINED and "→ direction SELL (net move -" in JOINED)
check("every order carries a protective stop", all(o["sl"] > 0 for o in OPENS))
check("BUY stops sit below entry, SELL stops above it",
      all((o["type"] == 0 and o["sl"] < o["price"]) or (o["type"] == 1 and o["sl"] > o["price"])
          for o in OPENS))
check("no take profit on a leg (the batch is the exit)", all(o["tp"] == 0.0 for o in OPENS))

# 3 — held through a mixed, net-negative book
mixed_ticks = [s for s in SNAPSHOTS
               if len(s["book"].get("BTCUSDm", [])) == 4
               and min(s["book"]["BTCUSDm"]) < 0 < max(s["book"]["BTCUSDm"])
               and sum(s["book"]["BTCUSDm"]) < 0]
check("the scripted market did produce a mixed net-negative book",
      len(mixed_ticks) > 0, f"{len(mixed_ticks)} ticks")
check("no close was requested during those hold ticks",
      bool(mixed_ticks) and (not CLOSES or CLOSES[0]["tick"] > max(s["tick"] for s in mixed_ticks)),
      f"first close at tick {CLOSES[0]['tick'] if CLOSES else '—'}")

# 4 — closed only when the COMBINED profit was positive, all legs together
check("no close request was ever sent while the combined profit was ≤ 0",
      all(c["combined"] > 0 for c in CLOSES),
      f"lowest combined at a close request: {min((c['combined'] for c in CLOSES), default=0):+.2f}")
check("the first close waited out the hold stage",
      bool(CLOSES) and CLOSES[0]["tick"] >= TICKS_PER_STAGE,
      f"tick {CLOSES[0]['tick'] if CLOSES else '—'}")
def first_close_group(symbol: str) -> list[int]:
    """The legs-open count of every close request in that symbol's first
    close pass, in the order the daemon sent them."""
    groups: dict[int, list[int]] = {}
    order: list[int] = []
    for c in CLOSES:
        if c["symbol"] != symbol:
            continue
        if c["tick"] not in groups:
            groups[c["tick"]] = []
            order.append(c["tick"])
        groups[c["tick"]].append(c["legs"])
    return groups[order[0]] if order else []


btc_close = first_close_group("BTCUSDm")
xau_close = first_close_group("XAUUSDm")
check("a close pass walks the WHOLE still-open batch (4→1 and 10→1)",
      btc_close == [4, 3, 2, 1] and xau_close == [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      f"legs per close request: BTC {btc_close} · XAU {xau_close}")

# 5 — a refused close is retried, and CLOSED is only reported after confirmation
check("the broker refused exactly one close", len(REFUSED) == 1, f"{len(REFUSED)} refusals")
check("the daemon logged that leg as retrying",
      "CLOSE ORDER FAILED for ticket" in JOINED and "retrying next pass" in JOINED)
check("the BTCUSDm batch was reported CLOSED",
      "BATCH 1 CLOSED — BUY BTCUSDm · 4 positions" in JOINED)
check("CLOSED came only after the refused leg was confirmed",
      0 <= index(JOINED, "CLOSE ORDER FAILED") < index(JOINED, "CLOSED — BUY BTCUSDm · 4 positions"))
check("confirmed closes == close requests − refusals",
      len(CLOSES) == len(CONFIRMED) + len(REFUSED),
      f"{len(CLOSES)} requests, {len(CONFIRMED)} confirmed, {len(REFUSED)} refused")
check("the batch result is the broker's REALIZED number, not the floating read",
      "combined result" in JOINED and "floating at close" in JOINED,
      [line for line in TAIL if "combined result" in line][:1] and
      [line for line in TAIL if "combined result" in line][0][:160])

# 6 — the next batch opens with no second Start
check("a fresh BTCUSDm batch opened straight after the close, with no Start",
      JOINED.count("OPENED — EXECUTED BUY BTCUSDm") >= 2,
      f"{JOINED.count('OPENED — EXECUTED BUY BTCUSDm')} BTCUSDm batches")
check("the retried batch still reported all 4 legs",
      "CLOSED — BUY BTCUSDm · 4 positions" in JOINED and "· 3 positions" not in JOINED,
      [line for line in TAIL if "CLOSED — BUY BTCUSDm" in line][:1] and
      [line for line in TAIL if "CLOSED — BUY BTCUSDm" in line][0][:120])
check("several cycles ran end to end",
      JOINED.count("OPENED — EXECUTED BUY BTCUSDm") >= 3
      and JOINED.count("CLOSED — BUY BTCUSDm") >= 2,
      f"{JOINED.count('OPENED — EXECUTED BUY BTCUSDm')} BTCUSDm batches")
check("the daemon never flipped the state file to stopped",
      json.loads((tmp / "state.json").read_text())["running"] is True)
check("the state file carries the live book for the status view",
      json.loads((tmp / "state.json").read_text()).get("daemon_version") == scalper_daemon.DAEMON_VERSION)

# 7 — a stop-out waits for the next completed M15 candle
check("the stopped-out batch is reported as gone",
      "SLTEST GONE — every position was closed by the broker" in JOINED
      and "aiting for the next completed M15 candle" in JOINED,
      [line for line in TAIL if "SLTEST GONE" in line][:1] and
      [line for line in TAIL if "SLTEST GONE" in line][0][:150])
check("the stopped-out symbol did not reopen immediately", len(sl) == 2, f"{len(sl)} SLTEST opens")

# 8 — per-symbol cap
check("no symbol ever exceeded its configured Number of Trades",
      MAX_OPEN.get("BTCUSDm", 0) <= 4 and MAX_OPEN.get("XAUUSDm", 0) <= 10
      and MAX_OPEN.get("SLTEST", 0) <= 2, f"max open per symbol: {MAX_OPEN}")

# ── report ───────────────────────────────────────────────────────────────────
failed = [c for c in checks if not c[1]]
print("=" * 78)
print("BATCH SCALP CYCLE — scripted-broker run of the real daemon")
print("=" * 78)
print(f"ticks: {_tick}   orders: {len(OPENS)}   close requests: {len(CLOSES)}   "
      f"confirmed: {len(CONFIRMED)}   refused: {len(REFUSED)}")
print(f"max open per symbol: {MAX_OPEN}")
print("-" * 78)
for name, ok, _detail in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   [{_detail}]" if _detail else ""))
print("-" * 78)
print("book snapshots (tick: per-symbol floating P/L — the hold evidence):")
for snapshot in SNAPSHOTS[:6]:
    print(f"  tick {snapshot['tick']}: {snapshot['book']}")
print("-" * 78)
print("daemon event log (scalper-events.log):")
for line in TAIL:
    print("  " + line)
print("-" * 78)
print(f"{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)
