#!/usr/bin/env python3
"""Co-Invest (Liquid) data for the day-trader tools, in place of Nasdaq Trader and Yahoo.

    python3 coinvest.py universe markets.json            # search_markets answer -> trader/universe.txt
    python3 coinvest.py bars soxl-5m.json mu-1d.json      # show_chart answers -> trader/bars/<SYM>.json
    python3 coinvest.py order                             # trader/orders.json -> suggest_order arguments

The Co-Invest connector is an MCP server, so Claude calls it (search_markets,
show_chart) and saves each answer, as returned, to a file. This tool turns
those files into what the other tools already read:

universe  Liquid's markets, one SYMBOL|Name a line, for scan.py --universe.
          Liquid's own ids (xyz:MU) become plain tickers (MU); the map back is
          kept in trader/liquid_symbols.json for the order.
bars      Each show_chart answer (or a list or {name: answer} bundle of them)
          becomes a Yahoo v8 chart JSON, trader/bars/<SYM>.json. Every tool
          with --offline reads that folder: scan.py daily / orb, entry.py
          check, exit.py plan, timemachine.py run. Daily candles are stamped
          at 08:00 New York of their UTC date (Liquid's day starts at 00:00
          UTC), and weekend candles of xyz: markets are dropped (the stock
          market is shut; Liquid keeps trading the perp). Prices stay as
          Liquid gives them; volume is in contracts, not shares, so scan
          with --min-volume 0.
order     The bracket in trader/orders.json (written by trader-budget) as the
          arguments for Co-Invest's suggest_order: long, leverage 1, market,
          size = qty x entry in USD, stop-loss and take-profit from the plan.
          suggest_order is paper only and never places anything: it returns a
          review link and the user places the order in Liquid themselves.

Limits: show_chart returns at most 200 candles a call, so 5-minute bars reach
back about 16 hours. That covers today's opening range, the entry and an ATR
stop, but not the Time Machine's 60 sessions (it needs about 4,700 bars).
Education and tooling, not financial advice.
"""

import argparse
import json
import os
import sys
import time

INTERVALS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}
GRAN = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "4h": "4h", "1d": "1d"}
NY_8AM_UTC_SHIFT = 12 * 3600  # 00:00 UTC + 12 h = 08:00 New York (07:00 in winter): same date either way
DEFAULT_BARS = "trader/bars"
DEFAULT_MAP = "trader/liquid_symbols.json"


class CoinvestError(Exception):
    pass


def plain(symbol):
    """Liquid id -> a plain ticker: xyz:MU -> MU, BTC -> BTC."""
    s = str(symbol or "").strip()
    if ":" in s:
        s = s.split(":", 1)[1]
    s = s.upper()
    if not s:
        raise CoinvestError("a market with no symbol")
    return s


def num(x):
    if x is None or x == "":
        return None
    return float(x)


def answers(doc):
    """One saved file -> the show_chart answers in it (one, a list, or a bundle)."""
    if isinstance(doc, dict) and "candles" in doc:
        return [doc]
    if isinstance(doc, list):
        out = []
        for d in doc:
            out.extend(answers(d))
        return out
    if isinstance(doc, dict):
        out = []
        for d in doc.values():
            if isinstance(d, (dict, list)):
                out.extend(answers(d))
        return out
    return []


def to_chart(ans, now=None):
    """A show_chart answer -> (SYM, Liquid id, Yahoo v8 chart doc)."""
    liquid = ans.get("symbol")
    sym = plain(liquid)
    interval = ans.get("interval") or "5m"
    if interval not in INTERVALS:
        raise CoinvestError("%s: interval %s is not one this tool knows" % (sym, interval))
    step = INTERVALS[interval]
    daily = interval == "1d"
    stock = ":" in str(liquid)
    now = time.time() if now is None else now
    rows = {}
    for c in ans.get("candles") or []:
        try:
            t = int(c["timestamp"]) // 1000
            o, h, l, cl, v = (num(c.get(k)) for k in ("open", "high", "low", "close", "volume"))
        except (KeyError, TypeError, ValueError):
            raise CoinvestError("%s: a candle this tool cannot read: %r" % (sym, c))
        if cl is None:
            continue
        if daily:
            if stock and time.gmtime(t).tm_wday >= 5:
                continue  # the stock market is shut on weekends
            t += NY_8AM_UTC_SHIFT
        rows[t] = (o, h, l, cl, int(round(v or 0)))
    if not rows:
        raise CoinvestError("%s: no candles" % sym)
    ts = sorted(rows)
    last = rows[ts[-1]]
    meta = {"currency": "USD", "symbol": sym, "exchangeName": "LIQUID", "fullExchangeName": "Liquid (Co-Invest)",
            "instrumentType": "EQUITY" if stock else "CRYPTOCURRENCY", "liquidSymbol": liquid,
            "exchangeTimezoneName": "America/New_York", "timezone": "EDT",
            "regularMarketPrice": last[3], "regularMarketVolume": last[4],
            "regularMarketTime": int(min(now, (ts[-1] - (NY_8AM_UTC_SHIFT if daily else 0)) + step)),
            "dataGranularity": GRAN[interval], "longName": ans.get("displayName") or sym}
    if daily and len(ts) > 1:
        meta["previousClose"] = meta["chartPreviousClose"] = rows[ts[-2]][3]
    quote = {k: [rows[t][i] for t in ts] for i, k in enumerate(("open", "high", "low", "close", "volume"))}
    doc = {"chart": {"result": [{"meta": meta, "timestamp": ts, "indicators": {"quote": [quote]}}], "error": None}}
    return sym, liquid, doc


