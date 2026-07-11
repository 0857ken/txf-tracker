"""策略計算(Python版,供 LINE 推播用)"""

def sma(arr, period, idx=None):
    if idx is None:
        idx = len(arr) - 1
    if idx < period - 1:
        return None
    return sum(arr[idx - period + 1: idx + 1]) / period

def ema(arr, period):
    k = 2 / (period + 1)
    out = []
    prev = None
    for i, v in enumerate(arr):
        prev = v if i == 0 else v * k + prev * (1 - k)
        out.append(prev)
    return out

def mansfield_rs(closes, bench, length=50, smooth=5):
    rs_ratio = [c / b if b else None for c, b in zip(closes, bench)]
    mansfield = []
    for i, r in enumerate(rs_ratio):
        window = rs_ratio[max(0, i-length+1):i+1]
        s = sma(rs_ratio, length, i) if all(x is not None for x in window) else None
        mansfield.append(((r / s) - 1) * 100 if (r and s) else None)
    valid = [v if v is not None else 0 for v in mansfield]
    return ema(valid, smooth)

def td_seq(closes):
    sc = bc = 0
    for i in range(len(closes)):
        if i >= 4:
            sc = sc + 1 if closes[i] > closes[i-4] else 0
            bc = bc + 1 if closes[i] < closes[i-4] else 0
    return sc, bc

def bollinger(closes, period=20, mult=2):
    idx = len(closes) - 1
    mid = sma(closes, period, idx)
    if mid is None:
        return None
    var = sum((closes[i] - mid) ** 2 for i in range(idx - period + 1, idx + 1)) / period
    return {"mid": mid, "upper": mid + mult * var**0.5, "lower": mid - mult * var**0.5}

def rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains = losses = 0
    for i in range(len(closes) - period, len(closes)):
        diff = closes[i] - closes[i-1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    ag, al = gains / period, losses / period
    if al == 0:
        return 100
    return 100 - (100 / (1 + ag / al))

def extreme_bands(highs, lows, closes, m_len=23, lkbk=60):
    idx = len(closes) - 1
    m23 = sma(closes, m_len, idx)
    if m23 is None:
        return None
    max_u = max_l = float('-inf')
    for i in range(idx - lkbk, idx):
        if i < m_len - 1:
            continue
        m = sma(closes, m_len, i)
        if m is None:
            continue
        max_u = max(max_u, highs[i] - m)
        max_l = max(max_l, m - lows[i])
    return {"m23": m23, "sellP": m23 + max_u, "buyP": m23 - max_l,
            "h10": max(highs[idx-9:idx+1]), "l10": min(lows[idx-9:idx+1])}

def compute_signals(data):
    rows = data["target"]
    closes = [r["close"] for r in rows]
    highs = [r["high"] for r in rows]
    lows = [r["low"] for r in rows]
    vols = [r["volume"] for r in rows]
    bench = data["benchmark_close"]
    cur = rows[-1]
    price = cur["close"]
    ma20, ma60, vol_ma5 = sma(closes, 20), sma(closes, 60), sma(vols, 5)
    rs_arr = mansfield_rs(closes, bench)
    rs, rs_prev = rs_arr[-1], rs_arr[-2]
    sc, bc = td_seq(closes)
    boll = bollinger(closes)
    bands = extreme_bands(highs, lows, closes)
    month_high = max(highs[-20:])

    signals = []
    vol_ratio = vols[-1] / vol_ma5 if vol_ma5 else 0
    rs_up = rs > 0 and rs_prev <= 0
    rs_down = rs < 0 and rs_prev >= 0
    ex_sell = bands and cur["high"] >= bands["sellP"] and cur["high"] >= bands["h10"]
    ex_buy = bands and cur["low"] <= bands["buyP"] and cur["low"] <= bands["l10"]
    is_fomo = sc in (8, 9, 12, 13)
    is_panic = bc in (8, 9, 12, 13)
    if ex_sell or is_fomo:
        signals.append("RS訊號:🔴 頂部過熱,禁止追多")
    elif rs_up and price > ma60 and vol_ratio > 1.2:
        signals.append("RS訊號:🟢 轉強買進")
    elif ex_buy or is_panic:
        signals.append("RS訊號:🟢 極端買點/恐慌")
    elif rs_down and price < ma20:
        signals.append("RS訊號:🔴 轉弱賣出")

    if boll and price >= boll["upper"]:
        signals.append("三條線:🔴 觸布林上軌,出清")
    elif boll and price <= boll["lower"] * 1.01:
        signals.append("三條線:🟢 觸布林下軌,第3批")
    elif ma60 and price <= ma60 * 1.01:
        signals.append("三條線:🟢 觸季線,第2批")
    elif ma20 and price <= ma20 * 1.01:
        signals.append("三條線:🟢 觸月線,第1批")

    g1, g2, g3 = month_high * 0.97, month_high * 0.94, month_high * 0.91
    if price <= g3:
        signals.append("網格:🟢 跌破-9%,戰備金全投入")
    elif price <= g2:
        signals.append("網格:🟢 跌破-6%,重倉1.5~2碼")
    elif price <= g1:
        signals.append("網格:🟢 跌破-3%,輕倉0.5碼")

    return {"price": price, "rs": rs, "signals": signals}
