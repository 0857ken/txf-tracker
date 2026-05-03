"""
每日快照腳本：每天 14:00（期貨盤後）跑一次，記錄當日總權益
Railway Cron Schedule: 00 6 * * 1-5  (UTC 6:00 = 台北 14:00)
"""
import os
import sys
import json
import urllib.request
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timezone, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
TOTAL_FUND = 2000000

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

def get_tw_now():
    return datetime.now(timezone(timedelta(hours=8)))

def is_trading_day():
    now = get_tw_now()
    if now.weekday() >= 5:
        print(f'⚠️ {now.strftime("%Y-%m-%d")} 是週末（仍會記錄）')
    return True

def fetch_yahoo(symbol):
    try:
        url = f'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        return data['chart']['result'][0].get('meta', {}).get('regularMarketPrice')
    except Exception as e:
        print(f'⚠️ Yahoo {symbol} failed: {e}')
        return None

def take_snapshot():
    if not is_trading_day():
        return
    if not DATABASE_URL:
        print('❌ 沒有 DATABASE_URL')
        sys.exit(1)
    
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    today = get_tw_now().strftime('%Y-%m-%d')
    
    twii_price = fetch_yahoo('%5ETWII')
    
    cur.execute("SELECT * FROM positions WHERE status='open'")
    positions = cur.fetchall()
    
    futures_market_value = 0
    futures_cost = 0
    futures_margin = 0
    total_lots = 0
    
    for p in positions:
        ct = p.get('type') or 'TMF'
        multiplier = CONTRACT_MULTIPLIER.get(ct, 10)
        margin = CONTRACT_MARGIN.get(ct, 11500)
        cost = p['entry_price'] * multiplier * p['lots']
        value = (twii_price or p['entry_price']) * multiplier * p['lots']
        futures_market_value += value
        futures_cost += cost
        futures_margin += margin * p['lots']
        total_lots += p['lots']
    
    cur.execute("SELECT * FROM stock_positions WHERE status='active'")
    stocks = cur.fetchall()
    stock_value = 0
    stock_cost = 0
    for s in stocks:
        symbol = s['symbol']
        if symbol.startswith('FUND:'):
            cur.execute("SELECT price FROM fund_prices WHERE stock_id=%s", (s['id'],))
            r = cur.fetchone()
            price = r['price'] if r else s['cost_price']
        else:
            price = fetch_yahoo(symbol + '.TW') or s['cost_price']
        stock_value += price * s['shares']
        stock_cost += s['cost_price'] * s['shares']
    
    cur.execute("SELECT COALESCE(SUM(pnl_twd), 0) AS total FROM realized_pnl WHERE date=%s", (today,))
    realized_today = float(cur.fetchone()['total'] or 0)
    
    unrealized = (futures_market_value - futures_cost) + (stock_value - stock_cost)
    cash = TOTAL_FUND - futures_margin - stock_cost
    total_equity = cash + futures_market_value + stock_value
    
    avg_cost = 0
    if total_lots > 0 and positions:
        first_type = positions[0].get('type', 'TMF')
        avg_cost = futures_cost / total_lots / CONTRACT_MULTIPLIER.get(first_type, 10)
    dynamic_floor = avg_cost - 100 if avg_cost > 0 else 0
    
    cur.execute("""
        INSERT INTO pnl_snapshots 
            (date, close_price, total_lots, unrealized_pnl, avg_cost, dynamic_floor,
             total_equity, cash, stock_value, realized_today)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (date) DO UPDATE SET
            close_price = EXCLUDED.close_price,
            total_lots = EXCLUDED.total_lots,
            unrealized_pnl = EXCLUDED.unrealized_pnl,
            avg_cost = EXCLUDED.avg_cost,
            dynamic_floor = EXCLUDED.dynamic_floor,
            total_equity = EXCLUDED.total_equity,
            cash = EXCLUDED.cash,
            stock_value = EXCLUDED.stock_value,
            realized_today = EXCLUDED.realized_today
    """, (today, twii_price, total_lots, unrealized, avg_cost, dynamic_floor,
          total_equity, cash, stock_value, realized_today))
    conn.commit()
    cur.close()
    conn.close()
    
    print(f'✅ {today}')
    print(f'   總權益: {total_equity:,.0f}')
    print(f'   未實現: {unrealized:,.0f}')
    print(f'   已實現(今日): {realized_today:,.0f}')
    print(f'   現金: {cash:,.0f}')

if __name__ == '__main__':
    take_snapshot()