def load_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        raise CoinvestError("could not read %s: %s" % (path, e))


def save_json(path, doc):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")


def merge_map(path, pairs):
    m = load_json(path) if os.path.exists(path) else {}
    m.update(pairs)
    save_json(path, dict(sorted(m.items())))


def cmd_universe(a):
    doc = load_json(a.file)
    markets = doc.get("markets") if isinstance(doc, dict) else doc
    if not isinstance(markets, list) or not markets:
        raise CoinvestError("%s holds no markets (save the search_markets answer as is)" % a.file)
    lines, pairs = [], {}
    for m in markets:
        sym = plain(m.get("symbol"))
        if sym in pairs:
            continue
        pairs[sym] = m.get("symbol")
        name = str(m.get("displayName") or sym).replace("|", "/")
        lines.append("%s|%s" % (sym, name))
    d = os.path.dirname(a.out)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    merge_map(a.map, pairs)
    print("Wrote %s: %d Liquid markets. Map back to Liquid ids in %s." % (a.out, len(lines), a.map))
    return 0


def cmd_bars(a):
    pairs, wrote = {}, []
    for f in a.files:
        found = answers(load_json(f))
        if not found:
            raise CoinvestError("%s holds no show_chart answer (save it as returned)" % f)
        for ans in found:
            sym, liquid, doc = to_chart(ans, a.now)
            path = os.path.join(a.out, sym + ".json")
            save_json(path, doc)
            pairs[sym] = liquid
            q = doc["chart"]["result"][0]
            wrote.append("%-6s %-4s %3d bars, last close %s" % (sym, q["meta"]["dataGranularity"],
                                                              len(q["timestamp"]), q["meta"]["regularMarketPrice"]))
    merge_map(a.map, pairs)
    print("Wrote %d chart(s) to %s/:" % (len(wrote), a.out))
    for w in wrote:
        print("  " + w)
    print("Read them with --offline %s (scan.py, entry.py, exit.py). Volume is contracts: scan with --min-volume 0."
          % a.out)
    return 0


def cmd_order(a):
    doc = load_json(a.orders)
    orders = doc.get("orders") if isinstance(doc, dict) else doc
    if not isinstance(orders, list) or not orders:
        raise CoinvestError("no orders in %s (run trader-budget first)" % a.orders)
    if not 1 <= a.index <= len(orders):
        raise CoinvestError("no order #%d in %s" % (a.index, a.orders))
    o = orders[a.index - 1]
    args = o.get("args") or o.get("order") or o
    sym = plain(args.get("symbol"))
    side = args.get("side")
    if side != "buy":
        raise CoinvestError("order #%d is a %s: only a long entry maps to suggest_order here; close a "
                            "position with Co-Invest's close_position preview" % (a.index, side))
    qty = float(args.get("qty"))
    entry = o.get("entry") or (o.get("plan") or {}).get("entry") or args.get("limit_price")
    if entry is None:
        raise CoinvestError("order #%d has no entry price to size the notional" % a.index)
    m = load_json(a.map) if os.path.exists(a.map) else {}
    out = {"asset": m.get(sym, sym), "side": "long", "leverage": 1,
           "orderType": "limit" if args.get("type") == "limit" else "market",
           "size": round(qty * float(entry), 2), "sizeBasis": "notional",
           "stopLoss": float(args["stop_loss_stop_price"]) if args.get("stop_loss_stop_price") else None,
           "takeProfit": float(args["take_profit_limit_price"]) if args.get("take_profit_limit_price") else None,
           "markPrice": float(entry),
           "reasoning": (o.get("why") or "planned day trade from the trader pack")[:200]}
    if out["orderType"] == "limit":
        out["limitPrice"] = float(args["limit_price"])
    out = dict((k, v) for k, v in out.items() if v is not None)
    if a.json:
        print(json.dumps(out))
        return 0
    print("Co-Invest suggest_order for order #%d (paper only; it returns a review link, nothing is placed):" % a.index)
    print("  " + json.dumps(out))
    print("  %s long, $%s notional (%g x %s), leverage 1, stop %s, target %s"
          % (out["asset"], "{:,.2f}".format(out["size"]), qty, entry, out.get("stopLoss"), out.get("takeProfit")))
    print("Only after trader-risk PASS and the user's yes for this order (ticket.py approve). Not financial advice.")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Co-Invest (Liquid) data for the day-trader tools.")
    sub = p.add_subparsers(dest="cmd")
    u = sub.add_parser("universe", help="search_markets answer -> trader/universe.txt")
    u.add_argument("file")
    u.add_argument("--out", default="trader/universe.txt")
    u.add_argument("--map", default=DEFAULT_MAP)
    b = sub.add_parser("bars", help="show_chart answers -> Yahoo v8 charts in trader/bars/")
    b.add_argument("files", nargs="+")
    b.add_argument("--out", default=DEFAULT_BARS)
    b.add_argument("--map", default=DEFAULT_MAP)
    b.add_argument("--now", type=float, help="unix seconds for regularMarketTime's cap (default: now)")
    o = sub.add_parser("order", help="trader/orders.json -> suggest_order arguments")
    o.add_argument("--orders", default="trader/orders.json")
    o.add_argument("--index", type=int, default=1)
    o.add_argument("--map", default=DEFAULT_MAP)
    o.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    if not a.cmd:
        p.print_help()
        return 2
    try:
        return {"universe": cmd_universe, "bars": cmd_bars, "order": cmd_order}[a.cmd](a)
    except CoinvestError as e:
        print("coinvest.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
