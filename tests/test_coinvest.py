import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

from _load import load, FIX

cv = load("trader-scanner", "coinvest")
scan = load("trader-scanner", "scan")
entry = load("trader-entry", "entry")

CDIR = os.path.join(FIX, "trader-scanner", "coinvest")
MARKETS = os.path.join(CDIR, "markets-2026-10-28.json")    # real search_markets answer, Oct 28 2026
DAILY = os.path.join(CDIR, "daily-1d-2026-10-28.json")     # 6 real show_chart 1d answers, 45 candles each
SOXL5 = os.path.join(CDIR, "SOXL-5m-2026-10-28.json")      # a real show_chart 5m answer
NOW = 1793181600  # 2026-10-28 06:00 New York


def run(mod, argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = mod.main(argv)
    return code, out.getvalue(), err.getvalue()


class Coinvest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.bars = os.path.join(self.tmp, "bars")
        self.map = os.path.join(self.tmp, "liquid_symbols.json")

    def test_plain_tickers(self):
        self.assertEqual(cv.plain("xyz:MU"), "MU")
        self.assertEqual(cv.plain("BTC"), "BTC")
        with self.assertRaises(cv.CoinvestError):
            cv.plain("")

    def test_universe_from_search_markets(self):
        out = os.path.join(self.tmp, "universe.txt")
        code, text, _ = run(cv, ["universe", MARKETS, "--out", out, "--map", self.map])
        self.assertEqual(code, 0)
        with open(out) as fh:
            lines = fh.read().splitlines()
        self.assertEqual(len(lines), 15)
        self.assertIn("SKHX|SKHYNIX", lines)
        with open(self.map) as fh:
            self.assertEqual(json.load(fh)["MU"], "xyz:MU")

    def test_daily_bars_become_yahoo_charts(self):
        code, text, _ = run(cv, ["bars", DAILY, "--out", self.bars, "--map", self.map, "--now", str(NOW)])
        self.assertEqual(code, 0, text)
        with open(os.path.join(self.bars, "MU.json")) as fh:
            r = json.load(fh)["chart"]["result"][0]
        # weekends dropped for a stock perp: 45 calendar days -> 33 weekdays
        self.assertEqual(len(r["timestamp"]), 33)
        self.assertEqual(r["meta"]["regularMarketPrice"], 964.10)
        self.assertEqual(r["meta"]["previousClose"], 941.60)
        self.assertEqual(r["meta"]["exchangeName"], "LIQUID")
        # stamped inside the right New York date: 2026-10-27 candle -> Oct 27 in the scanner
        s = scan.series_from_result(r)
        self.assertEqual(scan.ts_to_eastern(s["t"][-2]).date().isoformat(), "2026-10-27")
        with open(os.path.join(self.bars, "HYPE.json")) as fh:
            self.assertEqual(len(json.load(fh)["chart"]["result"][0]["timestamp"]), 45)  # crypto keeps weekends

    def test_daily_scan_reads_liquid_bars(self):
        run(cv, ["bars", DAILY, "--out", self.bars, "--map", self.map, "--now", str(NOW)])
        wl = os.path.join(self.tmp, "watchlist.json")
        code, text, err = run(scan, ["daily", "--offline", self.bars, "--min-volume", "0", "--min-price", "0",
                                     "--now", "2026-10-28 06:00", "--out", wl])
        self.assertEqual(code, 0, err)
        self.assertIn("Liquid via Co-Invest", text)
        with open(wl) as fh:
            doc = json.load(fh)
        self.assertEqual(doc["source"], "liquid")
        self.assertEqual(doc["scanned"], 6)
        self.assertEqual([h["symbol"] for h in doc["hits"]], ["HYPE"])
        self.assertEqual(doc["hits"][0]["setups"], ["reclaim_ma20"])

    def test_intraday_bars_read_by_entry(self):
        run(cv, ["bars", SOXL5, "--out", self.bars, "--map", self.map, "--now", str(NOW)])
        with open(os.path.join(self.bars, "SOXL.json")) as fh:
            ch = entry.parse_chart(fh.read(), "SOXL")
        self.assertEqual(len(ch["bars"]), 5)
        self.assertEqual(ch["bars"][-1]["c"], 103.58)
        self.assertEqual(ch["bars"][0]["t"] % 300, 0)

    def test_order_maps_the_bracket_to_suggest_order(self):
        with open(self.map, "w") as fh:
            json.dump({"MU": "xyz:MU"}, fh)
        orders = os.path.join(self.tmp, "orders.json")
        with open(orders, "w") as fh:
            json.dump({"orders": [{"symbol": "MU", "side": "buy", "qty": "2", "type": "market",
                                   "take_profit_limit_price": "980.00", "stop_loss_stop_price": "950.00",
                                   "why": "orb on MU", "plan": {"entry": 965.0}}]}, fh)
        code, text, _ = run(cv, ["order", "--orders", orders, "--map", self.map, "--json"])
        self.assertEqual(code, 0)
        out = json.loads(text)
        self.assertEqual(out, {"asset": "xyz:MU", "side": "long", "leverage": 1, "orderType": "market",
                               "size": 1930.0, "sizeBasis": "notional", "stopLoss": 950.0,
                               "takeProfit": 980.0, "markPrice": 965.0, "reasoning": "orb on MU"})

    def test_order_refuses_a_sell(self):
        orders = os.path.join(self.tmp, "orders.json")
        with open(orders, "w") as fh:
            json.dump({"orders": [{"symbol": "MU", "side": "sell", "qty": "2", "type": "market"}]}, fh)
        code, _, err = run(cv, ["order", "--orders", orders, "--map", self.map])
        self.assertEqual(code, 1)
        self.assertIn("close_position", err)

    def test_bad_file_says_so(self):
        code, _, err = run(cv, ["bars", MARKETS, "--out", self.bars, "--map", self.map])
        self.assertEqual(code, 1)
        self.assertIn("no show_chart answer", err)


if __name__ == "__main__":
    unittest.main()
