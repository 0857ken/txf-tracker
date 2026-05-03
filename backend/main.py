from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import urllib.request, json, os
from pydantic import BaseModel
from typing import Optional
import psycopg2
from psycopg2.extras import RealDictCursor


# ============ 期貨合約對照表 ============
CONTRACT_MULTIPLIER = {
    'TXF': 200, '大台': 200,
    'MXF': 50,  '小台': 50,
    'TMF': 10,  '微台': 10,
}

CONTRACT_MARGIN = {
    'TXF': 184000, '大台': 184000,
    'MXF': 46000,  '小台': 46000,
    'TMF': 11500,  '微台': 11500,
}

FUTURES_FEE = {
    'TXF': 60, '大台': 60,
    'MXF': 30, '小台': 30,
    'TMF': 15, '微台': 15,
}

FUTURES_TAX_RATE = 0.00002

def get_multiplier(t):
    return CONTRACT_MULTIPLIER.get(t, 10)

def get_margin(t):
    return CONTRACT_MARGIN.get(t, 11500)

def get_fee(t):
    return FUTURES_FEE.get(t, 15)

def calc_futures_pnl(entry_price, exit_price, lots, contract_type):
    """計算期貨淨損益（含手續費 + 期交稅）"""
    multiplier = get_multiplier(contract_type)
    fee = get_fee(contract_type)
    gross_pnl = (exit_price - entry_price) * multiplier * lots
    total_fee = fee * 2 * lots
    tax = (entry_price + exit_price) * multiplier * lots * FUTURES_TAX_RATE
    net_pnl = gross_pnl - total_fee - tax
    return {
        'gross_pnl': gross_pnl,
        'fee': total_fee,
        'tax': tax,
        'net_pnl': net_pnl
    }
# ========================================

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATABASE_URL = os.environ.get("DATABASE_URL")
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

