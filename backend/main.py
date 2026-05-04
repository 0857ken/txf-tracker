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
    'TXF': 540000, '大台': 540000,
    'MXF': 135000, '小台': 135000,
    'TMF': 30000,  '微台': 30000,
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
    
    # 擴充 pnl_snapshots 變成 Equity Curve
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS total_equity REAL")
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS cash REAL")
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS stock_value REAL")
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS realized_today REAL DEFAULT 0")
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS futures_unrealized REAL")
    cur.execute("ALTER TABLE pnl_snapshots ADD COLUMN IF NOT EXISTS stock_unrealized REAL")
    
    # 通知記錄表（含冷卻判斷用）
    cur.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            alert_key TEXT NOT NULL,
            alert_type TEXT,
            symbol TEXT,
            message TEXT,
            sent_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_alert_key_time ON notifications(alert_key, sent_at DESC)")
    
    # stock_positions 加上 notify_enabled 欄位
    cur.execute("ALTER TABLE stock_positions ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN DEFAULT TRUE")
    # ============================================
    
    conn.commit()
    cur.close()
    conn.close()

init_db()

# 全域通知開關（環境變數控制）
NOTIFICATIONS_ENABLED = os.environ.get('NOTIFICATIONS_ENABLED', 'true').lower() != 'false'

# 冷卻時間（分鐘）
ALERT_COOLDOWN_MINUTES = 10

