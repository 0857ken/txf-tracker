#!/usr/bin/env python3
"""
LINE 盤後總結推播。
使用 0050 變速防守正式主帳 + 同交易日期貨合約結算價計算損益。
加權指數僅用於市場概況，不能作為期貨損益估值價。
由 GitHub Actions 排程觸發（可能延遲），僅在有策略訊號時附加策略區塊。
環境變數:
  LINE_TOKEN    — LINE Messaging API channel access token
  FIREBASE_KEY  — Firebase service account JSON(整個字串)
"""
import json
import os
import re
from math import isfinite
import sys
import urllib.request

import firebase_admin
from firebase_admin import credentials, firestore
from snapshot_assets import (
    load_futures_master,
    read_collection,
    load_json_optional,
)

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


def load_positions(market):
    """讀正式 0050 Forward 主帳與同日逐合約結算價；舊庫存僅供切換前成本備份。"""
    fubon = load_json("data/fubon_market_data.json")
    quote = (fubon or {}).get("quote") or {}
    expected_date = str(quote.get("date") or "")
    benchmark_dates = (market.get("trend") or {}).get("dates") or []
    benchmark_date = benchmark_dates[-1] if benchmark_dates else None
    if (
        fubon.get("schema_version") != 1
        or quote.get("symbol") != "0050"
        or quote.get("isClose") is not True
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", expected_date)
        or benchmark_date != expected_date
    ):
        raise ValueError("0050正式收盤與加權指數交易日未對齊")

    db = get_db()
    legacy = read_collection(db, "positions")
    master = load_futures_master(
        db,
        legacy,
        futures_cache=load_json_optional("data/futures_market.json"),
        expected_date=expected_date,
    )
    if master.get("market_date") != expected_date:
        raise ValueError("正式期貨主帳交易日未對齊")
    for p in master.get("positions") or []:
        if p.get("price_date") != expected_date:
            raise ValueError("期貨合約結算價日期未對齊")
    return master


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


def build_message(market, master):
    """正式帳戶逐合約損益；無效資料只告警，絕不改用 ^TWII 或舊部位。"""
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

    if master is None:
        lines.append("💰 我的期貨部位")
        lines.append("  ⚠️ 正式主帳／當日逐合約結算價待核對，暫不顯示口數及損益")
    else:
        positions = [
            p for p in (master.get("positions") or [])
            if float(p.get("lots") or 0) != 0
        ]
        if not positions:
            lines.append("💰 正式主帳目前無期貨部位")
        else:
            lines.append("💰 我的期貨部位（0050變速防守正式主帳）")
            total = 0
            expected_date = master.get("expected_price_date")
            for p in positions:
                product = p.get("product")
                kind = {"TX": "TXF", "MTX": "MXF", "TMF": "TMF"}.get(product)
                if not kind or kind not in CONTRACT_MULT:
                    raise ValueError("正式期貨主帳含未知商品")
                if not expected_date or p.get("price_date") != expected_date:
                    raise ValueError("正式逐合約估值日期不一致")
                entry = float(p["entry_price"])
                price = float(p["current_price"])
                lots = float(p["lots"])
                if not all(isfinite(n) for n in (entry, price, lots)):
                    raise ValueError("期貨價格或口數不是有限數字")
                if entry <= 0 or price <= 0:
                    raise ValueError("正式逐合約估值缺失")
                pnl = round((price - entry) * CONTRACT_MULT[kind] * lots)
                total += pnl
                tname = TYPE_NAME[kind]
                month = str(p.get("month") or "")
                prefix = "+" if pnl >= 0 else ""
                lines.append(
                    f"  {tname} {month} {lots:g}口 @{entry:,.0f} "
                    f"→ {price:,.0f}（{expected_date}）{prefix}{pnl:,}元"
                )
            prefix = "+" if total >= 0 else ""
            lines.append(f"期貨總未實現損益:{prefix}{total:,} 元")
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
        master = load_positions(market)
        msg = build_message(market, master)
    except (ValueError, KeyError, TypeError, OverflowError) as e:
        print("正式期貨帳務待核對:", type(e).__name__, file=sys.stderr)
        msg = build_message(market, None)
    except Exception as e:
        print("正式主帳讀取失敗:", type(e).__name__, file=sys.stderr)
        msg = build_message(market, None)

    # 策略訊號區塊只在策略實際觸發時附加。
    # 不再每天固定插入 0050 變速防守概要／理論口數。
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
    # 公開 GitHub Actions 日誌不得直接公開使用者的期貨持倉或損益明細。
    print("LINE 盤後訊息已建立（內文不寫入公開 Actions 日誌）")
    push_line(msg)
    print("✅ 推播完成")


if __name__ == "__main__":
    main()
