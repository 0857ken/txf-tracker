#!/usr/bin/env python3
"""建立每日資產淨值快照。

台指期實際部位主帳：
  defenseUsers/{ownerUid}/strategies/0050-defense-v1/state/account

期貨價格：
  1. data/futures_market.json 的當日 TAIFEX 正式逐合約結算價
  2. Firestore market/latest 的同日逐合約 mark
  3. 只有正式帳戶核對價本身也是同一交易日才可回退
  4. 絕不使用加權指數或過期 mark 代替期貨價格

users/me/positions 僅保留舊成本資料作唯讀相容。若正式主帳口數與
舊成本備份無法安全對應，停止快照，避免寫入錯誤淨值。
"""

import json
import os
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

CAPITAL_BASE = 2_000_000
TW_TZ = timezone(timedelta(hours=8))
STRATEGY_ID = "0050-defense-v1"

TXF_MULT = {
    "TX": 200,
    "TXF": 200,
    "大台": 200,
    "MTX": 50,
    "MXF": 50,
    "小台": 50,
    "TMF": 10,
    "微台": 10,
}
PRODUCT_ALIAS = {
    "TX": "TX",
    "TXF": "TX",
    "大台": "TX",
    "MTX": "MTX",
    "MXF": "MTX",
    "小台": "MTX",
    "TMF": "TMF",
    "微台": "TMF",
}
LEGACY_TYPE = {"TX": "TXF", "MTX": "MXF", "TMF": "TMF"}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_json_optional(path):
    try:
        return load_json(path)
    except FileNotFoundError:
        return None


