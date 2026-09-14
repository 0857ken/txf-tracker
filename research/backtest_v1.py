import json
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
import yfinance as yf

START_DOWNLOAD = "2015-01-01"
END_DOWNLOAD = "2026-09-16"
PERIODS = [1, 3, 5, 10]


def download(ticker: str) -> pd.DataFrame:
    df = yf.download(
        ticker,
        start=START_DOWNLOAD,
        end=END_DOWNLOAD,
        auto_adjust=True,
        actions=False,
        progress=False,
        threads=False,
    )
    if df.empty:
        raise RuntimeError(f"No data returned for {ticker}")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns={c: c.lower() for c in df.columns})
    needed = ["open", "high", "low", "close"]
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"{ticker} missing columns: {missing}")
    df = df.sort_index()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


def add_indicators_taiex(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    c, h, l = out["close"], out["high"], out["low"]
    out["ma20"] = c.rolling(20).mean()
    out["ma23"] = c.rolling(23).mean()
    out["ma60"] = c.rolling(60).mean()
    std20 = c.rolling(20).std(ddof=0)
    out["bb_upper"] = out["ma20"] + 2 * std20
    out["bb_lower"] = out["ma20"] - 2 * std20

    up_cond = c > c.shift(4)
    dn_cond = c < c.shift(4)
    up_count, dn_count = [], []
    u = d = 0
    for u_ok, d_ok in zip(up_cond.fillna(False), dn_cond.fillna(False)):
        u = u + 1 if u_ok else 0
        d = d + 1 if d_ok else 0
        up_count.append(u)
        dn_count.append(d)
    out["up9"] = up_count
    out["dn9"] = dn_count

    upper_gap = (h - out["ma23"]).clip(lower=0)
    lower_gap = (out["ma23"] - l).clip(lower=0)
    out["sellP"] = out["ma23"] + upper_gap.rolling(60).max()
    out["buyP"] = out["ma23"] - lower_gap.rolling(60).max()
    out["h10"] = h.rolling(10).max()
    out["l10"] = l.rolling(10).min()
    return out


def add_indicators_0050(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    # Calendar-month running high, using information available through each day.
    out["month_run_high"] = out.groupby(out.index.to_period("M"))["high"].cummax()
    return out


def build_a(slice_df: pd.DataFrame) -> pd.Series:
    # Agreed v1: Yao "nine-turn + extreme" only; long/flat, no Mansfield-RS gate.
    pos = 0.0
    targets = []
    seq_marks = {8, 9, 12, 13}
    for _, r in slice_df.iterrows():
        sell_sig = (
            (pd.notna(r["sellP"]) and pd.notna(r["h10"]) and r["high"] >= r["sellP"] and r["high"] >= r["h10"])
            or int(r["up9"]) in seq_marks
        )
        buy_sig = (
            (pd.notna(r["buyP"]) and pd.notna(r["l10"]) and r["low"] <= r["buyP"] and r["low"] <= r["l10"])
            or int(r["dn9"]) in seq_marks
        )
        if pos > 0 and sell_sig:
            pos = 0.0
        elif pos == 0 and buy_sig:
            pos = 1.0
        targets.append(pos)
    return pd.Series(targets, index=slice_df.index, dtype=float)


def build_b(slice_df: pd.DataFrame) -> pd.Series:
    # Orange Taro 3 lines: add 20% at MA20, 30% at MA60, 50% at lower BB.
    # Each tranche may fire once per cycle. Exit all at upper BB. 1% touch tolerance.
    pos = 0.0
    used20 = used60 = usedbb = False
    targets = []
    for _, r in slice_df.iterrows():
        px = r["close"]
        if pd.notna(r["bb_upper"]) and pos > 0 and px >= r["bb_upper"]:
            pos = 0.0
            used20 = used60 = usedbb = False
        else:
            if pd.notna(r["ma20"]) and (not used20) and px <= r["ma20"] * 1.01:
                pos += 0.20
                used20 = True
            if pd.notna(r["ma60"]) and (not used60) and px <= r["ma60"] * 1.01:
                pos += 0.30
                used60 = True
            if pd.notna(r["bb_lower"]) and (not usedbb) and px <= r["bb_lower"] * 1.01:
                pos += 0.50
                usedbb = True
            pos = min(pos, 1.0)
        targets.append(pos)
    return pd.Series(targets, index=slice_df.index, dtype=float)


def build_c(slice_df: pd.DataFrame) -> pd.Series:
    # Monthly-volatility grid on 0050: -3% => 20%, -6% => +30%, -9% => +50%.
    # Freeze the reference high when the first tranche fires; exit all when price recovers to that anchor.
    pos = 0.0
    anchor = None
    used1 = used2 = used3 = False
    targets = []
    for _, r in slice_df.iterrows():
        px = r["close"]
        run_high = r["month_run_high"]
        if pos > 0 and anchor is not None and px >= anchor:
            pos = 0.0
            anchor = None
            used1 = used2 = used3 = False
        else:
            if pos == 0 and pd.notna(run_high) and px <= run_high * 0.97:
                anchor = float(run_high)
                pos = 0.20
                used1 = True
            if pos > 0 and anchor is not None:
                if (not used2) and px <= anchor * 0.94:
                    pos += 0.30
                    used2 = True
                if (not used3) and px <= anchor * 0.91:
                    pos += 0.50
                    used3 = True
                pos = min(pos, 1.0)
        targets.append(pos)
    return pd.Series(targets, index=slice_df.index, dtype=float)


def strategy_metrics(slice_df: pd.DataFrame, target_close: pd.Series) -> dict:
    # Signals are evaluated after the close; changes are executed at next session's open.
    pos_open = target_close.shift(1).fillna(0.0)
    fwd = slice_df["open"].shift(-1) / slice_df["open"] - 1.0
    valid = fwd.notna()
    ret = (pos_open * fwd).where(valid).dropna()
    pos = pos_open.loc[ret.index]
    if ret.empty:
        return {}

    equity = (1.0 + ret).cumprod()
    total = float(equity.iloc[-1] - 1.0)
    days = max((ret.index[-1] - ret.index[0]).days, 1)
    cagr = float((equity.iloc[-1] ** (365.25 / days)) - 1.0)
    dd = equity / equity.cummax() - 1.0
    mdd = float(dd.min())
    exposure = float(pos.mean())

    # Completed position cycles; P/L is portfolio-level, including partial tranches.
    completed = []
    capital = 1.0
    in_cycle = False
    cycle_start = None
    pos_vals = pos.values
    ret_vals = ret.values
    for i in range(len(ret_vals)):
        p = pos_vals[i]
        if p > 0 and not in_cycle:
            in_cycle = True
            cycle_start = capital
        capital *= (1.0 + ret_vals[i])
        next_p = pos_vals[i + 1] if i + 1 < len(pos_vals) else p
        if in_cycle and p > 0 and next_p == 0:
            completed.append(capital / cycle_start - 1.0)
            in_cycle = False
            cycle_start = None
    wins = sum(x > 0 for x in completed)
    win_rate = float(wins / len(completed)) if completed else None
    avg_trade = float(np.mean(completed)) if completed else None
    worst_trade = float(np.min(completed)) if completed else None

    return {
        "total_return": total,
        "cagr": cagr,
        "max_drawdown": mdd,
        "return_over_mdd": (total / abs(mdd)) if mdd < 0 else None,
        "completed_cycles": len(completed),
        "win_rate": win_rate,
        "avg_cycle_return": avg_trade,
        "worst_cycle_return": worst_trade,
        "avg_exposure": exposure,
    }


def benchmark_metrics(df: pd.DataFrame) -> dict:
    close = df["close"].dropna()
    if len(close) < 2:
        return {}
    eq = close / close.iloc[0]
    total = float(eq.iloc[-1] - 1.0)
    days = max((eq.index[-1] - eq.index[0]).days, 1)
    cagr = float((eq.iloc[-1] ** (365.25 / days)) - 1.0)
    dd = eq / eq.cummax() - 1.0
    mdd = float(dd.min())
    return {
        "total_return": total,
        "cagr": cagr,
        "max_drawdown": mdd,
        "return_over_mdd": (total / abs(mdd)) if mdd < 0 else None,
        "completed_cycles": None,
        "win_rate": None,
        "avg_cycle_return": None,
        "worst_cycle_return": None,
        "avg_exposure": 1.0,
    }


def pct(x):
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x*100:.1f}%"


def main():
    taiex = add_indicators_taiex(download("^TWII"))
    etf = add_indicators_0050(download("0050.TW"))
    common_end = min(taiex.index.max(), etf.index.max())

    results = {
        "data_end": str(common_end.date()),
        "assumptions": {
            "A": "TAIEX proxy; nine-turn/extreme long-flat only; next-open execution",
            "B": "TAIEX proxy; MA20 +20%, MA60 +30%, lower BB +50%; upper BB exit; next-open execution",
            "C": "0050; calendar-month running high; -3/-6/-9% => 20/50/100%; recover anchor exit; next-open execution",
            "benchmark": "0050 buy-and-hold on yfinance auto-adjusted prices",
            "costs": "No fees, tax, slippage, futures roll or leverage in v1",
        },
        "periods": {},
    }

    for years in PERIODS:
        target_start = common_end - pd.DateOffset(years=years)
        tx = taiex[(taiex.index >= target_start) & (taiex.index <= common_end)].copy()
        e = etf[(etf.index >= target_start) & (etf.index <= common_end)].copy()
        if len(tx) < 2 or len(e) < 2:
            continue
        a = strategy_metrics(tx, build_a(tx))
        b = strategy_metrics(tx, build_b(tx))
        c = strategy_metrics(e, build_c(e))
        bench = benchmark_metrics(e)
        results["periods"][str(years)] = {
            "start": str(max(tx.index.min(), e.index.min()).date()),
            "end": str(common_end.date()),
            "A_yao": a,
            "B_orange": b,
            "C_month_vol": c,
            "0050_buy_hold": bench,
        }

    print("BACKTEST_JSON_BEGIN")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("BACKTEST_JSON_END")
    print("\nBACKTEST_TABLE_BEGIN")
    print("| Period | Strategy | Total | CAGR | MDD | Return/MDD | Cycles | Win | Avg exposure |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|")
    for years in PERIODS:
        p = results["periods"].get(str(years))
        if not p:
            continue
        for key, name in [("A_yao", "A 耀九轉極端"), ("B_orange", "B 橘太郎三線"), ("C_month_vol", "C 月波動"), ("0050_buy_hold", "0050 B&H")]:
            m = p[key]
            rom = "—" if m["return_over_mdd"] is None else f"{m['return_over_mdd']:.2f}"
            cyc = "—" if m["completed_cycles"] is None else str(m["completed_cycles"])
            win = pct(m["win_rate"])
            print(f"| {years}Y | {name} | {pct(m['total_return'])} | {pct(m['cagr'])} | {pct(m['max_drawdown'])} | {rom} | {cyc} | {win} | {pct(m['avg_exposure'])} |")
    print("BACKTEST_TABLE_END")


if __name__ == "__main__":
    main()
