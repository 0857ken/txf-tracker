# Backtest v1.13 — practical stress test

Data: 2017-03-30 to 2026-09-15

This test follows the pre-registered protocol in `research/V113_PROTOCOL.md`. Signal source is frozen to **0050**. Traded asset is **00685L**.

## Frozen central rule
- Non-bear: 100% 00685L.
- Confirmed bear: 25%.
- Still confirmed bear + 0050 close > MA10: 50%.
- Still confirmed bear + 0050 close > MA20: 75%.
- Bear ends: 100%.
- Confirmed bear = 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Signal known at close, central execution lag = 1 trading day.

## Friction assumptions
Applied to allocation turnover:
- Low: commission 0.03%, sell tax 0.10%, slippage 0.02%.
- Base: commission 0.05%, sell tax 0.10%, slippage 0.03%.
- Conservative: commission 0.1425%, sell tax 0.10%, slippage 0.05%.

Uninvested cash earns 0%. Adjusted-close 00685L returns are used. No separate fund fee is added.

## Central MA10/20 results
| Scenario | Total | CAGR | MDD | Calmar | Turnover x capital | Allocation changes | Sum modeled costs | Avg allocation |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gross | +3257.2% | 45.0% | -36.8% | 1.22 | 44.50 | 118 | 0.0% | 91.1% |
| Low friction | +3112.7% | 44.3% | -36.8% | 1.20 | 44.50 | 118 | 4.4% | 91.1% |
| **Base friction** | **+3070.1%** | **44.1%** | **-36.8%** | **1.20** | 44.50 | 118 | 5.7% | 91.1% |
| **Conservative friction** | **+2915.2%** | **43.3%** | **-36.8%** | **1.18** | 44.50 | 118 | 10.7% | 91.1% |

The strategy remained comfortably above the pre-registered return threshold even under the conservative cost model.

## MA-neighborhood sensitivity — base friction, 1-day lag
| Fast / slow | Total | CAGR | MDD | Calmar | Turnover | Changes |
|---|---:|---:|---:|---:|---:|---:|
| MA8 / MA18 | +3015.5% | 43.8% | -36.8% | 1.19 | 50.0 | 133 |
| MA8 / MA20 | +3053.0% | 44.0% | -36.8% | 1.19 | 46.5 | 125 |
| MA8 / MA22 | +3086.5% | 44.2% | -36.8% | 1.20 | 44.5 | 121 |
| MA10 / MA18 | +3032.3% | 43.9% | -36.8% | 1.19 | 48.0 | 126 |
| **MA10 / MA20** | **+3070.1%** | **44.1%** | **-36.8%** | **1.20** | 44.5 | 118 |
| MA10 / MA22 | +3107.3% | 44.3% | -36.8% | 1.20 | 42.5 | 113 |
| MA12 / MA18 | +3115.3% | 44.3% | -36.8% | 1.20 | 47.0 | 118 |
| MA12 / MA20 | +3154.1% | 44.5% | -36.8% | 1.21 | 43.5 | 113 |
| MA12 / MA22 | +3192.3% | 44.7% | -36.8% | 1.21 | 41.5 | 108 |

Across all 9 nearby parameter combinations:
- CAGR range: **43.8% to 44.7%**
- Median CAGR: **44.2%**
- MDD for all combinations: **-36.8%**
- Calmar range: **1.19 to 1.21**

This is a strong robustness result: MA10/20 is not a narrow isolated optimum.

## Execution-delay stress — central MA10/20, base friction
| Delay | Total | CAGR | MDD | Calmar |
|---:|---:|---:|---:|---:|
| **1 trading day** | **+3070.1%** | **44.1%** | **-36.8%** | **1.20** |
| 2 trading days | +2917.2% | 43.3% | -37.3% | 1.16 |
| 3 trading days | +2608.3% | 41.7% | -40.8% | 1.02 |

A one-day extra delay has only modest impact. A three-day delay materially worsens drawdown and return, but the result remains far from collapse.

## Stress windows — central MA10/20, base friction
| Window | Tactical total | Tactical MDD | 00685L B&H total | 00685L B&H MDD |
|---|---:|---:|---:|---:|
| 2018 | -23.3% | -31.1% | -12.0% | -27.1% |
| COVID 2020 | +70.4% | -34.8% | +64.3% | -50.8% |
| 2022 | -13.9% | -28.2% | -33.6% | -48.9% |
| 2023–2024 | +153.4% | -36.8% | +158.2% | -36.8% |
| 2025–2026 | +281.5% | -33.3% | +224.2% | -49.8% |

2018 remains the main weakness: whipsaw can make the tactical rule worse than buy-and-hold in a choppy decline. Persistent or violent selloffs such as 2020 and 2022 remain the environments where the rule adds the most value.

## Pre-registered gate
All four criteria passed:
1. Conservative-friction MA10/20 CAGR >=35% and MDD <=40%: **PASS** (43.3%, -36.8%).
2. At least 7/9 nearby MA combinations under base friction / 1-day lag have CAGR >=38% and MDD <=40%: **PASS (9/9)**.
3. MA10/20 under base friction / 2-day lag has CAGR >=35% and MDD <=42%: **PASS** (43.3%, -37.3%).
4. No nearby MA combination under base friction / 1-day lag has CAGR <30% or MDD worse than -45%: **PASS (0 failures)**.

**Overall v1.13 gate: PASS.**

## Interpretation
The 0050-signal tactical 00685L rule appears robust to reasonable transaction-friction assumptions, small MA perturbations, and a modest execution delay. The most important positive finding is not that MA10/20 is the best point; it is that the whole MA8–12 / MA18–22 neighborhood produces very similar results.

This is still historical research, not true live out-of-sample evidence. The next clean step should be to freeze the central rule and start forward tracking from 2026-09-16, while optionally running a paper portfolio. Avoid further parameter optimization unless a future pre-defined review rule is triggered.