def as_number(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def positive_number(value):
    value = as_number(value, 0.0)
    return value if value > 0 else None


def canonical_product(value):
    return PRODUCT_ALIAS.get(str(value or "").strip())


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


def legacy_cost_groups(rows):
    groups = {}
    for row in rows:
        product = canonical_product(row.get("type"))
        lots = as_number(row.get("lots"))
        entry = positive_number(row.get("entry_price"))
        if not product or not lots or entry is None:
            continue
        group = groups.setdefault(
            product,
            {"lots": 0.0, "weighted": 0.0, "weight": 0.0},
        )
        group["lots"] += lots
        group["weighted"] += entry * abs(lots)
        group["weight"] += abs(lots)

    for group in groups.values():
        group["entry_price"] = (
            group["weighted"] / group["weight"]
            if group["weight"] > 0
            else None
        )
    return groups


def trade_ledger_groups(state):
    groups = {}
    for row in (state or {}).get("openLots") or []:
        product = canonical_product(row.get("product"))
        month = str(row.get("month") or "")
        lots = as_number(row.get("lots"))
        entry = positive_number(row.get("entryPrice", row.get("entry_price")))
        if (
            not product
            or len(month) != 7
            or month[4] != "-"
            or lots <= 0
            or entry is None
        ):
            continue
        key = (product, month)
        group = groups.setdefault(
            key,
            {"lots": 0.0, "weighted": 0.0, "weight": 0.0},
        )
        group["lots"] += lots
        group["weighted"] += entry * lots
        group["weight"] += lots

    for group in groups.values():
        group["entry_price"] = (
            group["weighted"] / group["weight"]
            if group["weight"] > 0
            else None
        )
    return groups


def load_futures_master(
    db,
    legacy_positions,
    futures_cache=None,
    expected_date=None,
):
    owner = db.collection("strategy4System").document("owner").get()
    owner_uid = (owner.to_dict() or {}).get("uid") if owner.exists else None
    if not owner_uid:
        raise ValueError("找不到 0050 變速防守正式 owner")

    base = (
        db.collection("defenseUsers")
        .document(owner_uid)
        .collection("strategies")
        .document(STRATEGY_ID)
    )

    account_doc = base.collection("state").document("account").get()
    market_doc = base.collection("market").document("latest").get()
    trade_state_doc = base.collection("state").document("tradeLedger").get()
    if not account_doc.exists:
        raise ValueError("0050 變速防守正式帳戶不存在")

    account = account_doc.to_dict() or {}
    market = market_doc.to_dict() if market_doc.exists else {}
    market = market or {}
    trade_state = (
        trade_state_doc.to_dict() if trade_state_doc.exists else None
    )

    formal = account.get("positions") or []
    formal_counts = {}
    for position in formal:
        product = canonical_product(position.get("product"))
        if not product:
            raise ValueError("0050 變速防守帳戶含未知期貨商品")
        formal_counts[product] = formal_counts.get(product, 0) + 1

    market_date = str(market.get("date") or "")
    accepted_date = expected_date or (
        market_date if len(market_date) == 10 else None
    )

    quote_map = {}
    if (
        futures_cache
        and futures_cache.get("schema_version") == 1
        and futures_cache.get("date") == accepted_date
    ):
        for quote in futures_cache.get("rows") or []:
            product = canonical_product(quote.get("product"))
            month = str(quote.get("month") or "")
            mark = positive_number(quote.get("mark"))
            if (
                product
                and month
                and mark is not None
                and quote.get("date") == accepted_date
            ):
                quote_map[(product, month)] = {
                    **quote,
                    "_cache": "futures_market.json",
                }

    if market_date == accepted_date:
        for quote in market.get("futures") or []:
            product = canonical_product(quote.get("product"))
            month = str(quote.get("month") or "")
            mark = positive_number(quote.get("mark"))
            key = (product, month)
            if (
                product
                and month
                and mark is not None
                and quote.get("date") == accepted_date
                and key not in quote_map
            ):
                quote_map[key] = {
                    **quote,
                    "_cache": "firestore-market-latest",
                }

    legacy_groups = legacy_cost_groups(legacy_positions)
    ledger_groups = trade_ledger_groups(trade_state)
    positions = []

    for position in formal:
        product = canonical_product(position.get("product"))
        month = str(position.get("month") or "")
        lots = as_number(position.get("lots"))

        quote = quote_map.get((product, month))
        quote_mark = positive_number((quote or {}).get("mark"))
        account_mark = positive_number(position.get("mark"))
        account_date = str(
            account.get("equityDate")
            or str(account.get("asof") or "")[:10]
        )
        same_day_account_mark = (
            account_mark
            if accepted_date and account_date == accepted_date
            else None
        )
        current_price = (
            quote_mark
            if quote_mark is not None
            else same_day_account_mark
        )
        if current_price is None:
            raise ValueError(
                f"正式期貨主帳缺少 {product} {month} {accepted_date or ''} "
                "同日逐合約價格；停止每日淨值快照"
            )

        ledger = ledger_groups.get((product, month))
        legacy = legacy_groups.get(product)

        if trade_state is not None:
            cost_valid = (
                ledger is not None
                and abs(ledger["lots"] - lots) < 1e-9
                and positive_number(ledger.get("entry_price")) is not None
            )
            if not cost_valid:
                raise ValueError(
                    "期貨交易帳本與正式主帳口數不一致，停止每日淨值快照"
                )
            entry_price = ledger["entry_price"]
        else:
            cost_valid = (
                formal_counts.get(product) == 1
                and legacy is not None
                and abs(legacy["lots"] - lots) < 1e-9
                and positive_number(legacy.get("entry_price")) is not None
            )
            if not cost_valid:
                raise ValueError(
                    "正式期貨主帳與舊成本備份不一致，停止每日淨值快照"
                )
            entry_price = legacy["entry_price"]

        positions.append(
            {
                "product": product,
                "type": LEGACY_TYPE[product],
                "month": month,
                "lots": lots,
                "entry_price": entry_price,
                "current_price": current_price,
                "price_source": (
                    (quote or {}).get("source")
                    if quote_mark is not None
                    else "0050變速防守正式帳戶同日核對價"
                ),
                "price_date": (
                    (quote or {}).get("date")
                    if quote_mark is not None
                    else account_date
                ),
            }
        )

    initial_margin = as_number(account.get("initialMargin"), 0.0)
    if positions and initial_margin <= 0:
        raise ValueError("0050 變速防守正式帳戶缺少有效原始保證金")

    return {
        "positions": positions,
        "initial_margin": initial_margin,
        "account_asof": account.get("asof"),
        "market_updated_at": (
            (futures_cache or {}).get("updated_at")
            if any(
                (q or {}).get("_cache") == "futures_market.json"
                for q in quote_map.values()
            )
            else market.get("updatedAt")
        ),
        "market_date": accepted_date,
        "expected_price_date": accepted_date,
        "trade_ledger_active": trade_state is not None,
        "trade_ledger_revision": (
            trade_state.get("revision") if trade_state is not None else None
        ),
    }


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
    futures_master,
    stocks,
    custom_assets,
    realized_rows,
    now,
):
    benchmark_price = as_number(
        (market_data.get("market") or {}).get("current_price")
    )
    if benchmark_price <= 0:
        raise ValueError("market_data.json 缺少有效加權指數 current_price")

    positions = futures_master["positions"]
    price_map = stock_prices_data.get("prices") or {}
    realized_pnl = sum(as_number(r.get("pnl_twd")) for r in realized_rows)

    futures_margin_used = futures_master["initial_margin"]
    futures_notional = 0.0
    futures_unrealized = 0.0

    for p in positions:
        mult = TXF_MULT[p["product"]]
        lots = as_number(p.get("lots"))
        entry_price = as_number(p.get("entry_price"))
        current_price = as_number(p.get("current_price"))
        futures_notional += current_price * mult * abs(lots)
        futures_unrealized += (
            (current_price - entry_price) * mult * lots
        )

    stock_cost = 0.0
    stock_value = 0.0

    for stock in stocks:
        symbol = str(stock.get("symbol") or "")
        shares = as_number(stock.get("shares"))
        cost_price = as_number(stock.get("cost_price"))
        cost = cost_price * shares

        is_fund = bool(stock.get("is_fund")) or symbol.startswith("FUND:")
        if is_fund:
            current_price = as_number(stock.get("current_price"), cost_price)
        else:
            quoted = (price_map.get(symbol) or {}).get("price")
            current_price = as_number(
                quoted,
                as_number(stock.get("current_price"), cost_price),
            )
            if current_price <= 0:
                current_price = cost_price

        stock_cost += cost
        stock_value += current_price * shares

    custom_cost = 0.0
    custom_value = 0.0

    for asset in custom_assets:
        custom_cost += custom_cost_basis(asset)
        custom_value += as_number(asset.get("value"))

    stock_unrealized = stock_value - stock_cost
    custom_unrealized = custom_value - custom_cost
    unrealized_pnl = (
        futures_unrealized + stock_unrealized + custom_unrealized
    )

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

    futures_prices = [
        {
            "product": p["product"],
            "month": p["month"],
            "price": p["current_price"],
            "source": p["price_source"],
        }
        for p in positions
    ]

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
        "market_price": (
            positions[0]["current_price"]
            if len(positions) == 1
            else None
        ),
        "benchmark_price": benchmark_price,
        "futures_prices": futures_prices,
        "futures_source": "0050-defense-formal",
        "futures_account_asof": futures_master.get("account_asof"),
        "futures_market_updated_at": futures_master.get("market_updated_at"),
        "positions_count": len(positions),
        "stocks_count": len(stocks),
        "custom_assets_count": len(custom_assets),
        "market_updated_at": market_data.get("updated_at"),
        "stock_prices_updated_at": stock_prices_data.get("updated_at"),
        "schema_version": 2,
    }


