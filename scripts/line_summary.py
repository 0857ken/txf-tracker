#!/usr/bin/env python3
"""
LINE 盤後總結推播。
讀 Firestore 部位 + data/market_data.json,計算損益,broadcast 推播。
由 GitHub Actions 每天 13:50(台灣時間)執行。
環境變數:
  LINE_TOKEN    — LINE Messaging API channel access token
  FIREBASE_KEY  — Firebase service account JSON(整個字串)
"""
import json
import os
import sys
import urllib.request

import firebase_admin
from firebase_admin import credentials, firestore

try:
    import strategy_calc
except ImportError:
    strategy_calc = None

CONTRACT_MULT = {"TXF": 200, "MXF": 50, "TMF": 10}
TYPE_NAME = {"TXF": "大台", "MXF": "小台", "TMF": "微台"}


def load_market():
    """讀取報價 JSON(與腳本同 repo 的 data/market_data.json)。"""
    with open("data/market_data.json", encoding="utf-8") as f:
        return json.load(f)


def load_positions():
    """用 Firebase Admin 讀 Firestore 部位。"""
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
            lines.append(
                f"  {tname} {p['lots']}口 @{p['entry_price']:,.0f} "
                f"→ {psign}{pnl:,} 元"
            )
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
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
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

    # 策略訊號:只在有觸發時附加
    if strategy_calc:
        try:
            with open("data/strategy_data.json", encoding="utf-8") as sf:
                strat = json.load(sf)
            result = strategy_calc.compute_signals(strat)
            if result["signals"]:
                msg += "\n\n📈 0050 策略訊號"
                msg += "\n現價 " + str(result["price"]) + " · RS " + str(round(result["rs"], 2))
                for s in result["signals"]:
                    msg += "\n" + s
        except Exception as e:
            print("策略訊號計算失敗:", e)
    print("=== 訊息內容 ===")
    print(msg)
    push_line(msg)
    print("✅ 推播完成")


if __name__ == "__main__":
    main()
