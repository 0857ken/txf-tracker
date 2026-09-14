# Backtest v1.3 — Benchmark comparison

Data through: 2026-09-14

## Important definitions
- C candidate = monthly-volatility grid + MA60 regime leverage 3x / 2x / 0.5x.
- TAIEX buy-and-hold is used only as a gross 1x directional proxy for a continuously held TXF exposure; it is not a true rolled-futures total-return series.
- Synthetic daily 2x TAIEX = 2 times each day's TAIEX close-to-close return, compounded daily, gross of financing/costs.
- 00631L is the actual Yuanta Taiwan 50 Daily 2X ETF, not a 2x TAIEX ETF.

## Results

| Period | C MA60 3/2/0.5 | 0050 B&H | TAIEX 1x proxy | Synthetic daily 2x TAIEX | 00631L B&H |
|---|---:|---:|---:|---:|---:|
| 1Y total return | +79.5% | +94.8% | +80.9% | +204.4% | +175.4% |
| 1Y MDD | -26.2% | -15.4% | -16.4% | -31.1% | -31.3% |
| 3Y total return | +203.6% | +260.9% | +172.9% | +529.0% | +473.9% |
| 3Y MDD | -30.9% | -27.5% | -28.7% | -52.0% | -55.1% |
| 5Y total return | +443.7% | +249.1% | +163.1% | +453.3% | +482.1% |
| 5Y MDD | -30.9% | -33.8% | -31.6% | -54.8% | -55.1% |
| 10Y total return | +919.3% | +754.5% | +415.2% | +1789.6% | +3314.3% |
| 10Y MDD | -31.4% | -33.8% | -31.6% | -54.8% | -55.1% |

## 10Y CAGR / risk-efficiency
- C candidate: CAGR 26.2%, return/MDD 29.31.
- TAIEX 1x proxy: CAGR 17.8%, return/MDD 13.13.
- Synthetic daily 2x TAIEX: CAGR 34.2%, return/MDD 32.68.
- 00631L: CAGR 42.3%, return/MDD 60.10.

## Interpretation
1. Against a 1x TXF/TAIEX directional benchmark, C is competitive and wins over 3Y/5Y/10Y, with similar or lower drawdown over the longer windows.
2. Against 00631L or a theoretical daily 2x TAIEX, C generally does not win on raw return. Its advantage is materially lower drawdown.
3. Over 5Y, C nearly matches the 2x benchmarks on return while cutting MDD from about -55% to about -31%.
4. Over 10Y, 00631L massively outperforms on raw return, but with roughly -55% historical drawdown versus about -31% for C.
5. The benchmark choice changes the conclusion: C looks strong versus 1x index exposure, but not versus permanently leveraged 2x exposure if the only objective is maximum cumulative return.