def main():
    now = datetime.now(TW_TZ)
    market_data = load_json("data/market_data.json")
    stock_prices_data = load_json("data/stock_prices.json")
    fubon_data = load_json_optional("data/fubon_market_data.json")
    futures_cache = load_json_optional("data/futures_market.json")

    fubon_quote = (
        (fubon_data or {}).get("quote")
        if (fubon_data or {}).get("schema_version") == 1
        else None
    )
    expected_date = (
        fubon_quote.get("date")
        if fubon_quote
        and fubon_quote.get("symbol") == "0050"
        and fubon_quote.get("isClose") is True
        and len(str(fubon_quote.get("date") or "")) == 10
        else None
    )
    if expected_date is None:
        raise ValueError("Fubon 0050正式收盤日期尚不可用")

    benchmark_dates = (market_data.get("trend") or {}).get("dates") or []
    benchmark_date = benchmark_dates[-1] if benchmark_dates else None
    if benchmark_date != expected_date:
        raise ValueError(
            "0050正式收盤與加權指數日期不同，停止每日淨值快照"
        )

    db = init_db()
    legacy_positions = read_collection(db, "positions")
    futures_master = load_futures_master(
        db,
        legacy_positions,
        futures_cache=futures_cache,
        expected_date=expected_date,
    )
    stocks = read_collection(db, "stocks")
    custom_assets = read_collection(db, "customAssets")
    realized_rows = read_collection(db, "realizedPnl")

    payload = build_snapshot(
        market_data,
        stock_prices_data,
        futures_master,
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
        "futures_source=",
        payload["futures_source"],
    )


if __name__ == "__main__":
    main()