def send_telegram(msg, alert_key=None, alert_type=None, symbol=None):
    """
    發送 Telegram 通知（含冷卻邏輯）
    alert_key: 唯一識別這個警戒（例如 'txf_floor_break'、'stock_2330_high'）
    冷卻：同一 alert_key 在 ALERT_COOLDOWN_MINUTES 內不重發
    """
    # 全域開關
    if not NOTIFICATIONS_ENABLED:
        return False
    
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    
    # 冷卻判斷
    if alert_key:
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                SELECT sent_at FROM notifications 
                WHERE alert_key=%s 
                ORDER BY sent_at DESC LIMIT 1
            """, (alert_key,))
            last = cur.fetchone()
            cur.close()
            conn.close()
            
            if last:
                from datetime import datetime, timedelta
                last_time = last['sent_at'] if isinstance(last['sent_at'], datetime) else datetime.fromisoformat(str(last['sent_at']))
                # 確保 timezone aware 比較
                if last_time.tzinfo is None:
                    cutoff = datetime.now() - timedelta(minutes=ALERT_COOLDOWN_MINUTES)
                else:
                    from datetime import timezone
                    cutoff = datetime.now(timezone.utc) - timedelta(minutes=ALERT_COOLDOWN_MINUTES)
                if last_time > cutoff:
                    return False  # 冷卻中
        except Exception as e:
            print(f"冷卻檢查失敗: {e}")
    
    # 發送 Telegram
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        
        # 記錄到資料庫
        if alert_key:
            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO notifications (alert_key, alert_type, symbol, message)
                    VALUES (%s, %s, %s, %s)
                """, (alert_key, alert_type, symbol, msg))
                conn.commit()
                cur.close()
                conn.close()
            except Exception as e:
                print(f"通知記錄失敗: {e}")
        
        return True
    except Exception as e:
        print(f"Telegram 失敗: {e}")
        return False

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
    
    # ============ Telegram 警戒系統 ============
    cp = market["current_price"]
    today_str = str(datetime.now().date())
    site_url = "https://ken0857888.github.io/txf-tracker/"
    
    # 1. 硬底線警戒
    dist = cp - hard_floor
    total_pnl_str = f"\n💰 未實現損益：{round(total_pnl):+,} 元" if total_pnl else ""
    
    if 0 < dist <= 300:
        send_telegram(
            f"⚠️ <b>台指期接近硬底線</b>\n"
            f"現價：{cp:,.0f}\n"
            f"硬底線：{hard_floor:,.0f}\n"
            f"距離：僅剩 {round(dist):,} 點"
            f"{total_pnl_str}\n"
            f"💡 建議：注意減倉或停損\n"
            f"🔗 {site_url}",
            alert_key=f"txf_near_floor_{today_str}",
            alert_type="floor_warning"
        )
    
    if cp <= hard_floor:
        send_telegram(
            f"🚨 <b>跌破硬底線！</b>\n"
            f"現價：{cp:,.0f}\n"
            f"硬底線：{hard_floor:,.0f}"
            f"{total_pnl_str}\n"
            f"💡 建議：立即停損出場\n"
            f"🔗 {site_url}",
            alert_key=f"txf_floor_break_{today_str}",
            alert_type="floor_break"
        )
    
    # 2. 均線跨越警戒（±1%）
    for ma_name, ma_value in [("5日線", market.get("ma5")), ("20日線", market.get("ma20")), ("60日線", market.get("ma60"))]:
        if not ma_value or ma_value == 0:
            continue
        diff_pct = (cp - ma_value) / ma_value * 100
        # ±1% 範圍內視為「跨越中」
        if 0 < diff_pct < 1:
            send_telegram(
                f"📈 <b>台指期突破{ma_name}</b>\n"
                f"現價：{cp:,.0f}\n"
                f"{ma_name}：{ma_value:,.0f}\n"
                f"乖離：+{diff_pct:.2f}%"
                f"{total_pnl_str}\n"
                f"💡 建議：留意是否站穩\n"
                f"🔗 {site_url}",
                alert_key=f"txf_break_{ma_name}_{today_str}",
                alert_type="ma_break_up"
            )
        elif -1 < diff_pct < 0:
            send_telegram(
                f"📉 <b>台指期跌破{ma_name}</b>\n"
                f"現價：{cp:,.0f}\n"
                f"{ma_name}：{ma_value:,.0f}\n"
                f"乖離：{diff_pct:.2f}%"
                f"{total_pnl_str}\n"
                f"💡 建議：注意是否反彈或續跌\n"
                f"🔗 {site_url}",
                alert_key=f"txf_break_below_{ma_name}_{today_str}",
                alert_type="ma_break_down"
            )
    
    # 3. 大幅波動警戒（單日 ±7%）
    chart = market.get("chart_data") or []
    if len(chart) >= 2:
        prev_close = chart[-2]["close"]
        if prev_close:
            day_change_pct = (cp - prev_close) / prev_close * 100
            if abs(day_change_pct) >= 7:
                emoji = "🚀" if day_change_pct > 0 else "🔻"
                action = "可能過熱，留意拉回" if day_change_pct > 0 else "可能恐慌殺盤，注意風險"
                send_telegram(
                    f"{emoji} <b>台指期大幅波動 {day_change_pct:+.2f}%</b>\n"
                    f"昨收：{prev_close:,.0f}\n"
                    f"現價：{cp:,.0f}"
                    f"{total_pnl_str}\n"
                    f"💡 建議：{action}\n"
                    f"🔗 {site_url}",
                    alert_key=f"txf_big_move_{today_str}",
                    alert_type="big_move"
                )
    # ============================================
    
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
        
        # ============ 個股警戒 ============
        if price and s.get("notify_enabled", True):
            today_str = str(datetime.now().date())
            symbol = s["symbol"]
            display_name = symbol.replace("FUND:", "")
            site_url = "https://ken0857888.github.io/txf-tracker/stocks.html"
            pnl_str = f"\n💰 損益：{round(pnl):+,} 元 ({pnl_pct:+.2f}%)" if pnl is not None else ""
            
            # 1. 突破警戒
            if s["alert_high"] and price >= s["alert_high"]:
                send_telegram(
                    f"🚀 <b>{display_name} 突破警戒</b>\n"
                    f"現價：{price:,.2f}\n"
                    f"目標：{s['alert_high']:,.2f}"
                    f"{pnl_str}\n"
                    f"💡 建議：考慮獲利了結或加碼\n"
                    f"🔗 {site_url}",
                    alert_key=f"stock_{symbol}_high_{today_str}",
                    alert_type="stock_high",
                    symbol=symbol
                )
            
            # 2. 跌破警戒
            if s["alert_low"] and price <= s["alert_low"]:
                send_telegram(
                    f"⚠️ <b>{display_name} 跌破警戒</b>\n"
                    f"現價：{price:,.2f}\n"
                    f"防線：{s['alert_low']:,.2f}"
                    f"{pnl_str}\n"
                    f"💡 建議：考慮停損或減倉\n"
                    f"🔗 {site_url}",
                    alert_key=f"stock_{symbol}_low_{today_str}",
                    alert_type="stock_low",
                    symbol=symbol
                )
            
            # 3. 大幅波動 ±7%（用成本價當基準粗估，更精準需歷史價）
            if s["cost_price"] and pnl_pct is not None and abs(pnl_pct) >= 7:
                emoji = "🚀" if pnl_pct > 0 else "🔻"
                action = "可考慮獲利出場" if pnl_pct > 0 else "可考慮停損保本"
                send_telegram(
                    f"{emoji} <b>{display_name} 大幅波動 {pnl_pct:+.2f}%</b>\n"
                    f"現價：{price:,.2f}\n"
                    f"成本：{s['cost_price']:,.2f}"
                    f"{pnl_str}\n"
                    f"💡 建議：{action}\n"
                    f"🔗 {site_url}",
                    alert_key=f"stock_{symbol}_big_move_{today_str}",
                    alert_type="stock_big_move",
                    symbol=symbol
                )
        # ====================================
        
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
    # C4: 沒設定警戒時，自動帶 ±10% 預設值
    alert_high = s.alert_high
    alert_low = s.alert_low
    if alert_high is None and s.cost_price:
        alert_high = round(s.cost_price * 1.10, 2)
    if alert_low is None and s.cost_price:
        alert_low = round(s.cost_price * 0.90, 2)
    
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO stock_positions (symbol, name, shares, cost_price, alert_high, alert_low, status) VALUES (%s, %s, %s, %s, %s, %s, 'active') RETURNING *",
        (s.symbol.upper(), s.symbol, s.shares, s.cost_price, alert_high, alert_low)
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

