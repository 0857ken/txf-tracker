import itertools
import math
import numpy as np
import pandas as pd
import yfinance as yf

START_DOWNLOAD = "2015-01-01"
END_DOWNLOAD = "2026-09-16"
PERIODS = [1, 3, 5, 10]


def download(ticker: str) -> pd.DataFrame:
    df = yf.download(ticker, start=START_DOWNLOAD, end=END_DOWNLOAD, auto_adjust=True, actions=False, progress=False, threads=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns={c: c.lower() for c in df.columns}).sort_index()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df[["open", "high", "low", "close"]].dropna()


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["month_run_high"] = out.groupby(out.index.to_period("M"))["high"].cummax()
    for n in [60, 120, 200]:
        out[f"ma{n}"] = out["close"].rolling(n).mean()
        out[f"ma{n}_up"] = out[f"ma{n}"] > out[f"ma{n}"].shift(20)
        out[f"above{n}"] = out["close"] > out[f"ma{n}"]
    r = out["close"].pct_change()
    out["vol20_ann"] = r.rolling(20).std(ddof=0) * np.sqrt(252)
    return out


def build_c_target(df: pd.DataFrame) -> pd.Series:
    pos = 0.0
    anchor = None
    used2 = used3 = False
    vals = []
    for _, r in df.iterrows():
        px = r["close"]
        run_high = r["month_run_high"]
        if pos > 0 and anchor is not None and px >= anchor:
            pos = 0.0
            anchor = None
            used2 = used3 = False
        else:
            if pos == 0 and pd.notna(run_high) and px <= run_high * 0.97:
                anchor = float(run_high)
                pos = 0.20
            if pos > 0 and anchor is not None:
                if (not used2) and px <= anchor * 0.94:
                    pos += 0.30
                    used2 = True
                if (not used3) and px <= anchor * 0.91:
                    pos += 0.50
                    used3 = True
                pos = min(pos, 1.0)
        vals.append(pos)
    return pd.Series(vals, index=df.index, dtype=float)


def benchmark(df: pd.DataFrame) -> dict:
    c = df["close"]
    eq = c / c.iloc[0]
    total = float(eq.iloc[-1] - 1)
    days = max((eq.index[-1] - eq.index[0]).days, 1)
    cagr = float(eq.iloc[-1] ** (365.25 / days) - 1)
    mdd = float((eq / eq.cummax() - 1).min())
    return {"total": total, "cagr": cagr, "mdd": mdd, "romdd": total / abs(mdd)}


def metrics(df: pd.DataFrame, target_close: pd.Series, lev_close: pd.Series) -> dict:
    exposure = (target_close * lev_close).shift(1).fillna(0.0)
    fwd = df["open"].shift(-1) / df["open"] - 1.0
    mask = fwd.notna()
    ret = (exposure * fwd).loc[mask]
    exp = exposure.loc[mask]
    eq = (1 + ret).cumprod()
    total = float(eq.iloc[-1] - 1)
    days = max((eq.index[-1] - eq.index[0]).days, 1)
    cagr = float(eq.iloc[-1] ** (365.25 / days) - 1)
    mdd = float((eq / eq.cummax() - 1).min())
    return {
        "total": total,
        "cagr": cagr,
        "mdd": mdd,
        "romdd": total / abs(mdd) if mdd < 0 else None,
        "avg_exposure": float(exp.mean()),
        "max_exposure": float(exp.max()),
    }


def regime_lev(df: pd.DataFrame, ma_len: int, bull: float, neutral: float, bear: float) -> pd.Series:
    above = df[f"above{ma_len}"].fillna(False)
    up = df[f"ma{ma_len}_up"].fillna(False)
    lev = pd.Series(bear, index=df.index, dtype=float)
    lev[(above & up)] = bull
    lev[(above ^ up)] = neutral
    return lev


def vol_lev(df: pd.DataFrame, target_vol: float, lo: float = 0.75, hi: float = 3.0) -> pd.Series:
    lev = target_vol / df["vol20_ann"].replace(0, np.nan)
    return lev.clip(lower=lo, upper=hi).fillna(lo)


def pct(x):
    return f"{x*100:.1f}%"


