import json
import math
import numpy as np
import pandas as pd

from backtest_v1 import (
    PERIODS,
    add_indicators_0050,
    add_indicators_taiex,
    benchmark_metrics,
    build_a,
    build_b,
    build_c,
    download,
    strategy_metrics,
)

LEVERAGES = [1.0, 1.5, 2.0, 2.5, 3.0]


def pct(x):
    if x is None:
        return "—"
    return f"{x*100:.1f}%"


def main():
    taiex = add_indicators_taiex(download("^TWII"))
    etf = add_indicators_0050(download("0050.TW"))
    common_end = min(taiex.index.max(), etf.index.max())

    out = {
        "data_end": str(common_end.date()),
        "note": "Gross leverage stress test. Strategy exposure is multiplied by leverage; no fees, tax, slippage, futures roll/basis or margin calls.",
        "periods": {},
    }

    print("LEVERAGE_TABLE_BEGIN")
    print("| Period | Strategy | Lev | Total | CAGR | MDD | Return/MDD | Avg exposure | Beat 0050 total? |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|")

    for years in PERIODS:
        target_start = common_end - pd.DateOffset(years=years)
        tx = taiex[(taiex.index >= target_start) & (taiex.index <= common_end)].copy()
        e = etf[(etf.index >= target_start) & (etf.index <= common_end)].copy()
        if len(tx) < 2 or len(e) < 2:
            continue

        base_targets = {
            "A_yao": (tx, build_a(tx)),
            "B_orange": (tx, build_b(tx)),
            "C_month_vol": (e, build_c(e)),
        }
        bench = benchmark_metrics(e)
        bench_total = bench["total_return"]

        period_out = {
            "start": str(max(tx.index.min(), e.index.min()).date()),
            "end": str(common_end.date()),
            "0050_buy_hold": bench,
            "strategies": {},
        }

        for key, (df, target) in base_targets.items():
            period_out["strategies"][key] = {}
            for lev in LEVERAGES:
                m = strategy_metrics(df, target * lev)
                m["beat_0050_total"] = bool(m and m["total_return"] > bench_total)
                period_out["strategies"][key][str(lev)] = m

                rom = "—" if m.get("return_over_mdd") is None else f"{m['return_over_mdd']:.2f}"
                print(
                    f"| {years}Y | {key} | {lev:.1f}x | {pct(m['total_return'])} | {pct(m['cagr'])} | "
                    f"{pct(m['max_drawdown'])} | {rom} | {pct(m['avg_exposure'])} | "
                    f"{'YES' if m['beat_0050_total'] else 'NO'} |"
                )

        out["periods"][str(years)] = period_out
        print(
            f"| {years}Y | 0050 B&H | 1.0x | {pct(bench['total_return'])} | {pct(bench['cagr'])} | "
            f"{pct(bench['max_drawdown'])} | {bench['return_over_mdd']:.2f} | 100.0% | benchmark |"
        )

    print("LEVERAGE_TABLE_END")
    print("LEVERAGE_JSON_BEGIN")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print("LEVERAGE_JSON_END")


if __name__ == "__main__":
    main()