def get_db():
    import time
    for i in range(5):
        try:
            return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        except Exception as e:
            if i == 4:
                raise
            time.sleep(2)

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            id SERIAL PRIMARY KEY,
            date TEXT,
            type TEXT,
            lots REAL,
            entry_price REAL,
            note TEXT,
            status VARCHAR(20) DEFAULT 'open'
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS price_overrides (
            date TEXT PRIMARY KEY,
            price REAL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stock_positions (
            id SERIAL PRIMARY KEY,
            symbol TEXT,
            name TEXT,
            shares REAL,
            cost_price REAL,
            alert_high REAL,
            alert_low REAL,
            status VARCHAR(20) DEFAULT 'active'
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fund_prices (
            stock_id INTEGER PRIMARY KEY,
            price REAL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS pnl_snapshots (
            id SERIAL PRIMARY KEY,
            date TEXT UNIQUE,
            close_price REAL,
            total_lots REAL,
            unrealized_pnl REAL,
            avg_cost REAL,
            dynamic_floor REAL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS realized_pnl (
            id SERIAL PRIMARY KEY,
            date TEXT,
            lots REAL,
            entry_price REAL,
            exit_price REAL,
            pnl_twd REAL,
            note TEXT
        )
    """)
    
    cur.execute("SELECT COUNT(*) AS cnt FROM positions")
    if cur.fetchone()['cnt'] == 0:
        cur.execute(
            "INSERT INTO positions (date, type, lots, entry_price, note, status) VALUES (%s, %s, %s, %s, %s, 'open')",
            ('2026-04-26', 'TMF', 3, 38627, '初始建倉')
        )
    
    # ============ 一次性遷移：MXF→TMF ============
    # 因為以前 MXF 是當微台用，現在改業界標準（MXF=小台、TMF=微台）
    # 把舊資料改成 TMF（微台）
    cur.execute("UPDATE positions SET type = 'TMF' WHERE type IN ('MXF', '微台') OR type IS NULL OR type = ''")
    
    # 加 fee 跟 tax 欄位
    cur.execute("ALTER TABLE realized_pnl ADD COLUMN IF NOT EXISTS fee REAL DEFAULT 0")
    cur.execute("ALTER TABLE realized_pnl ADD COLUMN IF NOT EXISTS tax REAL DEFAULT 0")
    # ============================================
    
    conn.commit()
    cur.close()
    conn.close()

init_db()

def send_telegram(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

def fetch_yahoo(symbol, range_param="90d"):
    """通用抓 Yahoo 報價"""
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={range_param}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        # 即時價格用 meta.regularMarketPrice 比較準
        meta_price = result.get("meta", {}).get("regularMarketPrice")
        closes = [c for c in result["indicators"]["quote"][0]["close"] if c]
        timestamps = result["timestamp"][-len(closes):]
        return {
            "current_price": meta_price or closes[-1],
            "closes": closes,
            "timestamps": timestamps
        }
    except Exception as e:
        print(f"Yahoo fetch failed for {symbol}: {e}")
        return None

def fetch_price():
    # 抓加權指數（現貨）
    twii = fetch_yahoo("%5ETWII")
    if not twii:
        return {}
    
    # 抓台指期（期貨）
    txf = fetch_yahoo("TXF=F", "5d")
    
    closes = twii["closes"]
    timestamps = twii["timestamps"]
    twii_price = twii["current_price"]
    
    # MA 計算（用加權指數）
    ma5 = sum(closes[-5:]) / min(5, len(closes))
    ma20 = sum(closes[-20:]) / min(20, len(closes))
    ma60 = sum(closes[-60:]) / min(60, len(closes))
    dates = [datetime.fromtimestamp(ts).strftime("%Y-%m-%d") for ts in timestamps]
    chart = [{"date": d, "close": round(c, 0)} for d, c in zip(dates[-30:], closes[-30:])]
    
    # 期現價差
    txf_price = txf["current_price"] if txf else None
    spread = round(txf_price - twii_price, 0) if txf_price else None
    
    return {
        "current_price": txf_price or twii_price,  # 主要顯示台指期，沒抓到 fallback 加權
        "twii_price": round(twii_price, 0),
        "txf_price": round(txf_price, 0) if txf_price else None,
        "spread": spread,
        "ma5": round(ma5, 0),
        "ma20": round(ma20, 0),
        "ma60": round(ma60, 0),
        "chart_data": chart
    }

@app.get("/api/dashboard")
def dashboard():
    market = fetch_price()
    
    # 校對價格邏輯
    now = datetime.now()
    today = str(now.date())
    target_date = today
    if now.hour < 9:
        target_date = str((now - timedelta(days=1)).date())
    
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT price FROM price_overrides WHERE date=%s", (target_date,))
    ov = cur.fetchone()
    overridden = False
    if ov:
        market["current_price"] = ov["price"]
        overridden = True
    
    cur.execute("SELECT * FROM positions WHERE status='open'")
    rows = cur.fetchall()
    open_positions = [dict(r) for r in rows]
    cur.close()
    conn.close()
    
    positions = []
    total_pnl = 0
    for p in open_positions:
        contract_type = p.get("type") or "TMF"
        multiplier = get_multiplier(contract_type)
        pnl = (market["current_price"] - p["entry_price"]) * multiplier * p["lots"]
        total_pnl += pnl
        positions.append({**p, "pnl_twd": round(pnl, 0)})
    
    avg_cost = sum(p["entry_price"]*p["lots"] for p in open_positions) / sum(p["lots"] for p in open_positions) if open_positions else 0
    hard_floor = round(avg_cost - 100, 0) if open_positions else 35800
    
    # Telegram 提醒
    dist = market["current_price"] - hard_floor
    if 0 < dist <= 300:
        send_telegram(f"⚠️ 台指期警戒！現價 {market['current_price']}，距硬底線 {hard_floor} 僅剩 {round(dist,0)} 點！")
    if market["current_price"] <= hard_floor:
        send_telegram(f"🚨 緊急！跌破硬底線！現價 {market['current_price']} ≤ {hard_floor}")
    
    return {
        "market": {
            **market,
            "twii_price": round(market["current_price"], 0),
            "txf_price": round(market["current_price"], 0),
            "spread": 0,
            "spread_type": "正價差",
            "data_source": "Yahoo Finance",
            "fetched_at": datetime.now().isoformat(),
            "overridden": overridden
        },
        "ma_state": {
            "state": "多頭排列" if market["current_price"] > market["ma5"] else "空頭排列",
            "mode": "收割" if market["current_price"] > market["ma5"] else "防禦",
            "color": "green" if market["current_price"] > market["ma5"] else "red"
        },
        "positions": positions,
        "total_pnl_twd": round(total_pnl, 0),
        "hard_floor": hard_floor,
        "avg_cost": round(avg_cost, 0),
        "checklist": {}
    }

class PositionCreate(BaseModel):
    date: str
    type: str
    lots: float
    entry_price: float
    note: Optional[str] = ""

@app.post("/api/positions")
def add_position(pos: PositionCreate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO positions (date, type, lots, entry_price, note, status) VALUES (%s, %s, %s, %s, %s, 'open') RETURNING *",
        (pos.date, pos.type, pos.lots, pos.entry_price, pos.note)
    )
    row = dict(cur.fetchone())
    conn.commit()
    cur.close()
    conn.close()
    return row

@app.get("/api/positions")
def get_positions():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM positions")
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.patch("/api/positions/{pos_id}")
def update_position(pos_id: int, data: dict):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE positions SET lots=%s, entry_price=%s WHERE id=%s",
        (data.get('lots'), data.get('entry_price'), pos_id)
    )
    conn.commit()
    cur.execute("SELECT * FROM positions WHERE id=%s", (pos_id,))
    row = dict(cur.fetchone())
    cur.close()
    conn.close()
    return row

@app.delete("/api/positions/{pos_id}")
def delete_position(pos_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE positions SET status='closed' WHERE id=%s", (pos_id,))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已平倉"}

@app.post("/api/price-override")
def override_price(data: dict):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO price_overrides (date, price) VALUES (%s, %s) ON CONFLICT (date) DO UPDATE SET price=EXCLUDED.price",
        (data.get('date'), data.get('price'))
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"message": f"已覆蓋 {data.get('date')} 為 {data.get('price')}"}

# ─────────── 股票 ───────────
def fetch_twse_price(symbol):
    """證交所即時報價（盤中 09:00-13:30 才有資料）"""
    try:
        if not (symbol.isdigit() and len(symbol) == 4):
            return None
        now = datetime.now()
        tw_hour = (now.hour + 8) % 24
        is_trading_hour = (now.weekday() < 5 and 
                          (9 <= tw_hour <= 12 or (tw_hour == 13 and now.minute < 30)))
        if not is_trading_hour:
            return None
        url = f"https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_{symbol}.tw&json=1&delay=0"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://mis.twse.com.tw/stock/fibest.jsp"
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        if data.get("msgArray"):
            stock = data["msgArray"][0]
            price = stock.get("z") or stock.get("y")
            name = stock.get("n", symbol)
            if price and price != "-":
                return {"price": round(float(price), 2), "name": name}
        return None
    except Exception as e:
        print(f"TWSE failed for {symbol}: {e}")
        return None

def fetch_stock_price(symbol):
    if symbol.startswith("FUND:"):
        return {"price": None, "name": symbol.replace("FUND:", "")}
    
    # 1. 先試證交所
    twse_result = fetch_twse_price(symbol)
    if twse_result:
        return twse_result
    
    # 2. fallback Yahoo
    try:
        tw_symbol = symbol + ".TW" if not symbol.endswith(".TW") else symbol
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{tw_symbol}?interval=1d&range=5d"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
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
    cur = conn.cursor()
    cur.execute("SELECT * FROM stock_positions WHERE status='active'")
    rows = [dict(r) for r in cur.fetchall()]
    
    results = []
    for s in rows:
        info = fetch_stock_price(s["symbol"])
        price = info["price"]
        # 基金讀取手動淨值
        if s["symbol"].startswith("FUND:"):
            cur.execute("SELECT price FROM fund_prices WHERE stock_id=%s", (s["id"],))
            fp = cur.fetchone()
            if fp:
                price = fp["price"]
        
        pnl = round((price - s["cost_price"]) * s["shares"], 0) if price else None
        pnl_pct = round((price - s["cost_price"]) / s["cost_price"] * 100, 2) if price else None
        
        if price:
            if s["alert_high"] and price >= s["alert_high"]:
                send_telegram(f"🚀 {s['symbol']} 突破！現價 {price}")
            if s["alert_low"] and price <= s["alert_low"]:
                send_telegram(f"⚠️ {s['symbol']} 跌破！現價 {price}")
        
        results.append({**s, "current_price": price, "name": info["name"], "pnl_twd": pnl, "pnl_pct": pnl_pct})
    
    cur.close()
    conn.close()
    return results

class StockCreate(BaseModel):
    symbol: str
    shares: float
    cost_price: float
    alert_high: Optional[float] = None
    alert_low: Optional[float] = None

@app.post("/api/stocks")
def add_stock(s: StockCreate):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO stock_positions (symbol, name, shares, cost_price, alert_high, alert_low, status) VALUES (%s, %s, %s, %s, %s, %s, 'active') RETURNING *",
        (s.symbol.upper(), s.symbol, s.shares, s.cost_price, s.alert_high, s.alert_low)
    )
    row = dict(cur.fetchone())
    conn.commit()
    cur.close()
    conn.close()
    return row

@app.delete("/api/stocks/{stock_id}")
def delete_stock(stock_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE stock_positions SET status='deleted' WHERE id=%s", (stock_id,))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已刪除"}

@app.put("/api/stocks/{stock_id}/price")
def update_stock_price(stock_id: int, data: dict):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO fund_prices (stock_id, price) VALUES (%s, %s) ON CONFLICT (stock_id) DO UPDATE SET price=EXCLUDED.price",
        (stock_id, data.get('price'))
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已更新淨值"}

@app.get("/api/snapshots")
def get_snapshots():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM pnl_snapshots ORDER BY date ASC")
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

class PartialClose(BaseModel):
    lots: float
    exit_price: float
    note: Optional[str] = ""

@app.post("/api/positions/{pos_id}/close")
def close_position(pos_id: int, data: PartialClose):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM positions WHERE id=%s", (pos_id,))
    pos = cur.fetchone()
    if not pos:
        cur.close()
        conn.close()
        raise HTTPException(404, "找不到部位")
    pos = dict(pos)
    remaining = pos["lots"] - data.lots
    contract_type = pos.get("type") or "TMF"
    pnl_result = calc_futures_pnl(
        entry_price=pos["entry_price"],
        exit_price=data.exit_price,
        lots=data.lots,
        contract_type=contract_type
    )
    pnl = pnl_result["net_pnl"]
    fee = pnl_result["fee"]
    tax = pnl_result["tax"]
    cur.execute(
        "INSERT INTO realized_pnl (date, lots, entry_price, exit_price, pnl_twd, fee, tax, note) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (str(datetime.now().date()), data.lots, pos["entry_price"], data.exit_price, round(pnl, 0), round(fee, 0), round(tax, 0), pos["type"] + " " + (data.note or ""))
    )
    if remaining <= 0:
        cur.execute("UPDATE positions SET status='closed' WHERE id=%s", (pos_id,))
    else:
        cur.execute("UPDATE positions SET lots=%s WHERE id=%s", (remaining, pos_id))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": f"已結算 {data.lots} 口，損益 {round(pnl, 0)} 元"}

@app.put("/api/stocks/{stock_id}")
def update_stock(stock_id: int, data: dict):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE stock_positions SET shares=%s, cost_price=%s, alert_high=%s, alert_low=%s WHERE id=%s",
        (data.get('shares'), data.get('cost_price'), data.get('alert_high'), data.get('alert_low'), stock_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已更新"}

class StockSell(BaseModel):
    shares: float
    exit_price: float
    note: Optional[str] = ""

@app.post("/api/stocks/{stock_id}/sell")
def sell_stock(stock_id: int, data: StockSell):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM stock_positions WHERE id=%s", (stock_id,))
    s = cur.fetchone()
    if not s:
        cur.close()
        conn.close()
        raise HTTPException(404, "找不到")
    s = dict(s)
    remaining = s["shares"] - data.shares
    pnl = (data.exit_price - s["cost_price"]) * data.shares
    cur.execute(
        "INSERT INTO realized_pnl (date, lots, entry_price, exit_price, pnl_twd, fee, tax, note) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (str(datetime.now().date()), data.shares, s["cost_price"], data.exit_price, round(pnl, 0), 0, 0, s["symbol"] + " " + (data.note or ""))
    )
    if remaining <= 0:
        cur.execute("UPDATE stock_positions SET status='deleted' WHERE id=%s", (stock_id,))
    else:
        cur.execute("UPDATE stock_positions SET shares=%s WHERE id=%s", (remaining, stock_id))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": f"已結算 {data.shares}，損益 {round(pnl, 0)} 元"}

@app.get("/api/realized-pnl")
def get_realized_pnl():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM realized_pnl ORDER BY date DESC, id DESC")
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows
