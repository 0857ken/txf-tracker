# Backtest v1.10–v1.11 — 00685L recovery-triggered add-back

Data through: 2026-09-15

## Strategy concept
Use 0050 only as the regime/recovery signal and hold 00685L as the traded asset.

Confirmed bear condition:
- 0050 close <= MA60, and
- MA60 <= MA60 from 20 trading days earlier.

Base tactical rule:
- Outside confirmed bear: 100% 00685L.
- Confirmed bear: 25% 00685L.

Recovery-trigger variants add exposure only after price shows recovery while the confirmed-bear condition is still active. If recovery fails, allocation can dynamically fall back again.

## v1.10 screening result
13 simple recovery variants were tested. All stayed within a historical MDD of about 36.8% in this sample.

Best simple candidate:

> **Normal / non-bear: 100% 00685L**  
> **Confirmed bear: 25% 00685L**  
> **Still bear but 0050 closes above MA10: 50% 00685L**  
> **Still bear but 0050 closes above MA20: 75% 00685L**  
> **Bear condition ends: 100% 00685L**

Since 00685L listing:
- Total return: **+3277.5%**
- CAGR: **45.1%**
- MDD: **-36.8%**
- Calmar: **1.22**
- Average 00685L allocation: **91%**

00685L buy-and-hold over the same framework:
- Total return: **+2711.3%**
- CAGR: **42.3%**
- MDD: **-54.8%**
- Calmar: **0.77**

Base 100% / 25% rule without recovery add-back:
- Total return: **+2313.9%**
- CAGR: **40.0%**
- MDD: **-36.8%**
- Calmar: **1.09**

### Nearby recovery variants
| Rule | Total | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|
| MA10 -> 50%, MA20 -> 75% | +3277.5% | 45.1% | -36.8% | 1.22 |
| Rebound 5% -> 50%, plus MA20 -> 75% | +3093.1% | 44.2% | -36.8% | 1.20 |
| Rebound 5% -> 50%, rebound 8% -> 75% | +3088.5% | 44.2% | -36.8% | 1.20 |
| Rebound 5% OR MA20 -> 50% | +2830.4% | 42.9% | -36.8% | 1.16 |
| MA10 -> 50% only | +2734.3% | 42.4% | -36.8% | 1.15 |

## Stress windows — MA10/MA20 recovery rule vs 00685L buy-and-hold
| Window | Tactical return | Tactical MDD | 00685L return | 00685L MDD |
|---|---:|---:|---:|---:|
| 2018 | -22.3% | -29.7% | -12.9% | -27.1% |
| COVID 2020 | +69.3% | -34.7% | +62.8% | -50.8% |
| 2022 | -13.3% | -27.2% | -34.1% | -48.9% |
| 2025–2026 | +294.1% | -33.3% | +233.6% | -49.8% |

2018 is a clear weakness: the filter/recovery process whipsawed and did worse than simple buy-and-hold. The main benefit appears in large or persistent selloffs such as 2020 and 2022.

## v1.11 anchored walk-forward
Candidate rules were selected using only the training window, maximizing training CAGR subject to training MDD <= 40%, then applied to the next unseen period.

| Fold | Train | Test | Selected rule | Test total | Test CAGR | Test MDD | Base 100/25 test | 00685L test |
|---|---|---|---|---:|---:|---:|---:|---:|
| F1 | 2017–2018 | 2019–2020 | MA10 50 / MA20 75 | +178.8% | 67.1% | -34.7% | +148.5% | +176.0% |
| F2 | 2017–2020 | 2021–2022 | MA10 50 / MA20 75 | +28.7% | 13.6% | -27.2% | +11.3% | +9.9% |
| F3 | 2017–2022 | 2023–2024 | MA10 50 / MA20 75 | +154.6% | 59.8% | -36.8% | +157.8% | +158.2% |
| F4 | 2017–2024 | 2025–2026 | MA10 50 / MA20 75 | +285.0% | 121.0% | -33.3% | +266.7% | +225.9% |

The same MA10/MA20 recovery rule was selected in all four anchored folds.

Chained pseudo-out-of-sample, 2019–2026-09-15:

| Strategy | Total | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|
| Adaptive recovery walk-forward | **+3416.4%** | **58.8%** | **-36.8%** | **1.60** |
| Base 100/25 | +2515.2% | 52.8% | -36.8% | 1.43 |
| 00685L buy-and-hold | +2451.6% | 52.3% | -54.8% | 0.95 |

## Interpretation and caveats
This result strongly supports the user's concept of combining 00685L with trend-based de-risking and recovery-based add-back. The recovery rule improved participation in rebounds without giving back the large drawdown reduction seen in the 100%/25% regime rule.

However, this is **not pristine researcher-level out-of-sample evidence**. The family of recovery rules was itself designed after looking at the historical data. The walk-forward exercise only protects against parameter selection within each fold; it cannot erase researcher data-snooping that occurred before the candidate family was defined.

Other caveats:
- Signals use 0050 adjusted prices; traded returns use 00685L adjusted close-to-close returns with a one-day signal lag.
- No transaction tax, commissions, slippage, or cash interest.
- Historical MDD is not a future drawdown guarantee.
- 00685L is a daily-reset leveraged ETF, so results are specific to its path dependence and are not identical to constant-notional TXF leverage.

The next useful validation is to **freeze the MA10/MA20 rule** and test realistic trading frictions, turnover, delayed execution, MA sensitivity (e.g. 8/10/12 and 18/20/22), and a stricter holdout / future live-forward period without further rule changes.
