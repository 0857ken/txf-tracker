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


def get_db():
    """初始化 Firebase Admin；重複呼叫時沿用既有 app。"""
    if not firebase_admin._apps:
        key_json = os.environ["FIREBASE_KEY"]
        cred = credentials.Certificate(json.loads(key_json))
        firebase_admin.initialize_app(cred)
    return firestore.client()


def load_positions():
    """用 Firebase Admin 讀既有投資秘書部位。"""
    db = get_db()
    docs = db.collection("users").document("me").collection("positions").stream()
    return [d.to_dict() for d in docs]


def load_defense_account():
    """讀正式第4策略 Forward 帳戶；只用手動核對資料，不讀券商庫存。"""
    db = get_db()
    owner = db.collection("strategy4System").document("owner").get()
    if not owner.exists:
        return None
    uid = str((owner.to_dict() or {}).get("uid") or "")
    if not uid:
        return None
    doc = (
        db.collection("defenseUsers").document(uid)
        .collection("strategies").document("0050-defense-v1")
        .collection("state").document("account").get()
    )
    return doc.to_dict() if doc.exists else None


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _mean(values):
    return sum(values) / len(values) if values else None


def compute_variable_defense(strategy, fubon):
    """以正式 Fubon 0050 收盤套用 Frozen 第4策略規則，供每日 LINE 概要。"""
    rows = [{"date": r["date"], "close": float(r["close"])} for r in strategy.get("target", [])]
    quote = (fubon or {}).get("quote") or {}

    valid_fubon = (
        (fubon or {}).get("schema_version") == 1
        and quote.get("symbol") == "0050"
        and quote.get("isClose") is True
        and isinstance(quote.get("date"), str)
        and len(quote["date"]) == 10
        and isinstance(quote.get("closePrice"), (int, float))
        and quote["closePrice"] > 0
    )
    if not rows or not valid_fubon:
        return {"ready": False, "reason": "Fubon 0050 收盤尚未確認"}

    qdate, qclose = quote["date"], float(quote["closePrice"])
    if qdate < rows[-1]["date"]:
        return {"ready": False, "reason": "Fubon 0050 收盤資料落後"}

    if qdate == rows[-1]["date"]:
        rows[-1]["close"] = qclose
    else:
        rows.append({"date": qdate, "close": qclose})

    if len(rows) < 80:
        return {"ready": False, "reason": "0050 歷史資料不足 80 個交易日"}

    closes = [r["close"] for r in rows]
    ma10 = _mean(closes[-10:])
    ma20 = _mean(closes[-20:])
    ma60 = _mean(closes[-60:])
    ma60_lag20 = _mean(closes[-80:-20])

    bear = qclose < ma60 and ma60 < ma60_lag20
    if not bear:
        target = 2.0
        state = "非確認空頭"
    elif qclose >= ma20:
        target = 1.5
        state = "確認空頭"
    elif qclose > ma10:
        target = 1.0
        state = "確認空頭"
    else:
        target = 0.5
        state = "確認空頭"

    return {
        "ready": True,
        "date": qdate,
        "close": qclose,
        "state": state,
        "bear": bear,
        "target": target,
        "ma10": ma10,
        "ma20": ma20,
        "ma60": ma60,
        "ma60_lag20": ma60_lag20,
    }


def variable_defense_lines(result):
    lines = ["🛡️ 0050 變速防守"]
    if not result.get("ready"):
        lines.append("  ⚠️ " + result.get("reason", "資料尚未就緒"))
        return lines
    lines.append(f"  0050收盤:{result['close']:.2f}")
    lines.append(f"  狀態:{result['state']}｜目標曝險:{result['target']:.1f}x")
    lines.append(
        f"  MA10 {result['ma10']:.2f}｜MA20 {result['ma20']:.2f}｜MA60 {result['ma60']:.2f}"
    )
    lines.append("  🔗 https://0857ken.github.io/txf-tracker/defense.html")
    return lines


def defense_lot_status(result, account):
    """比較正式 Forward 手動核對口數與理論策略口數。保證金不改寫理論目標。"""
    if not result.get("ready"):
        return {"ready": False, "reason": "策略訊號尚未確認"}
    if not account:
        return {"ready": False, "reason": "正式 Forward 帳戶尚未建立"}

    equity = float(account.get("equity") or 0)
    outside = float(account.get("outside") or 0)
    total_equity = equity + outside
    positions = [p for p in (account.get("positions") or []) if int(p.get("lots") or 0) != 0]
    if total_equity <= 0:
        return {"ready": False, "reason": "策略總權益無效"}
    if len(positions) != 1:
        return {"ready": False, "reason": "目前為混合商品，口數不可直接一對一比較"}

    p = positions[0]
    product = str(p.get("product") or "")
    mult = {"TX": 200, "TXF": 200, "MTX": 50, "MXF": 50, "TMF": 10}.get(product)
    mark = p.get("mark")
    lots = int(p.get("lots") or 0)
    if not mult or not isinstance(mark, (int, float)) or mark <= 0:
        return {"ready": False, "reason": "缺少期貨參考價"}

    target_notional = total_equity * float(result["target"])
    per_lot_notional = float(mark) * mult
    ideal_lots = target_notional / per_lot_notional
    down = max(1, int(ideal_lots // 1))
    up = max(1, down if ideal_lots == down else down + 1)
    target_lots = down if abs(down * per_lot_notional - target_notional) <= abs(up * per_lot_notional - target_notional) else up
    delta = target_lots - lots

    return {
        "ready": True,
        "product": product,
        "current_lots": lots,
        "target_lots": target_lots,
        "delta_lots": delta,
        "same": delta == 0,
        "strategy_equity": total_equity,
        "mark": float(mark),
    }


def defense_lot_lines(status):
    if not status.get("ready"):
        return ["  口數核對:⚠️ " + status.get("reason", "無法比較")]
    product_name = {"TX": "大台", "TXF": "大台", "MTX": "小台", "MXF": "小台", "TMF": "微台"}.get(
        status["product"], status["product"]
    )
    if status["same"]:
        verdict = "✅ 與策略相同"
    elif status["delta_lots"] > 0:
        verdict = f"⚠️ 少 {status['delta_lots']} 口"
    else:
        verdict = f"⚠️ 多 {abs(status['delta_lots'])} 口"
    return [
        f"  策略口數:{product_name} {status['target_lots']}口｜目前:{status['current_lots']}口",
        f"  口數核對:{verdict}",
    ]


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

    # 0050 變速防守:每日固定附上概要，不只在訊號變更時提醒。
    try:
        strat = load_json("data/strategy_data.json")
        fubon = load_json("data/fubon_market_data.json")
        defense = compute_variable_defense(strat, fubon)
        defense_lines = variable_defense_lines(defense)
        try:
            defense_account = load_defense_account()
            lot_status = defense_lot_status(defense, defense_account)
            defense_lines[3:3] = defense_lot_lines(lot_status)
        except Exception as e:
            print("變速防守口數核對失敗:", e)
            defense_lines.insert(3, "  口數核對:⚠️ 暫時無法讀取正式 Forward 帳戶")
        msg += "\n\n" + "\n".join(defense_lines)
    except Exception as e:
        print("變速防守概要計算失敗:", e)
        msg += "\n\n🛡️ 0050 變速防守\n  ⚠️ 概要暫時無法計算"

    # 其他策略訊號:只在有觸發時附加
    if strategy_calc:
        try:
            strat = strat if 'strat' in locals() else load_json("data/strategy_data.json")
            result = strategy_calc.compute_signals(strat)
            if result["signals"]:
                msg += "\n\n📈 0050 其他策略訊號"
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
