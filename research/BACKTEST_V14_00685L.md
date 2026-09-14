# Backtest v1.4 — 00685L benchmark comparison

Data through: 2026-09-14

00685L history in the dataset starts 2017-03-23, so there is no full 10-year live-fund comparison. The longest fair common-history comparison is about 9.48 years, from 2017-03-23 to 2026-09-14.

## Strategy under test
C monthly-volatility grid + MA60 regime leverage 3x / 2x / 0.5x.

## Fair comparison results
All instruments use the same start/end date within each row.

| Window | Asset/Strategy | Total | CAGR | MDD | Calmar | Return/MDD |
|---|---|---:|---:|---:|---:|---:|
| 1Y | C MA60 3/2/0.5 | +79.5% | 80.8% | -26.2% | 3.08 | 3.04 |
| 1Y | 0050 B&H | +94.8% | 95.2% | -15.4% | 6.20 | 6.17 |
| 1Y | TAIEX 1x proxy | +80.9% | 81.2% | -16.4% | 4.97 | 4.94 |
| 1Y | TAIEX synthetic daily 2x | +204.4% | 205.6% | -31.1% | 6.60 | 6.56 |
| 1Y | 00685L B&H | +177.3% | 178.2% | -33.3% | 5.35 | 5.32 |
| 3Y | C MA60 3/2/0.5 | +203.6% | 44.9% | -30.9% | 1.46 | 6.60 |
| 3Y | 0050 B&H | +260.9% | 53.4% | -27.5% | 1.94 | 9.49 |
| 3Y | TAIEX 1x proxy | +172.9% | 39.7% | -28.7% | 1.38 | 6.02 |
| 3Y | TAIEX synthetic daily 2x | +529.0% | 84.6% | -52.0% | 1.63 | 10.17 |
| 3Y | 00685L B&H | +474.0% | 79.0% | -54.8% | 1.44 | 8.65 |
| 5Y | C MA60 3/2/0.5 | +443.7% | 40.4% | -30.9% | 1.31 | 14.38 |
| 5Y | 0050 B&H | +249.1% | 28.4% | -33.8% | 0.84 | 7.36 |
| 5Y | TAIEX 1x proxy | +163.1% | 21.3% | -31.6% | 0.67 | 5.15 |
| 5Y | TAIEX synthetic daily 2x | +453.3% | 40.8% | -54.8% | 0.75 | 8.28 |
| 5Y | 00685L B&H | +515.5% | 43.8% | -54.8% | 0.80 | 9.41 |
| Since 00685L | C MA60 3/2/0.5 | +865.6% | 27.1% | -31.4% | 0.86 | 27.60 |
| Since 00685L | 0050 B&H | +668.4% | 24.0% | -33.8% | 0.71 | 19.76 |
| Since 00685L | TAIEX 1x proxy | +361.8% | 17.5% | -31.6% | 0.55 | 11.44 |
| Since 00685L | TAIEX synthetic daily 2x | +1427.9% | 33.3% | -54.8% | 0.61 | 26.07 |
| Since 00685L | 00685L B&H | +2703.2% | 42.1% | -54.8% | 0.77 | 49.32 |

## Interpretation
- 00685L is a much fairer live leveraged benchmark than 00631L because it targets the TAIEX daily 2x index rather than Taiwan 50 daily 2x.
- On 5Y raw return, C nearly matches theoretical 2x TAIEX (+443.7% vs +453.3%) but trails 00685L (+515.5%). C's MDD is much smaller (-30.9% vs -54.8%).
- Since 00685L inception, C trails both 00685L and theoretical 2x TAIEX on raw return, but has far lower drawdown.
- C beats 0050 and TAIEX 1x over 5Y and since-00685L-inception on both total return and drawdown/risk efficiency.
- The current C strategy is best viewed as a lower-drawdown dynamic-leverage alternative, not as a raw-return winner versus permanently leveraged 2x exposure.
