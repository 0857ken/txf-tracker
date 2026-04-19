from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import json

app = FastAPI(title="台指期追蹤系統", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 資料儲存（正式版請換成 PostgreSQL） ──────────────────────────────────────
DB = {
    "positions": [
        {
            "id": 1,
            "date": "2025-04-18",
            "type": "MXF",          # MXF=微台 TXF=小台
            "lots": 3,
            "entry_price": 37281,
            "note": "初始建倉 — 潛伏期情緒單",
            "status": "open"
        }
    ],
    "daily_logs": [],               # 每日均線日誌
    "price_overrides": {}           # 人工校對價格 {date: price}
}

HARD_FLOOR = 35800                 # 絕對撤退牆
MICRO_POINT_VALUE = 50             # 微台每點 50 元
MINI_POINT_VALUE  = 200            # 小台每點 200 元

# ── 均線狀態判斷 ─────────────────────────────────────────────────────────────
def classify_ma_state(price: float, ma5: float, ma20: float, ma60: float) -> dict:
    """根據均線排列判斷戰略狀態"""
    above_ma5  = price > ma5
    above_ma20 = price > ma20
    above_ma60 = price > ma60
    ma5_above_ma20 = ma5 > ma20

    if above_ma5 and above_ma20 and above_ma60 and ma5_above_ma20:
        return {
            "state": "多頭排列",
            "mode": "收割模式",
            "leverage_min": 1.5,
            "leverage_max": 2.0,
            "color": "green",
            "lots_suggest": "1小台 + 2微台"
        }
    elif above_ma5 and ma5_above_ma20:
        return {
            "state": "5日穿越月線",
            "mode": "進攻模式",
            "leverage_min": 1.2,
            "leverage_max": 1.5,
            "color": "lime",
            "lots_suggest": "5~6口微台"
        }
    elif above_ma20 or (above_ma5 and not ma5_above_ma20):
        return {
            "state": "均線走平",
            "mode": "觀察模式",
            "leverage_min": 0.8,
            "leverage_max": 1.0,
            "color": "yellow",
            "lots_suggest": "3~4口微台"
        }
    else:
        return {
            "state": "空頭排列",
            "mode": "防禦模式",
            "leverage_min": 0.0,
            "leverage_max": 0.6,
            "color": "red",
            "lots_suggest": "2口微台或空手"
        }

# ── 取得台指期報價 ────────────────────────────────────────────────────────────
def fetch_taiwan_futures_data():
    """從 Yahoo Finance 抓台指期歷史資料"""
    try:
        # TX00.TW = 台指期近月，FITX = 期交所代號
        ticker = yf.Ticker("^TWII")   # 先用加權指數作為代理
        hist = ticker.history(period="90d", interval="1d")

        if hist.empty:
            raise ValueError("無法取得資料")

        closes = hist["Close"].dropna()
        current_price = float(closes.iloc[-1])

        ma5  = float(closes.tail(5).mean())
        ma20 = float(closes.tail(20).mean())
        ma60 = float(closes.tail(60).mean()) if len(closes) >= 60 else float(closes.mean())

        # 近 30 天收盤價供圖表使用
        chart_data = [
            {"date": str(d.date()), "close": round(float(p), 0)}
            for d, p in zip(closes.tail(30).index, closes.tail(30))
        ]

        return {
            "current_price": round(current_price, 0),
            "ma5":  round(ma5, 0),
            "ma20": round(ma20, 0),
            "ma60": round(ma60, 0),
            "data_source": "Yahoo Finance (^TWII)",
            "fetched_at": datetime.now().isoformat(),
            "chart_data": chart_data
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"報價抓取失敗：{str(e)}")

# ── 計算損益 ──────────────────────────────────────────────────────────────────
def calc_pnl(position: dict, current_price: float) -> dict:
    point_value = MICRO_POINT_VALUE if position["type"] == "MXF" else MINI_POINT_VALUE
    diff = current_price - position["entry_price"]
    pnl  = diff * point_value * position["lots"]
    pnl_pct = (diff / position["entry_price"]) * 100
    distance_to_floor = current_price - HARD_FLOOR
    floor_alert = current_price < (HARD_FLOOR + 300)  # 距底線 300 點內警告

    return {
        "pnl_twd": round(pnl, 0),
        "pnl_pct": round(pnl_pct, 2),
        "point_diff": round(diff, 0),
        "distance_to_floor": round(distance_to_floor, 0),
        "floor_alert": floor_alert,
        "nuke_alert": current_price <= HARD_FLOOR
    }

# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
def get_dashboard():
    """主儀表板：報價 + 均線狀態 + 損益 + 建議"""
    market = fetch_taiwan_futures_data()
    price  = market["current_price"]

    # 人工校對覆蓋
    today_str = str(datetime.now().date())
    if today_str in DB["price_overrides"]:
        price = DB["price_overrides"][today_str]
        market["current_price"] = price
        market["overridden"] = True

    ma_state = classify_ma_state(price, market["ma5"], market["ma20"], market["ma60"])

    positions_detail = []
    total_pnl = 0
    for pos in DB["positions"]:
        if pos["status"] == "open":
            pnl_info = calc_pnl(pos, price)
            total_pnl += pnl_info["pnl_twd"]
            positions_detail.append({**pos, **pnl_info})

    # 阿東式訊號：今天是否為紅K？
    chart = market["chart_data"]
    today_candle = "red"
    if len(chart) >= 2:
        yesterday = chart[-2]["close"]
        today_c   = chart[-1]["close"]
        today_candle = "green" if today_c >= yesterday else "red"

    adong_signal = {
        "candle": today_candle,
        "action": "今日收紅 → 留倉" if today_candle == "green" else "今日收黑 → 當日加碼單出清",
        "description": "阿東式加碼判斷"
    }

    return {
        "market": market,
        "ma_state": ma_state,
        "positions": positions_detail,
        "total_pnl_twd": round(total_pnl, 0),
        "hard_floor": HARD_FLOOR,
        "adong_signal": adong_signal,
        "checklist": {
            "below_ma5": price < market["ma5"],
            "near_floor": price < (HARD_FLOOR + 300),
            "at_floor": price <= HARD_FLOOR
        }
    }

@app.get("/api/market")
def get_market():
    return fetch_taiwan_futures_data()

@app.get("/api/positions")
def get_positions():
    return DB["positions"]

class PositionCreate(BaseModel):
    date: str
    type: str          # MXF or TXF
    lots: int
    entry_price: float
    note: Optional[str] = ""

@app.post("/api/positions")
def add_position(pos: PositionCreate):
    new_id = max([p["id"] for p in DB["positions"]], default=0) + 1
    new_pos = {
        "id": new_id,
        "status": "open",
        **pos.dict()
    }
    DB["positions"].append(new_pos)
    return new_pos

@app.delete("/api/positions/{pos_id}")
def close_position(pos_id: int):
    for pos in DB["positions"]:
        if pos["id"] == pos_id:
            pos["status"] = "closed"
            return {"message": "部位已平倉"}
    raise HTTPException(status_code=404, detail="找不到部位")

class PriceOverride(BaseModel):
    date: str
    price: float

@app.post("/api/price-override")
def set_price_override(data: PriceOverride):
    """人工校對價格"""
    DB["price_overrides"][data.date] = data.price
    return {"message": f"{data.date} 價格已手動設為 {data.price}"}

class DailyLog(BaseModel):
    date: str
    close_price: float
    ma5: float
    ma20: float
    ma60: float
    lots: int
    note: Optional[str] = ""

@app.post("/api/daily-log")
def add_daily_log(log: DailyLog):
    DB["daily_logs"].append(log.dict())
    return {"message": "日誌已儲存"}

@app.get("/api/daily-logs")
def get_daily_logs():
    return sorted(DB["daily_logs"], key=lambda x: x["date"], reverse=True)
