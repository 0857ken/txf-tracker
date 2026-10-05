#!/usr/bin/env python3
"""建立每日資產淨值快照並寫入 Firestore users/me/dailySnapshots/{YYYY-MM-DD}。"""

import json
import os
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

CAPITAL_BASE = 2_000_000
TW_TZ = timezone(timedelta(hours=8))

TXF_MULT = {
    "TXF": 200,
    "MXF": 50,
    "TMF": 10,
    "大台": 200,
    "小台": 50,
    "微台": 10,
}

# 與目前 assets.html 的 200萬計畫主計算一致。
# TMF 尚無獨立正式保證金規格，因此暫沿用現況 30,000。
MARGIN_PER_LOT = {
    "TXF": 135_000,
    "大台": 135_000,
    "MXF": 30_000,
    "小台": 30_000,
    "TMF": 30_000,
    "微台": 30_000,
}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def as_number(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def init_db():
    key_json = os.environ["FIREBASE_KEY"]
    cred = credentials.Certificate(json.loads(key_json))
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def read_collection(db, name):
    docs = db.collection("users").document("me").collection(name).stream()
    rows = []
    for d in docs:
        row = d.to_dict() or {}
        row["id"] = d.id
        rows.append(row)
    return rows


def custom_cost_basis(asset):
    shares = as_number(asset.get("shares"))
    cost = as_number(asset.get("cost"))
    value = as_number(asset.get("value"))
    if shares > 0 and cost > 0:
        return shares * cost
    return value


def build_snapshot(
    market_data,
    stock_prices_data,
    positions,
    stocks,
    custom_assets,
    realized_rows,
    now,
):
    market_price = as_number((market_data.get("market") or {}).get("current_price"))
    if market_price <= 0:
        raise ValueError("market_data.json 缺少有效 current_price")

    price_map = stock_prices_data.get("prices") or {}
    realized_pnl = sum(as_number(r.get("pnl_twd")) for r in realized_rows)

    futures_margin_used = 0.0
    futures_notional = 0.0
    futures_unrealized = 0.0

    for p in positions:
        ptype = p.get("type")
        mult = TXF_MULT.get(ptype)
        margin = MARGIN_PER_LOT.get(ptype)
        if not mult or margin is None:
            raise ValueError(f"未知期貨種類: {ptype!r}")

        lots = as_number(p.get("lots"))
        entry_price = as_number(p.get("entry_price"))
        futures_margin_used += margin * abs(lots)
        futures_notional += market_price * mult * abs(lots)
        futures_unrealized += (market_price - entry_price) * mult * lots

    stock_cost = 0.0
    stock_value = 0.0

    for s in stocks:
        symbol = str(s.get("symbol") or "")
        shares = as_number(s.get("shares"))
        cost_price = as_number(s.get("cost_price"))
        cost = cost_price * shares

        is_fund = bool(s.get("is_fund")) or symbol.startswith("FUND:")
        if is_fund:
            current_price = as_number(s.get("current_price"), cost_price)
        else:
            quoted = (price_map.get(symbol) or {}).get("price")
            current_price = as_number(
                quoted,
                as_number(s.get("current_price"), cost_price),
            )
            if current_price <= 0:
                current_price = cost_price

        stock_cost += cost
        stock_value += current_price * shares

    custom_cost = 0.0
    custom_value = 0.0

    for a in custom_assets:
        custom_cost += custom_cost_basis(a)
        custom_value += as_number(a.get("value"))

    stock_unrealized = stock_value - stock_cost
    custom_unrealized = custom_value - custom_cost
    unrealized_pnl = futures_unrealized + stock_unrealized + custom_unrealized

    cash_used = futures_margin_used + stock_cost + custom_cost
    cash = CAPITAL_BASE + realized_pnl - cash_used

    invested_cost = futures_margin_used + stock_cost + custom_cost
    invested_value = (
        futures_margin_used
        + futures_unrealized
        + stock_value
        + custom_value
    )

    net_worth = CAPITAL_BASE + realized_pnl + unrealized_pnl
    total_pnl = net_worth - CAPITAL_BASE
    leverage = futures_notional / CAPITAL_BASE

    return {
        "date": now.strftime("%Y-%m-%d"),
        "captured_at": now.isoformat(),
        "capital_base": CAPITAL_BASE,
        "net_worth": round(net_worth),
        "total_pnl": round(total_pnl),
        "realized_pnl": round(realized_pnl),
        "unrealized_pnl": round(unrealized_pnl),
        "pnl_pct": round(total_pnl / CAPITAL_BASE * 100, 4),
        "cash": round(cash),
        "cash_pct": round(cash / CAPITAL_BASE * 100, 4),
        "invested_value": round(invested_value),
        "invested_cost": round(invested_cost),
        "futures_margin_used": round(futures_margin_used),
        "futures_notional": round(futures_notional),
        "leverage": round(leverage, 4),
        "market_price": market_price,
        "positions_count": len(positions),
        "stocks_count": len(stocks),
        "custom_assets_count": len(custom_assets),
        "market_updated_at": market_data.get("updated_at"),
        "stock_prices_updated_at": stock_prices_data.get("updated_at"),
        "schema_version": 1,
    }


def main():
    now = datetime.now(TW_TZ)
    market_data = load_json("data/market_data.json")
    stock_prices_data = load_json("data/stock_prices.json")

    db = init_db()
    positions = read_collection(db, "positions")
    stocks = read_collection(db, "stocks")
    custom_assets = read_collection(db, "customAssets")
    realized_rows = read_collection(db, "realizedPnl")

    payload = build_snapshot(
        market_data,
        stock_prices_data,
        positions,
        stocks,
        custom_assets,
        realized_rows,
        now,
    )
    payload["updated_at"] = firestore.SERVER_TIMESTAMP

    doc_id = payload["date"]
    (
        db.collection("users")
        .document("me")
        .collection("dailySnapshots")
        .document(doc_id)
        .set(payload)
    )

    print(
        "✅ snapshot",
        doc_id,
        "net_worth=",
        payload["net_worth"],
        "total_pnl=",
        payload["total_pnl"],
        "leverage=",
        payload["leverage"],
    )


if __name__ == "__main__":
    main()
