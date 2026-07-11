#!/usr/bin/env python3
"""策略資料抓取。抓 0050.TW 完整OHLCV + ^TWII 大盤序列,寫 data/strategy_data.json。"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

TW_TZ = timezone(timedelta(hours=8))
TARGET = "0050.TW"
BENCHMARK = "%5ETWII"


def fetch_ohlcv(symbol, rng="6mo"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={rng}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = json.loads(resp.read().decode())
    result = raw["chart"]["result"][0]
    ts = result["timestamp"]
    q = result["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(ts):
        o, h, l, c, v = (q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i])
        if None in (o, h, l, c):
            continue
        d = datetime.fromtimestamp(t, TW_TZ).strftime("%Y-%m-%d")
        rows.append({"date": d, "open": round(o,2), "high": round(h,2), "low": round(l,2), "close": round(c,2), "volume": int(v) if v else 0})
    return rows


def fetch_close_series(symbol, rng="6mo"):
    return {r["date"]: r["close"] for r in fetch_ohlcv(symbol, rng)}


def main():
    target = fetch_ohlcv(TARGET)
    if not target:
        print("ERROR: 抓不到 0050", file=sys.stderr); sys.exit(1)
    bench = fetch_close_series(BENCHMARK)
    aligned_bench = [bench.get(r["date"]) for r in target]
    output = {
        "updated_at": datetime.now(TW_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "symbol": "0050",
        "target": target,
        "benchmark_close": aligned_bench,
    }
    os.makedirs("data", exist_ok=True)
    with open("data/strategy_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"OK 0050 {len(target)} 天, 最新收盤 {target[-1]['close']}")


if __name__ == "__main__":
    main()
