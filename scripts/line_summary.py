#!/usr/bin/env python3
"""LINE 盤後總結推播。讀 Firestore 部位 + market_data.json,算損益後 broadcast。"""
import json
import os
import sys
import urllib.request

import firebase_admin
from firebase_admin import credentials, firestore

CONTRACT_MULT = {"TXF": 200, "MXF": 50, "TMF": 10, "大台": 200, "小台": 50, "微台": 10}
TYPE_NAME = {"TXF": "大台", "MXF": "小台", "TMF": "微台"}


def load_market():
    with open("data/market_data.json", encoding="utf-8") as f:
        return json.load(f)


def load_positions():
    key_json = os.environ["FIREBASE_KEY"]
    cred = credentials.Certificate(json.loads(key_json))
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    docs = db.collection("users").document("me").collection("positions").stream()
    return [d.to_dict() for d in docs]


def build_message(market, positions):
    m = market["market"]
    ma = market["ma_state"]
    adong = market.get("adong_signal", {})
    cur = m["current_price"]

    lines = []
    lines.append("📊 台指期盤後總結")
    lines.append(f"加權指數:{cur:,.0f}")
    chg = m.get("change", 0)
    pct = m.get("change_pct", 0)
    sign = "+" if chg >= 0 else ""
    lines.append(f"漲跌:{sign}{chg:,.0f} ({sign}{pct}%)")
    lines.append("")
    lines.append(f"均線:{ma['state']} / {ma['mode']}")
    lines.append(f"  5MA {ma['ma5']:,.0f}")
    lines.append(f"  20MA {ma['ma20']:,.0f}")
    lines.append(f"  60MA {ma['ma60']:,.0f}")
    lines.append(f"建議槓桿:{ma['leverage']} 倍")
    if adong:
        lines.append(f"訊號:{adong.get('type','')} → {adong.get('action','')}")
    lines.append("")

    if positions:
        lines.append("💰 我的部位")
        total = 0
        for p in positions:
            mult = CONTRACT_MULT.get(p.get("type"), 10)
            pnl = round((cur - p["entry_price"]) * mult * p["lots"])
            total += pnl
            tname = TYPE_NAME.get(p.get("type"), p.get("type", ""))
            psign = "+" if pnl >= 0 else ""
            lines.append(f"  {tname} {p['lots']}口 @{p['entry_price']:,.0f} → {psign}{pnl:,} 元")
        tsign = "+" if total >= 0 else ""
        lines.append(f"總未實現損益:{tsign}{total:,} 元")
    else:
        lines.append("💰 目前無部位")

    return "\n".join(lines)


def push_line(text):
    token = os.environ["LINE_TOKEN"]
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/broadcast",
        data=json.dumps({"messages": [{"type": "text", "text": text}]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        print("LINE 回應:", resp.status)


def main():
    market = load_market()
    try:
        positions = load_positions()
    except Exception as e:
        print("讀取部位失敗,改推無部位版:", e, file=sys.stderr)
        positions = []
    msg = build_message(market, positions)
    print("=== 訊息內容 ===")
    print(msg)
    push_line(msg)
    print("✅ 推播完成")


if __name__ == "__main__":
    main()
