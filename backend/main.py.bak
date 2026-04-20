from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import urllib.request
import json
import random

app = FastAPI(title="台指期追蹤系統", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB = {
    "positions": [{"id":1,"date":"2025-04-18","type":"MXF","lots":3,"entry_price":37281,"note":"初始建倉—潛伏期情緒單","status":"open"}],
    "daily_logs": [],
    "price_overrides": {}
}

HARD_FLOOR = 35800
MICRO_POINT_VALUE = 50

def fetch_price():
    try:
        url = "https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=90d"
        headers = {"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36","Accept":"application/json","Accept-Language":"zh-TW,zh;q=0.9"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        closes_raw = result["indicators"]["quote"][0]["close"]
        timestamps = result["timestamp"]
        pairs = [(ts,c) for ts,c in zip(timestamps,closes_raw) if c is not None]
        dates = [datetime.fromtimestamp(ts).strftime("%Y-%m-%d") for ts,_ in pairs]
        closes = [c for _,c in pairs]
        price = closes[-1]
        ma5  = sum(closes[-5:])/min(5,len(closes))
        ma20 = sum(closes[-20:])/min(20,len(closes))
        ma60 = sum(closes[-60:])/min(60,len(closes))
        chart = [{"date":d,"close":round(c,0)} for d,c in zip(dates[-30:],closes[-30:])]
        return {"current_price":round(price,0),"ma5":round(ma5,0),"ma20":round(ma20,0),"ma60":round(ma60,0),"data_source":"Yahoo Finance (^TWII)","fetched_at":datetime.now().isoformat(),"chart_data":chart}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"報價抓取失敗：{str(e)}")

def classify(price,ma5,ma20,ma60):
    if price>ma5 and price>ma20 and price>ma60 and ma5>ma20:
        return {"state":"多頭排列","mode":"收割模式","leverage_min":1.5,"leverage_max":2.0,"color":"green","lots_suggest":"1小台+2微台"}
    elif price>ma5 and ma5>ma20:
        return {"state":"5日穿越月線","mode":"進攻模式","leverage_min":1.2,"leverage_max":1.5,"color":"lime","lots_suggest":"5~6口微台"}
    elif price>ma20:
        return {"state":"均線走平","mode":"觀察模式","leverage_min":0.8,"leverage_max":1.0,"color":"yellow","lots_suggest":"3~4口微台"}
    else:
        return {"state":"空頭排列","mode":"防禦模式","leverage_min":0.0,"leverage_max":0.6,"color":"red","lots_suggest":"2口微台或空手"}

def calc_pnl(pos,price):
    diff = price - pos["entry_price"]
    pnl = diff * MICRO_POINT_VALUE * pos["lots"]
    return {"pnl_twd":round(pnl,0),"pnl_pct":round((diff/pos["entry_price"])*100,2),"point_diff":round(diff,0),"distance_to_floor":round(price-HARD_FLOOR,0),"floor_alert":price<(HARD_FLOOR+300),"nuke_alert":price<=HARD_FLOOR}

@app.get("/api/dashboard")
def dashboard():
    market = fetch_price()
    price = market["current_price"]
    today = str(datetime.now().date())
    if today in DB["price_overrides"]:
        price = DB["price_overrides"][today]
        market["current_price"] = price
        market["overridden"] = True
    ma_state = classify(price,market["ma5"],market["ma20"],market["ma60"])
    positions = []
    total_pnl = 0
    for p in DB["positions"]:
        if p["status"]=="open":
            info = calc_pnl(p,price)
            total_pnl += info["pnl_twd"]
            positions.append({**p,**info})
    chart = market["chart_data"]
    candle = "green" if len(chart)>=2 and chart[-1]["close"]>=chart[-2]["close"] else "red"
    return {"market":market,"ma_state":ma_state,"positions":positions,"total_pnl_twd":round(total_pnl,0),"hard_floor":HARD_FLOOR,"adong_signal":{"candle":candle,"action":"今日收紅 → 留倉" if candle=="green" else "今日收黑 → 當日加碼單出清"},"checklist":{"below_ma5":price<market["ma5"],"near_floor":price<(HARD_FLOOR+300),"at_floor":price<=HARD_FLOOR}}

@app.get("/api/market")
def market(): return fetch_price()

@app.get("/api/positions")
def positions(): return DB["positions"]

class PositionCreate(BaseModel):
    date:str; type:str; lots:int; entry_price:float; note:Optional[str]=""

@app.post("/api/positions")
def add_position(pos:PositionCreate):
    new_id = max([p["id"] for p in DB["positions"]],default=0)+1
    new_pos = {"id":new_id,"status":"open",**pos.dict()}
    DB["positions"].append(new_pos)
    return new_pos

@app.delete("/api/positions/{pos_id}")
def close_position(pos_id:int):
    for p in DB["positions"]:
        if p["id"]==pos_id:
            p["status"]="closed"
            return {"message":"已平倉"}
    raise HTTPException(404,"找不到部位")

class PriceOverride(BaseModel):
    date:str; price:float

@app.post("/api/price-override")
def override(data:PriceOverride):
    DB["price_overrides"][data.date]=data.price
    return {"message":f"{data.date} 價格覆蓋為 {data.price}"}

class DailyLog(BaseModel):
    date:str; close_price:float; ma5:float; ma20:float; ma60:float; lots:int; note:Optional[str]=""

@app.post("/api/daily-log")
def add_log(log:DailyLog):
    DB["daily_logs"].append(log.dict())
    return {"message":"已儲存"}

@app.get("/api/daily-logs")
def get_logs(): return sorted(DB["daily_logs"],key=lambda x:x["date"],reverse=True)
