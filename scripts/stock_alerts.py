#!/usr/bin/env python3
"""股票警戒 LINE 通知。

讀取:
- Firestore users/me/stocks
- data/stock_prices.json

狀態:
- Firestore users/me/stockAlertStates/{stockDocId}

規則:
- notify_enabled=false -> 不通知，狀態標記 disabled
- price >= alert_high -> high
- price <= alert_low -> low
- 其他 -> normal
- 只有 zone 改變時才通知；回到 normal 會重新武裝
- 警戒門檻修改時視為重新武裝
"""

import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

TW_TZ = timezone(timedelta(hours=8))
STATE_COLLECTION = "stockAlertStates"


def as_number(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def load_prices(path="data/stock_prices.json"):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def init_db():
    key_json = os.environ["FIREBASE_KEY"]
    cred = credentials.Certificate(json.loads(key_json))
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def load_stocks(db):
    docs = db.collection("users").document("me").collection("stocks").stream()
    rows = []
    for d in docs:
        row = d.to_dict() or {}
        row["id"] = d.id
        rows.append(row)
    return rows


def get_price(stock, price_map):
    symbol = str(stock.get("symbol") or "")
    is_fund = bool(stock.get("is_fund")) or symbol.startswith("FUND:")

    if is_fund:
        return as_number(stock.get("current_price"))

    quoted = as_number((price_map.get(symbol) or {}).get("price"))
    if quoted is not None:
        return quoted

    return as_number(stock.get("current_price"))


def get_zone(price, alert_high, alert_low):
    if price is None:
        return None
    if alert_high is not None and price >= alert_high:
        return "high"
    if alert_low is not None and price <= alert_low:
        return "low"
    return "normal"


def thresholds_match(state, alert_high, alert_low):
    return (
        as_number(state.get("alert_high")) == alert_high
        and as_number(state.get("alert_low")) == alert_low
    )


def display_symbol(stock):
    symbol = str(stock.get("symbol") or "")
    return symbol.replace("FUND:", "") or str(stock.get("name") or "未命名標的")


def build_alert_line(stock, zone, price, alert_high, alert_low):
    symbol = display_symbol(stock)
    name = str(stock.get("name") or "").strip()
    title = f"{symbol} {name}".strip()

    if zone == "high":
        return (
            f"🔺 {title}\n"
            f"現價 {price:,.2f} 已達/突破上限 {alert_high:,.2f}"
        )

    return (
        f"🔻 {title}\n"
        f"現價 {price:,.2f} 已達/跌破下限 {alert_low:,.2f}"
    )


def push_line(text):
    token = os.environ["LINE_TOKEN"]
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/broadcast",
        data=json.dumps(
            {"messages": [{"type": "text", "text": text}]},
            ensure_ascii=False,
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        print("LINE 回應:", resp.status)


def main():
    now = datetime.now(TW_TZ)
    payload = load_prices()
    price_map = payload.get("prices") or {}

    db = init_db()
    stocks = load_stocks(db)

    state_col = (
        db.collection("users")
        .document("me")
        .collection(STATE_COLLECTION)
    )

    alerts = []
    state_updates = []

    for stock in stocks:
        stock_id = stock["id"]
        symbol = display_symbol(stock)
        alert_high = as_number(stock.get("alert_high"))
        alert_low = as_number(stock.get("alert_low"))
        notify_enabled = stock.get("notify_enabled") is not False

        state_ref = state_col.document(stock_id)
        state_snap = state_ref.get()
        state = state_snap.to_dict() if state_snap.exists else {}
        state = state or {}

        if not notify_enabled:
            state_updates.append(
                (
                    state_ref,
                    {
                        "symbol": symbol,
                        "state": "disabled",
                        "alert_high": alert_high,
                        "alert_low": alert_low,
                        "updated_at": firestore.SERVER_TIMESTAMP,
                    },
                )
            )
            continue

        if alert_high is None and alert_low is None:
            state_updates.append(
                (
                    state_ref,
                    {
                        "symbol": symbol,
                        "state": "unconfigured",
                        "alert_high": None,
                        "alert_low": None,
                        "updated_at": firestore.SERVER_TIMESTAMP,
                    },
                )
            )
            continue

        if (
            alert_high is not None
            and alert_low is not None
            and alert_low >= alert_high
        ):
            print(
                f"WARNING {symbol}: alert_low({alert_low}) >= "
                f"alert_high({alert_high})，略過"
            )
            continue

        price = get_price(stock, price_map)
        if price is None:
            print(f"WARNING {symbol}: 無可用現價，略過")
            continue

        zone = get_zone(price, alert_high, alert_low)

        has_prior_state = state_snap.exists
        same_thresholds = thresholds_match(state, alert_high, alert_low)
        prev_state = state.get("state") if has_prior_state else None

        # B 模式：第一次啟用 / 從停用恢復 / 門檻修改時，
        # 只建立目前 zone，不立即推送。之後真的跨入 high/low 才通知。
        baseline_only = (
            not has_prior_state
            or not same_thresholds
            or prev_state in (None, "disabled", "unconfigured")
        )

        should_alert = (
            not baseline_only
            and zone in ("high", "low")
            and zone != prev_state
        )

        update = {
            "symbol": symbol,
            "state": zone,
            "alert_high": alert_high,
            "alert_low": alert_low,
            "last_price": price,
            "price_as_of": (price_map.get(str(stock.get("symbol") or "")) or {}).get("as_of"),
            "updated_at": firestore.SERVER_TIMESTAMP,
        }

        if should_alert:
            alerts.append(
                build_alert_line(
                    stock,
                    zone,
                    price,
                    alert_high,
                    alert_low,
                )
            )
            update["last_alert_at"] = firestore.SERVER_TIMESTAMP
            update["last_alert_price"] = price
            update["last_alert_zone"] = zone

        state_updates.append((state_ref, update))

        print(
            f"{symbol}: price={price} zone={zone} "
            f"prev={prev_state} baseline_only={baseline_only} "
            f"alert={should_alert}"
        )

    if alerts:
        text = "📣 股票價格警戒\n\n" + "\n\n".join(alerts)
        push_line(text)
        print(f"✅ LINE 警戒通知 {len(alerts)} 筆")
    else:
        print("ℹ️ 本次無新股票警戒訊號，不推送 LINE")

    batch = db.batch()
    for ref, update in state_updates:
        batch.set(ref, update, merge=True)
    batch.commit()

    print(
        f"✅ stock alert state 已更新 {len(state_updates)} 筆 "
        f"({now.strftime('%Y-%m-%d %H:%M:%S')} Asia/Taipei)"
    )


if __name__ == "__main__":
    main()
