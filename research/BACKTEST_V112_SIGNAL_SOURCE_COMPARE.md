# Backtest v1.12 — 0050 vs TAIEX signal source comparison

Data: 2017-03-30 to 2026-09-15

## Frozen strategy rule
Traded asset: 00685L. Only the signal source changes.

- Non-bear: 100% 00685L
- Confirmed bear: 25% 00685L
- Still bear + close > MA10: 50% 00685L
- Still bear + close > MA20: 75% 00685L
- Bear ends: 100% 00685L
- Confirmed bear = close <= MA60 and MA60 <= MA60 20 trading days earlier
- Signal at close, applied with one-day lag
- Returns use adjusted close-to-close 00685L returns
- No fees, tax, slippage, or cash interest

## Main result

| Signal source | Total | CAGR | MDD | Calmar | Avg allocation | State switches |
|---|---:|---:|---:|---:|---:|---:|
| 0050 | +3257.2% | 45.0% | -36.8% | 1.22 | 91.1% | 117 |
| **TAIEX** | **+3883.1%** | **47.6%** | **-36.8%** | **1.29** | 90.1% | 131 |
| 00685L buy & hold | +2694.4% | 42.2% | -54.8% | 0.77 | 100% | - |

TAIEX produced the stronger full-sample result without increasing historical MDD, though it switched state more often.

## Stress / subperiod comparison

| Window | 0050 total | 0050 MDD | TAIEX total | TAIEX MDD | 00685L total | 00685L MDD |
|---|---:|---:|---:|---:|---:|---:|
| 2018 | -21.7% | -29.7% | **-16.3%** | **-26.6%** | -12.0% | -27.1% |
| COVID 2020 | +70.9% | -34.7% | **+88.1%** | **-28.3%** | +64.3% | -50.8% |
| 2022 | **-12.7%** | **-27.2%** | -16.4% | -30.3% | -33.6% | -48.9% |
| 2023–2024 | **+154.6%** | -36.8% | +143.7% | -36.8% | +158.2% | -36.8% |
| 2025–2026 | **+283.0%** | -33.3% | +269.5% | -33.3% | +224.2% | -49.8% |

Rolling windows ending 2026-09-15:

| Window | 0050 total | 0050 CAGR | 0050 MDD | TAIEX total | TAIEX CAGR | TAIEX MDD |
|---|---:|---:|---:|---:|---:|---:|
| 3Y | **+560.9%** | **87.6%** | -36.8% | +533.5% | 85.0% | -36.8% |
| 5Y | **+788.1%** | **54.8%** | -36.8% | +736.3% | 52.9% | -36.8% |

## How different were the signals?

- Different target allocation on 162 of 2,302 trading days: **7.04%**
- Confirmed-bear classification differed on 126 of 2,302 days: **5.47%**
- Mean absolute allocation difference: **3.41 percentage points**
- On days when allocations differed: 0050 version had the higher daily return on 45 days, TAIEX on 51 days, and 66 were ties
- TAIEX version switched allocation state 131 times vs 117 for 0050
- Current 2026-09-15 target: both signal sources = **100%**

## Interpretation

The signal source matters, but not on most days: more than 92% of trading days had the same target allocation. TAIEX was materially better over the full sample, especially in COVID 2020 and 2018, while 0050 was better in 2022 and the more recent 3Y/5Y windows.

Because 00685L tracks a leveraged Taiwan capitalization-weighted index exposure, TAIEX is conceptually the cleaner underlying signal source. The stronger full-history result also supports using TAIEX as the leading candidate. However, this comparison itself was performed after the strategy family had already been developed, so choosing TAIEX solely because its backtest is better would introduce another layer of researcher selection bias.

A defensible rule-freezing decision would be: choose TAIEX because of instrument alignment, not because it won this backtest, and then freeze it for forward testing from 2026-09-16 onward.
