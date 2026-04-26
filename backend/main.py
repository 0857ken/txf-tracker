from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import urllib.request
import json
import sqlite3
import os

app = FastAPI(title="台指期追蹤系統", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH = os.environ.get("DB_PATH", "txf.db")
HARD_FLOOR = 35800
MICRO_POINT_VALUE = 10
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT, type TEXT, lots INTEGER,
            entry_price REAL, note TEXT, status TEXT DEFAULT 'open'
        );
        CREATE TABLE IF NOT EXISTS daily_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT, close_price REAL, ma5 REAL, ma20 REAL,
            ma60 REAL, lots INTEGER, note TEXT
        );
        CREATE TABLE IF NOT EXISTS price_overrides (
            date TEXT PRIMARY KEY, price REAL
        );
        CREATE TABLE IF NOT EXISTS pnl_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE, close_price REAL,
            total_lots INTEGER, unrealized_pnl REAL,
            avg_cost REAL, dynamic_floor REAL
        );
        CREATE TABLE IF NOT EXISTS realized_pnl (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT, lots INTEGER, entry_price REAL,
            exit_price REAL, pnl_twd REAL, note TEXT
        );
    """)
    cur = conn.execute("SELECT COUNT(*) FROM positions")
    if cur.fetchone()[0] == 0:
        conn.execute("INSERT INTO positions (date,type,lots,entry_price,note,status) VALUES ('2025-04-18','MXF',3,37281,'初始建倉','open')")
    conn.commit()
    conn.close()

init_db()

def send_telegram(msg: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

def fetch_price():
    try:
        def fetch_yahoo(symbol):
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=90d"
            headers = {"User-Agent": "Mozilla/5.0"}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())

        twii_data = fetch_yahoo("%5ETWII")
        twii_result = twii_data["chart"]["result"][0]
        closes_raw = twii_result["indicators"]["quote"][0]["close"]
        timestamps = twii_result["timestamp"]
        pairs = [(ts,c) for ts,c in zip(timestamps,closes_raw) if c is not None]
        dates = [datetime.fromtimestamp(ts).strftime("%Y-%m-%d") for ts,_ in pairs]
        closes = [c for _,c in pairs]
        twii_price = closes[-1]
        ma5 = sum(closes[-5:]) / min(5, len(closes))
        ma20 = sum(closes[-20:]) / min(20, len(closes))
        ma60 = sum(closes[-60:]) / min(60, len(closes))
        chart = [{"date": d, "close": round(c, 0)} for d, c in zip(dates[-30:], closes[-30:])]

        try:
            txf_data = fetch_yahoo("TW%3DF")
            txf_result = txf_data["chart"]["result"][0]
            txf_closes = txf_result["indicators"]["quote"][0]["close"]
            txf_price = round([c for c in txf_closes if c is not None][-1], 0)
        except:
            txf_price = round(twii_price, 0)

        spread = round(txf_price - twii_price, 0)

        return {
            "current_price": txf_price,
            "twii_price": round(twii_price, 0),
            "txf_price": txf_price,
            "spread": spread,
            "spread_type": "正價差" if spread >= 0 else "逆價差",
            "ma5": round(ma5, 0),
            "ma20": round(ma20, 0),
            "ma60": round(ma60, 0),
            "data_source": "Yahoo Finance",
            "fetched_at": datetime.now().isoformat(),
            "chart_data": chart,
            "overridden": False
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"報價失敗: {str(e)}")

def classify(price, ma5, ma20, ma60):
    if price > ma5 and price > ma20 and price > ma60 and ma5 > ma20:
        return {"state": "多頭排列", "mode": "收割", "color": "green"}
    elif price > ma5 and ma5 > ma20:
        return {"state": "5日穿越", "mode": "進攻", "color": "lime"}
    elif price > ma20:
        return {"state": "均線走平", "mode": "觀察", "color": "yellow"}
    else:
        return {"state": "空頭排列", "mode": "防禦", "color": "red"}

def calc_pnl(pos, price):
    diff = price - pos["entry_price"]
    pnl = diff * MICRO_POINT_VALUE * pos["lots"]
    return {"pnl_twd": round(pnl, 0), "point_diff": round(diff, 0)}

@app.get("/api/dashboard")
def dashboard():
    market = fetch_price()
    price = market["current_price"]
    today = str(datetime.now().date())
    conn = get_db()
    ov = conn.execute("SELECT price FROM price_overrides WHERE date=?", (today,)).fetchone()
    if ov:
        price = ov["price"]
        market["current_price"] = price
        market["overridden"] = True
    rows = conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()
    open_positions = [dict(r) for r in rows]
    conn.close()

    if open_positions:
        total_lots = sum(p["lots"] for p in open_positions)
        avg_cost = sum(p["entry_price"] * p["lots"] for p in open_positions) / total_lots
        dynamic_floor = round(avg_cost - 100, 0)
    else:
        avg_cost = 0
        dynamic_floor = HARD_FLOOR

    ma_state = classify(price, market["ma5"], market["ma20"], market["ma60"])
    positions = []
    total_pnl = 0
    for p in open_positions:
        info = calc_pnl(p, price)
        total_pnl += info["pnl_twd"]
        positions.append({**p, **info})

    chart = market["chart_data"]
    candle = "green" if len(chart) >= 2 and chart[-1]["close"] >= chart[-2]["close"] else "red"

    dist = price - dynamic_floor
    if 0 < dist <= 300:
        send_telegram(f"⚠️ 台指期警戒！現價 {price}，距硬底線 {dynamic_floor} 僅剩 {round(dist, 0)} 點！")
    if price <= dynamic_floor:
        send_telegram(f"🚨 緊急！台指期跌破硬底線！現價 {price} ≤ {dynamic_floor}")

    return {
        "market": market,
        "ma_state": ma_state,
        "positions": positions,
        "total_pnl_twd": round(total_pnl, 0),
        "hard_floor": dynamic_floor,
        "avg_cost": round(avg_cost, 0),
        "checklist": {"below_ma5": price < market["ma5"], "near_floor": 0 < (price - dynamic_floor) <= 300, "at_floor": price <= dynamic_floor}
    }

@app.get("/api/positions")
def get_positions():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM positions").fetchall()]
    conn.close()
    return rows

class PositionCreate(BaseModel):
    date: str
    type: str
    lots: int
    entry_price: float
    note: Optional[str] = ""

@app.post("/api/positions")
def add_position(pos: PositionCreate):
    conn = get_db()
    cur = conn.execute("INSERT INTO positions (date,type,lots,entry_price,note,status) VALUES (?,?,?,?,?,'open')",
        (pos.date, pos.type, pos.lots, pos.entry_price, pos.note))
    conn.commit()
    row = dict(conn.execute("SELECT * FROM positions WHERE id=?", (cur.lastrowid,)).fetchone())
    conn.close()
    return row

class PartialClose(BaseModel):
    lots: int
    exit_price: float
    note: Optional[str] = ""

@app.post("/api/positions/{pos_id}/close")
def close_position(pos_id: int, data: PartialClose):
    conn = get_db()
    pos = conn.execute("SELECT * FROM positions WHERE id=?", (pos_id,)).fetchone()
    if not pos:
        raise HTTPException(404, "找不到部位")
    pos = dict(pos)
    remaining = pos["lots"] - data.lots
    pnl = (data.exit_price - pos["entry_price"]) * MICRO_POINT_VALUE * data.lots
    conn.execute("INSERT INTO realized_pnl (date,lots,entry_price,exit_price,pnl_twd,note) VALUES (?,?,?,?,?,?)",
        (str(datetime.now().date()), data.lots, pos["entry_price"], data.exit_price, round(pnl, 0), data.note))
    if remaining <= 0:
        conn.execute("UPDATE positions SET status='closed' WHERE id=?", (pos_id,))
    else:
        conn.execute("UPDATE positions SET lots=? WHERE id=?", (remaining, pos_id))
    conn.commit()
    conn.close()
    return {"message": f"已平倉 {data.lots} 口，剩餘 {max(remaining, 0)} 口，損益 {round(pnl, 0)} 元"}

@app.delete("/api/positions/{pos_id}")
def delete_position(pos_id: int):
    conn = get_db()
    conn.execute("UPDATE positions SET status='closed' WHERE id=?", (pos_id,))
    conn.commit()
    conn.close()
    return {"message": "已平倉"}

@app.post("/api/price-override")
def override_price(date: str, price: float):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO price_overrides (date,price) VALUES (?,?)", (date, price))
    conn.commit()
    conn.close()
    return {"message": f"已覆蓋 {date} 的價格為 {price}"}

@app.post("/api/snapshot")
def save_snapshot():
    market = fetch_price()
    price = market["current_price"]
    conn = get_db()
    rows = conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()
    open_positions = [dict(r) for r in rows]
    total_lots = sum(p["lots"] for p in open_positions) if open_positions else 0
    avg_cost = sum(p["entry_price"] * p["lots"] for p in open_positions) / total_lots if open_positions else 0
    dynamic_floor = round(avg_cost - 100, 0) if open_positions else HARD_FLOOR
    total_pnl = sum((price - p["entry_price"]) * MICRO_POINT_VALUE * p["lots"] for p in open_positions)
    today = str(datetime.now().date())
    conn.execute("INSERT OR REPLACE INTO pnl_snapshots (date,close_price,total_lots,unrealized_pnl,avg_cost,dynamic_floor) VALUES (?,?,?,?,?,?)",
        (today, price, total_lots, round(total_pnl, 0), round(avg_cost, 0), dynamic_floor))
    conn.commit()
    conn.close()
    return {"message": "快照已儲存", "date": today, "pnl": round(total_pnl, 0)}

@app.get("/api/snapshots")
def get_snapshots():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM pnl_snapshots ORDER BY date ASC").fetchall()]
    conn.close()
    return rows

@app.get("/api/realized-pnl")
def get_realized_pnl():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM realized_pnl ORDER BY date DESC").fetchall()]
    conn.close()
    return rows

def init_stock_db():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS stock_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT, name TEXT, shares INTEGER,
        cost_price REAL, alert_high REAL, alert_low REAL,
        status TEXT DEFAULT 'active'
    )""")
    conn.commit()
    conn.close()