def main():
    df = add_features(download("0050.TW"))
    end = df.index.max()

    # Candidate family: trend-regime leverage only, max 3x.
    grid = []
    for ma_len, bull, neutral, bear in itertools.product([60, 120, 200], [2.5, 3.0], [1.25, 1.5, 2.0], [0.5, 0.75, 1.0]):
        if not (bear <= neutral <= bull):
            continue
        grid.append((ma_len, bull, neutral, bear))

    rows = []
    for years in PERIODS:
        start = end - pd.DateOffset(years=years)
        s = df[df.index >= start].copy()
        target = build_c_target(s)
        bm = benchmark(s)

        # Baselines.
        for name, lev in [("C2.5_fixed", pd.Series(2.5, index=s.index)), ("C3.0_fixed", pd.Series(3.0, index=s.index))]:
            m = metrics(s, target, lev)
            rows.append({"period": years, "name": name, **m, "beat0050": m["total"] > bm["total"], "bm_total": bm["total"], "bm_mdd": bm["mdd"]})

        # Trend regime grid.
        for ma_len, bull, neutral, bear in grid:
            name = f"MA{ma_len}_{bull:g}-{neutral:g}-{bear:g}"
            m = metrics(s, target, regime_lev(s, ma_len, bull, neutral, bear))
            rows.append({"period": years, "name": name, **m, "beat0050": m["total"] > bm["total"], "bm_total": bm["total"], "bm_mdd": bm["mdd"]})

        # Volatility sizing and hybrid candidates.
        for tv in [0.20, 0.25, 0.30]:
            v = vol_lev(s, tv, 0.75, 3.0)
            name = f"VOL{int(tv*100)}"
            m = metrics(s, target, v)
            rows.append({"period": years, "name": name, **m, "beat0050": m["total"] > bm["total"], "bm_total": bm["total"], "bm_mdd": bm["mdd"]})
            trend = regime_lev(s, 200, 3.0, 1.5, 0.75)
            h = pd.concat([v, trend], axis=1).min(axis=1)
            name = f"HYBRID200_VOL{int(tv*100)}"
            m = metrics(s, target, h)
            rows.append({"period": years, "name": name, **m, "beat0050": m["total"] > bm["total"], "bm_total": bm["total"], "bm_mdd": bm["mdd"]})

    res = pd.DataFrame(rows)

    print("FILTER_SEARCH_SUMMARY_BEGIN")
    for years in PERIODS:
        q = res[res.period == years].copy()
        bm_total = q.bm_total.iloc[0]
        bm_mdd = q.bm_mdd.iloc[0]
        print(f"\n=== {years}Y | 0050 {pct(bm_total)} | MDD {pct(bm_mdd)} ===")
        feasible = q[(q["total"] > bm_total) & (q["mdd"] >= -0.40)].sort_values(["total", "mdd"], ascending=[False, False])
        if len(feasible):
            print("BEAT_0050_WITH_MDD_LE_40")
            for _, r in feasible.head(10).iterrows():
                print(f"{r['name']} | total {pct(r['total'])} | CAGR {pct(r['cagr'])} | MDD {pct(r['mdd'])} | R/MDD {r['romdd']:.2f} | avgExp {r['avg_exposure']:.2f}x | maxExp {r['max_exposure']:.2f}x")
        else:
            print("NO_CANDIDATE_BEATS_0050_WITH_MDD_LE_40")

        print("TOP_BY_RETURN_AMONG_MDD_LE_45")
        z = q[q["mdd"] >= -0.45].sort_values("total", ascending=False).head(8)
        for _, r in z.iterrows():
            print(f"{r['name']} | total {pct(r['total'])} | CAGR {pct(r['cagr'])} | MDD {pct(r['mdd'])} | R/MDD {r['romdd']:.2f} | avgExp {r['avg_exposure']:.2f}x")

    # Find robust candidates that beat benchmark in 5Y and 10Y and keep 10Y MDD <=40%.
    p5 = res[res.period == 5][["name", "total", "mdd", "bm_total"]].rename(columns={"total":"total5", "mdd":"mdd5", "bm_total":"bm5"})
    p10 = res[res.period == 10][["name", "total", "mdd", "bm_total", "cagr", "romdd", "avg_exposure", "max_exposure"]].rename(columns={"total":"total10", "mdd":"mdd10", "bm_total":"bm10", "cagr":"cagr10", "romdd":"romdd10"})
    robust = p5.merge(p10, on="name")
    robust = robust[(robust.total5 > robust.bm5) & (robust.total10 > robust.bm10) & (robust.mdd10 >= -0.40)].sort_values("total10", ascending=False)
    print("\nROBUST_5Y10Y_BEGIN")
    if robust.empty:
        print("NONE")
    else:
        for _, r in robust.head(15).iterrows():
            print(f"{r['name']} | 5Y {pct(r['total5'])}/{pct(r['mdd5'])} | 10Y {pct(r['total10'])}/{pct(r['mdd10'])} | CAGR10 {pct(r['cagr10'])} | R/MDD10 {r['romdd10']:.2f} | avgExp {r['avg_exposure']:.2f}x")
    print("ROBUST_5Y10Y_END")
    print("FILTER_SEARCH_SUMMARY_END")


if __name__ == "__main__":
    main()