@app.delete("/api/snapshots/{snap_id}")
def delete_snapshot(snap_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM pnl_snapshots WHERE id=%s", (snap_id,))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已刪除"}

# ============ 通知管理 API ============
@app.get("/api/notifications")
def get_notifications(limit: int = 50):
    """取得通知歷史"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM notifications 
        ORDER BY sent_at DESC 
        LIMIT %s
    """, (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    # 把 datetime 轉字串
    for r in rows:
        if r.get('sent_at'):
            r['sent_at'] = str(r['sent_at'])
    return rows

@app.delete("/api/notifications")
def clear_notifications():
    """清空通知歷史"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM notifications")
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "已清空通知歷史"}

@app.get("/api/notifications/status")
def get_notification_status():
    """取得通知系統狀態"""
    return {
        "enabled": NOTIFICATIONS_ENABLED,
        "cooldown_minutes": ALERT_COOLDOWN_MINUTES,
        "telegram_configured": bool(TELEGRAM_TOKEN and TELEGRAM_CHAT_ID)
    }

@app.put("/api/stocks/{stock_id}/notify")
def toggle_stock_notify(stock_id: int, data: dict):
    """切換個股通知開關"""
    enabled = data.get('enabled', True)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE stock_positions SET notify_enabled=%s WHERE id=%s",
        (enabled, stock_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"message": f"通知{'開啟' if enabled else '關閉'}"}

@app.post("/api/notifications/test")
def test_notification():
    """測試通知（不受冷卻限制）"""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return {"success": False, "message": "Telegram 未設定"}
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        msg = "🧪 <b>測試通知</b>\n通知系統運作正常！"
        data = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        return {"success": True, "message": "已發送測試通知"}
    except Exception as e:
        return {"success": False, "message": str(e)}
# ======================================

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