init_stock_db()

def fetch_stock_price(symbol: str):
    try:
        tw_symbol = symbol + ".TW" if not symbol.endswith(".TW") else symbol
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{tw_symbol}?interval=1d&range=5d"
        headers = {"User-Agent": "Mozilla/5.0"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        meta = result["meta"]
        price = meta.get("regularMarketPrice")
        name = meta.get("longName") or symbol
        return {"price": round(price, 2) if price else None, "name": name}
    except:
        return {"price": None, "name": symbol}

@app.get("/api/stocks")
def get_stocks():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM stock_positions WHERE status='active'").fetchall()]
    conn.close()
    results = []
    for s in rows:
        info = fetch_stock_price(s["symbol"])
        price = info["price"]
        pnl = round((price - s["cost_price"]) * s["shares"], 0) if price else None
        pnl_pct = round((price - s["cost_price"]) / s["cost_price"] * 100, 2) if price else None
        if price:
            if s["alert_high"] and price >= s["alert_high"]:
                send_telegram(f"🚀 {s['symbol']} 突破！現價 {price}")
            if s["alert_low"] and price <= s["alert_low"]:
                send_telegram(f"⚠️ {s['symbol']} 跌破！現價 {price}")
        results.append({**s, "current_price": price, "name": info["name"], "pnl_twd": pnl, "pnl_pct": pnl_pct})
    return results

class StockCreate(BaseModel):
    symbol: str
    shares: int
    cost_price: float
    alert_high: Optional[float] = None
    alert_low: Optional[float] = None

@app.post("/api/stocks")
def add_stock(s: StockCreate):
    conn = get_db()
    cur = conn.execute("INSERT INTO stock_positions (symbol,name,shares,cost_price,alert_high,alert_low,status) VALUES (?,?,?,?,?,?,'active')",
        (s.symbol.upper(), s.symbol, s.shares, s.cost_price, s.alert_high, s.alert_low))
    conn.commit()
    row = dict(conn.execute("SELECT * FROM stock_positions WHERE id=?", (cur.lastrowid,)).fetchone())
    conn.close()
    return row

@app.delete("/api/stocks/{stock_id}")
def delete_stock(stock_id: int):
    conn = get_db()
    conn.execute("UPDATE stock_positions SET status='deleted' WHERE id=?", (stock_id,))
    conn.commit()
    conn.close()
    return {"message": "已刪除"}

@app.put("/api/stocks/{stock_id}/alert")
def update_stock_alert(stock_id: int, alert_high: Optional[float] = None, alert_low: Optional[float] = None):
    conn = get_db()
    conn.execute("UPDATE stock_positions SET alert_high=?, alert_low=? WHERE id=?", (alert_high, alert_low, stock_id))
    conn.commit()
    conn.close()
    return {"message": "提醒已更新"}
