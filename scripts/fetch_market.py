#!/usr/bin/env python3
"""抓 ^TWII 報價,算 5/20/60 均線與紅黑K,輸出 data/market_data.json"""
import json, sys, os, urllib.request
from datetime import datetime, timezone, timedelta

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=3mo"
TW_TZ = timezone(timedelta(hours=8))

def fetch_twii():
    req = urllib.request.Request(YAHOO_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = json.loads(resp.read().decode())
    result = raw["chart"]["result"][0]
    ts = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]
    opens = result["indicators"]["quote"][0]["open"]
    rows = []
    for t, o, c in zip(ts, opens, closes):
        if c is None or o is None:
            continue
        d = datetime.fromtimestamp(t, TW_TZ).strftime("%Y-%m-%d")
        rows.append({"date": d, "open": round(o, 2), "close": round(c, 2)})
    return rows

def ma(values, period):
    if len(values) < period:
        return None
    return round(sum(values[-period:]) / period, 2)

def build(rows):
    closes = [r["close"] for r in rows]
    current = closes[-1]
    prev = closes[-2] if len(closes) >= 2 else current
    ma5, ma20, ma60 = ma(closes, 5), ma(closes, 20), ma(closes, 60)
    if ma5 and ma20 and ma60:
        if ma5 > ma20 > ma60:
            state, mode, lev = "多頭排列", "收割模式", "1.5–2.0"
        elif ma5 < ma20 < ma60:
            state, mode, lev = "空頭排列", "防禦模式", "0–0.6"
        elif current > ma20:
            state, mode, lev = "5日穿越月線", "進攻模式", "1.2–1.5"
        else:
            state, mode, lev = "均線走平", "觀察模式", "0.8–1.0"
    else:
        state = mode = lev = "—"
    today = rows[-1]
    if today["close"] >= today["open"]:
        adong = {"type": "紅K", "action": "留倉"}
    else:
        adong = {"type": "黑K", "action": "當日加碼單出清"}
    last30 = rows[-30:]
    return {
        "updated_at": datetime.now(TW_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "market": {
            "current_price": current, "prev_close": prev,
            "change": round(current - prev, 2),
            "change_pct": round((current - prev) / prev * 100, 2) if prev else 0,
        },
        "ma_state": {"ma5": ma5, "ma20": ma20, "ma60": ma60, "state": state, "mode": mode, "leverage": lev},
        "adong_signal": adong,
        "trend": {"dates": [r["date"] for r in last30], "prices": [r["close"] for r in last30]},
    }

def main():
    rows = fetch_twii()
    if not rows:
        print("ERROR: 沒抓到報價", file=sys.stderr); sys.exit(1)
    data = build(rows)
    os.makedirs("data", exist_ok=True)
    with open("data/market_data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"OK 現價 {data['market']['current_price']}")

if __name__ == "__main__":
    main()
