# Backtest v1.16 — 0050 signal: 00685L vs TAIEX futures proxy

Data: 2017-03-30 through 2026-09-15. Starting capital: **NT$1,000,000**.

## Frozen strategy
Signal rules are unchanged:
- Signal source: 0050.
- Confirmed bear = 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Non-bear: 100% 00685L-equivalent.
- Confirmed bear: 25%.
- Still bear + close > MA10: 50%.
- Still bear + close > MA20: 75%.
- Bear ends: 100%.

For futures, the 00685L allocation states are mapped to target TAIEX notional exposure of **0.5x / 1.0x / 1.5x / 2.0x account equity**.

## Cost assumptions
User-supplied futures commission, single side:
- TX NT$38/contract
- MTX NT$19/contract
- TMF NT$16/contract

Other futures assumptions:
- futures transaction tax: 0.002% of contract notional per transaction side;
- base slippage: 1 index point per traded contract side, with 0- and 2-point sensitivity tests;
- monthly roll proxy on the trading day before the third Wednesday, charging a close and reopen transaction;
- unused cash interest = 0%.

ETF comparison retains v1.13 base friction: 0.05% commission, 0.10% sell tax and 0.03% slippage on traded allocation turnover.

## Important correction from v1.15
The first v1.15 futures test used the TAIEX **price index** as the futures return proxy. This systematically treats cash-index ex-dividend drops as direct long-futures losses and produced an overly pessimistic futures result. It is not used for the decision.

v1.16 instead uses the official TWSE **TAIEX total-return index** as the daily return proxy for directional futures exposure, while the TAIEX price level is used for contract notional and tax sizing. This is still a proxy rather than actual roll-adjusted TX contract history; exact futures basis and realized roll spread remain unmodeled.

## Main result

| Implementation | Terminal value | Total return | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|---:|
| 00685L, base costs | NT$31,700,514 | +3070.1% | 44.1% | -36.8% | 1.20 |
| Ideal continuous futures TR proxy | NT$36,764,662 | +3576.5% | 46.4% | -34.2% | 1.35 |
| **Futures, current TX/MTX/TMF toolkit, 1-point slip** | **NT$34,107,516** | **+3311.7%** | **45.2%** | **-34.2%** | **1.32** |
| Futures, historical contract availability, 1-point slip | NT$33,808,135 | +3281.8% | 45.1% | -34.6% | 1.30 |
| Old v1.15 price-index proxy (invalid for decision) | NT$18,743,131 | +1774.8% | 36.3% | -35.9% | 1.01 |

Under the corrected total-return proxy, the practical current-toolkit futures implementation beats the 00685L implementation by about **NT$2.41 million terminal wealth** from the same NT$1 million starting capital, raises historical CAGR from **44.1% to 45.2%**, and improves historical MDD from **-36.8% to -34.2%**.

The advantage is meaningful but not enormous: about **+1.1 percentage points of CAGR** in this model. It is therefore not correct to assume that removing the ETF fund fee alone creates a huge performance jump.

## Slippage sensitivity — current TX/MTX/TMF toolkit

| Slippage per side | Terminal value | CAGR | MDD | Calmar | Modeled total futures costs | Roll-cost component |
|---:|---:|---:|---:|---:|---:|---:|
| 0 points | NT$35,626,779 | 45.9% | -34.3% | 1.34 | NT$136,867 | NT$78,473 |
| **1 point** | **NT$34,107,516** | **45.2%** | **-34.2%** | **1.32** | **NT$274,305** | **NT$177,296** |
| 2 points | NT$32,463,030 | 44.5% | -34.3% | 1.29 | NT$416,249 | NT$268,995 |

At 1-point slippage, cost breakdown over the full sample:
- commissions: NT$57,438
- transaction tax: NT$66,647
- slippage: NT$150,220
- total: **NT$274,305**
- of total costs, monthly roll proxy contributed about **NT$177,296**.

Even at 2 points of slippage per contract side, the futures proxy still shows CAGR **44.5%**, slightly above the 00685L base-cost CAGR of 44.1%, with lower historical MDD.

## Stress periods

| Window | 00685L total | 00685L MDD | Futures TR proxy total | Futures MDD | Ideal TR proxy total | Ideal MDD |
|---|---:|---:|---:|---:|---:|---:|
| 2018 | -23.9% | -31.1% | -22.2% | -30.3% | -21.4% | -29.7% |
| COVID 2020 | +68.8% | -34.8% | +58.5% | -34.0% | +60.9% | -33.6% |
| 2022 | -14.5% | -28.2% | -18.6% | -30.7% | -18.1% | -30.5% |
| 2023–2024 | +150.4% | -36.8% | +173.7% | -34.2% | +176.1% | -34.2% |
| 2025–2026 | +290.2% | -33.3% | +342.5% | -30.1% | +345.9% | -30.1% |

The futures proxy does **not** dominate every subperiod. It lagged 00685L in 2020 and 2022, but was stronger in 2018 and especially 2023–2026. This supports treating the execution vehicle comparison as an efficiency question, not a guarantee that futures wins in every regime.

## NT$1,000,000 current contract examples
Using the 2026-09-15 TAIEX proxy close of 45,511.49 and current TMF contract size, the nearest simple micro-futures positions are:

| Strategy state | Target exposure | Target notional | TMF | Realized notional | Realized exposure | Current-margin diagnostic* |
|---|---:|---:|---:|---:|---:|---:|
| 25% equivalent | 0.5x | NT$500,000 | 1 | NT$455,115 | 0.455x | NT$31,800 |
| 50% equivalent | 1.0x | NT$1,000,000 | 2 | NT$910,230 | 0.910x | NT$63,600 |
| 75% equivalent | 1.5x | NT$1,500,000 | 3 | NT$1,365,345 | 1.365x | NT$95,400 |
| 100% equivalent | 2.0x | NT$2,000,000 | 4 | NT$1,820,460 | 1.820x | NT$127,200 |

At the current high index level, one TMF is roughly NT$455k notional, so an NT$1m account cannot hit 0.5/1/1.5/2x exactly. It is about 9% under target in each of these simple states. Across the historical simulation, mean absolute exposure tracking error was only about **1.4 percentage points of account equity** because account equity and contract combinations change over time.

*The margin figures use the current margin schedule only as a feasibility diagnostic; historical margin schedules were not modeled.

## Interpretation
This corrected proxy supports the user's hypothesis that futures can be a more capital- and cost-efficient execution vehicle than 00685L for the same frozen 0050 signal system. In this model, futures improves CAGR by roughly 1.1 percentage points and historical MDD by roughly 2.6 percentage points versus 00685L base-cost execution.

However, this is **not yet proof that actual TX/MTX/TMF trading will deliver the same advantage**. The return leg uses the TAIEX total-return index as a proxy rather than actual continuous futures contracts. Exact basis, actual monthly roll prices/spreads, intraday closing execution, and historical margin changes are not reproduced. The next decision-grade step is to obtain actual TX continuous/raw contract data and rerun the frozen strategy without changing the signal.

Until that actual-futures-data test is completed, 00685L remains the fully observed tradable benchmark and the futures result should be labeled **promising proxy evidence**, not final production evidence.
