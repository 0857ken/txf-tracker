"""
盤後總結：每天 13:50 (UTC 5:50) 發 Telegram
Cron: 50 5 * * 1-5
"""
import os
import sys
import json
import urllib.request
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timezone, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
TELEGRAM_TOKEN = os.environ.get('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID')
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
    return get_tw_now().weekday() < 5

def fetch_yahoo(symbol):
    try:
        url = f'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        return data['chart']['result'][0]
    except Exception as e:
        print(f'Yahoo {symbol} failed: {e}')
        return None

def send_telegram(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print('Telegram 未設定')
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'
        data = json.dumps({'chat_id': TELEGRAM_CHAT_ID, 'text': msg, 'parse_mode': 'HTML'}).encode()
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f'Telegram 失敗: {e}')
        return False

def generate_summary():
    if not is_trading_day():
        print('非交易日')
        return
    
    today = get_tw_now().strftime('%Y-%m-%d')
    weekday_zh = ['一','二','三','四','五'][get_tw_now().weekday()]
    
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 加權指數
    twii = fetch_yahoo('%5ETWII')
    twii_close = twii['meta'].get('regularMarketPrice') if twii else None
    twii_change_pct = None
    if twii:
        closes = [c for c in twii['indicators']['quote'][0]['close'] if c]
        if len(closes) >= 2:
            twii_change_pct = (closes[-1] - closes[-2]) / closes[-2] * 100
    
    # 校對價
    cur.execute("SELECT price FROM price_overrides WHERE date=%s", (today,))
    ov = cur.fetchone()
    if ov:
        txf_close = float(ov['price'])
    else:
        cur.execute("SELECT price FROM price_overrides ORDER BY date DESC LIMIT 1")
        latest = cur.fetchone()
        txf_close = float(latest['price']) if latest else twii_close
    
    # 部位
    cur.execute("SELECT * FROM positions WHERE status='open'")
    positions = cur.fetchall()
    total_pnl = 0
    total_lots = 0
    futures_margin = 0
    for p in positions:
        ct = p.get('type') or 'TMF'
        m = CONTRACT_MULTIPLIER.get(ct, 10)
        margin = CONTRACT_MARGIN.get(ct, 30000)
        pnl = (txf_close - p['entry_price']) * m * p['lots']
        total_pnl += pnl
        total_lots += p['lots']
        futures_margin += margin * p['lots']
    
    avg_cost = sum(p['entry_price']*p['lots'] for p in positions) / total_lots if total_lots else 0
    hard_floor = round(avg_cost - 100) if avg_cost else 0
    dist_to_floor = round(txf_close - hard_floor) if hard_floor else None
    futures_equity = futures_margin + total_pnl
    
    # 股票
    cur.execute("SELECT * FROM stock_positions WHERE status='active'")
    stocks = cur.fetchall()
    stock_value = 0
    for s in stocks:
        if s['symbol'].startswith('FUND:'):
            cur.execute("SELECT price FROM fund_prices WHERE stock_id=%s", (s['id'],))
            r = cur.fetchone()
            price = r['price'] if r else s['cost_price']
        else:
            yh = fetch_yahoo(s['symbol'] + '.TW')
            price = yh['meta'].get('regularMarketPrice') if yh else s['cost_price']
        stock_value += price * s['shares']
    
    total_value = futures_equity + stock_value
    total_pct = (total_value / TOTAL_FUND) * 100
    
    # 已實現
    cur.execute("SELECT COALESCE(SUM(pnl_twd),0) AS total, COUNT(*) AS cnt FROM realized_pnl WHERE date=%s", (today,))
    r = cur.fetchone()
    realized_today = float(r['total'] or 0)
    realized_count = r['cnt']
    cur.execute("SELECT COALESCE(SUM(pnl_twd),0) AS total FROM realized_pnl")
    total_realized = float(cur.fetchone()['total'] or 0)
    
    cur.close()
    conn.close()
    
    # K 線
    if twii_change_pct is not None:
        kbar = "🔴 紅K" if twii_change_pct > 0 else ("⚫ 黑K" if twii_change_pct < 0 else "➖ 平盤")
    else:
        kbar = ""
    
    # 組訊息
    site_url = "https://ken0857888.github.io/txf-tracker/"
    lines = [f"📊 <b>{today} (週{weekday_zh}) 盤後總結</b>", ""]
    
    if twii_close:
        change_str = f"{twii_change_pct:+.2f}%" if twii_change_pct is not None else "—"
        lines.append("📈 <b>大盤</b>")
        lines.append(f"  加權：{twii_close:,.2f} ({change_str}) {kbar}")
        if txf_close:
            spread = txf_close - twii_close
            lines.append(f"  台指期：{txf_close:,.0f} (價差 {spread:+.0f})")
        lines.append("")
    
    if positions:
        lines.append("💼 <b>持倉狀態</b>")
        lines.append(f"  口數：{total_lots} 口｜均價：{avg_cost:,.0f}")
        sign = "+" if total_pnl >= 0 else ""
        emoji = "🔴" if total_pnl >= 0 else "🟢"
        lines.append(f"  未實現：{emoji} {sign}{round(total_pnl):,} 元")
        if dist_to_floor is not None:
            warn = " 🚨 已跌破！" if dist_to_floor <= 0 else (" ⚠️ 接近警戒" if dist_to_floor <= 300 else "")
            lines.append(f"  成本警戒線：{hard_floor:,} (距 {dist_to_floor:+} 點){warn}")
    else:
        lines.append("💼 <b>持倉狀態</b>")
        lines.append("  無持倉")
    lines.append("")
    
    # 資產合計
    lines.append("📦 <b>每日資產合計</b>")
    lines.append(f"  期貨權益：{round(futures_equity):,} 元")
    lines.append(f"  股票市值：{round(stock_value):,} 元")
    lines.append(f"  <b>總市值：{round(total_value):,} 元</b>")
    lines.append(f"  佔 200 萬：<b>{total_pct:.2f}%</b>")
    lines.append("")
    
    lines.append("💰 <b>已實現損益</b>")
    if realized_count > 0:
        sign = "+" if realized_today >= 0 else ""
        lines.append(f"  今日：{sign}{round(realized_today):,} 元 ({realized_count} 筆)")
    else:
        lines.append("  今日：無交易")
    sign = "+" if total_realized >= 0 else ""
    lines.append(f"  累積：{sign}{round(total_realized):,} 元")
    lines.append("")
    lines.append(f"🔗 {site_url}")
    
    msg = "\n".join(lines)
    print(msg)
    print()
    
    if send_telegram(msg):
        print('✅ 已發送')

if __name__ == '__main__':
    generate_summary()
