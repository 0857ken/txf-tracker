# Backtest v1.6–v1.7 — C dynamic leverage refinement

Data through: 2026-09-14

## Goal
Increase C strategy participation in bull/transition regimes without allowing drawdown to approach permanent 2x exposure.

Signals remain based on 0050. Returns are applied to TAIEX open-to-open returns as a gross proxy for intended TXF trading.

## Parameter search
Searched 100 combinations:
- Bull multiplier: 3.0 to 4.0
- Neutral multiplier: 2.0 to 3.0
- Bear multiplier: 0.25 to 1.0

Constraint: MDD must remain within 40% for since-00685L-listing, 5Y and 3Y windows.
47 combinations passed.

### Best simple robust candidate
**3 / 3 / 0.25**
- Bull: 3x
- Neutral: 3x
- Bear: 0.25x

This means the strategy no longer reduces leverage during the neutral transition state; it only cuts aggressively when both conditions are bearish.

Since 00685L listing (2017-03-30):
- Total return: **+1043.4%**
- CAGR: **29.4%**
- MDD: **-35.5%**
- Calmar: **0.83**
- Average gross exposure: **1.34x**
- Maximum exposure: **3.0x**
- Exposure >2x: **33.2%** of trading days
- Any exposure: **75.6%** of trading days

Previous 3 / 2 / 0.5 version:
- Total return: +649.7%
- CAGR: 23.8%
- MDD: -34.6%
- Calmar: 0.69
- Average exposure: 1.21x

00685L since listing:
- Total return: +2725.8%
- CAGR: 42.4%
- MDD: -54.8%
- Calmar: 0.77

TAIEX synthetic daily 2x since listing:
- Total return: +1453.7%
- CAGR: 33.6%
- MDD: -54.8%
- Calmar: 0.61

## Nearby parameter plateau
The result is not isolated to one exact point. Several nearby settings remain strong under the 40% MDD cap:

| Bull/Neutral/Bear | Since listing return | CAGR | MDD | Calmar | 5Y return | 5Y MDD |
|---|---:|---:|---:|---:|---:|---:|
| 3.00/3.00/0.25 | +1043.4% | 29.4% | -35.5% | 0.83 | +504.0% | -30.8% |
| 3.25/3.00/0.25 | +1125.1% | 30.4% | -37.1% | 0.82 | +536.3% | -32.5% |
| 3.50/3.00/0.25 | +1209.3% | 31.3% | -38.7% | 0.81 | +569.0% | -34.2% |
| 3.00/2.75/0.25 | +933.0% | 28.0% | -34.7% | 0.81 | +458.0% | -30.3% |

The chosen 3/3/0.25 version is preferred because it uses round rules, caps maximum leverage at the existing 3x ceiling, and has the best Calmar among the higher-return candidates.

## Stress tests

| Window | C 3/3/0.25 return / MDD | Old C 3/2/0.5 | TAIEX 1x | TAIEX daily 2x | 00685L |
|---|---:|---:|---:|---:|---:|
| 2018 selloff | -7.4% / -15.2% | -4.6% / -10.8% | -8.6% / -15.8% | -18.5% / -30.7% | -12.0% / -27.1% |
| COVID 2020 | +10.2% / -33.4% | +16.3% / -28.1% | +22.8% / -28.7% | +44.2% / -50.1% | +64.3% / -50.8% |
| 2022 bear | -11.4% / -18.2% | -16.5% / -18.8% | -22.4% / -31.6% | -42.1% / -54.8% | -33.6% / -48.9% |
| 2025–2026 | +172.5% / -29.9% | +137.4% / -25.9% | +99.1% / -26.7% | +251.0% / -47.5% | +227.9% / -49.8% |

## Subperiod stability

| Period | C 3/3/0.25 CAGR / MDD / Calmar | Old C | TAIEX 1x | TAIEX 2x | 00685L |
|---|---:|---:|---:|---:|---:|
| 2017–2020 | 8.5% / -35.5% / 0.24 | 8.2% / -34.6% / 0.24 | 11.3% / -28.7% / 0.39 | 21.1% / -50.1% / 0.42 | 34.4% / -50.8% / 0.68 |
| 2021–2023 | 36.4% / -19.5% / 1.86 | 28.8% / -18.8% / 1.53 | 6.8% / -31.6% / 0.22 | 11.0% / -54.8% / 0.20 | 21.9% / -48.9% / 0.45 |
| 2024–2026 | 56.6% / -30.8% / 1.83 | 43.1% / -28.5% / 1.51 | 41.6% / -28.7% / 1.45 | 88.6% / -52.0% / 1.70 | 83.5% / -54.8% / 1.52 |

## Interpretation
The 3/3/0.25 rule materially improves return versus 3/2/0.5 while only slightly worsening long-history MDD. It reaches the desired broad target of roughly +1000% cumulative return with mid-30% historical drawdown.

However, it is not universally superior. During 2017–2020 and the COVID crash, permanent 2x exposure and 00685L recovered faster and produced higher returns, while the new C version still experienced a roughly -35% drawdown. The strongest advantage appears in 2021–2023, where dynamic de-leveraging during the 2022 bear market materially improved risk-adjusted performance.

This is still an in-sample refinement. It should not be treated as a validated production TXF strategy until walk-forward testing, realistic TXF roll/cost/margin modeling, and parameter sensitivity around the grid and MA60 rules are completed.
