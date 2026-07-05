#!/usr/bin/env python3
"""股票抓價。讀 Firestore users/me/stocks,抓 Yahoo 現價,寫 data/stock_prices.json。"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

TW_TZ = timezone(timedelta(hours=8))


def load_stock_list():
    key_json = os.environ["FIREBASE_KEY"]
    cred = credentials.Certificate(json.loads(key_json))
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    docs = db.collection("users").document("me").collection("stocks").stream()
    stocks = []
    for d in docs:
        data = d.to_dict()
        data["id"] = d.id
        stocks.append(data)
    return stocks


def fetch_price(code, market):
    suffix = ".TWO" if market == "TWO" else ".TW"
    symbol = code + suffix
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = json.loads(resp.read().decode())
    result = raw["chart"]["result"][0]
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    return price, prev


def main():
    stocks = load_stock_list()
    prices = {}
    for s in stocks:
        code = s.get("code")
        if not code:
            continue
        market = s.get("market", "TW")
        try:
            price, prev = fetch_price(code, market)
            change = round(price - prev, 2) if (price and prev) else 0
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0
            prices[code] = {"price": price, "prev_close": prev, "change": change, "change_pct": change_pct}
            print(f"OK {code}: {price}")
        except Exception as e:
            print(f"ERROR {code}: {e}", file=sys.stderr)
            prices[code] = {"price": None, "error": str(e)}

    output = {"updated_at": datetime.now(TW_TZ).strftime("%Y-%m-%d %H:%M:%S"), "prices": prices}
    os.makedirs("data", exist_ok=True)
    with open("data/stock_prices.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"✅ 已更新 {len(prices)} 檔股票價格")


if __name__ == "__main__":
    main()
