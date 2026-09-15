# Backtest v1.19 — Futures Free-Cash Yield Sensitivity

Date: 2026-09-15
Branch: `backtest-v1`

## Purpose
Test whether earning interest on capital not required as initial margin changes the v1.17 actual-futures comparison versus 00685L.

The 0050 signal, MA10/20/60 logic, 0.5x/1.0x/1.5x/2.0x exposure states, actual TAIFEX TX/MTX/TMF contract data, roll rule, integer sizing, user commissions, transaction tax and 1-point-per-side slippage are unchanged.

Only free equity above required initial margin earns interest. Posted initial margin earns 0%.

## Results

| Annual yield on free cash | Terminal value | Total return | CAGR | MDD | Calmar | Cumulative interest credited | Max initial-margin usage | Max maintenance usage | 2x margin-shock breach days |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.0% | NT$31,504,877 | +3050.49% | 44.01% | -38.24% | 1.15 | NT$0 | 17.93% | 13.76% | 0 |
| 1.5% | NT$35,290,991 | +3429.10% | 45.75% | -37.89% | 1.21 | NT$726,426 | 17.94% | 13.77% | 0 |
| 2.0% | NT$36,324,471 | +3532.45% | 46.20% | -37.79% | 1.22 | NT$991,316 | 17.92% | 13.75% | 0 |
| 3.0% | NT$37,901,820 | +3690.18% | 46.86% | -38.02% | 1.23 | NT$1,522,616 | 17.87% | 13.71% | 0 |

## Increment versus 0% cash yield
- 1.5% free-cash yield: terminal wealth +NT$3,786,114; CAGR +1.738 percentage points.
- 2.0% free-cash yield: terminal wealth +NT$4,819,594; CAGR +2.184 percentage points.
- 3.0% free-cash yield: terminal wealth +NT$6,396,943; CAGR +2.842 percentage points.

The terminal-wealth increase is larger than the cumulative cash interest line because credited interest also raises later account equity, target notional and subsequent futures P&L. This is a compounding effect rather than direct interest alone.

## Approximate break-even yields
Using the same actual-contract simulation with dynamic resizing:
- Annual free-cash yield required to approximately match the prior 00685L benchmark CAGR of 44.1%: **0.08%**.
- Annual free-cash yield required to reach the pre-registered futures replacement CAGR threshold of 44.6%: **0.65%**.

Because integer contract sizing makes the function mildly non-smooth, these are operational approximations rather than closed-form thresholds.

## Reference
- v1.17 actual futures, 1-point slippage, 0% cash yield: terminal NT$31,504,877; CAGR 44.01%; MDD -38.24%; Calmar 1.15.
- 00685L base-cost benchmark: terminal approximately NT$31,700,514; CAGR 44.1%; MDD -36.8%; Calmar 1.20.

At 1.5% gross yield on free cash, the futures version exceeds the prior 00685L benchmark on CAGR and reaches Calmar 1.21, while margin utilization remains essentially unchanged.

## Critical caveat
This is a **gross cash-yield sensitivity**, not a guaranteed investable net result. The cash sleeve assumes no tax, management fee, bid/ask spread, settlement delay, haircut, liquidity restriction or transfer delay. In practice, only a highly liquid low-risk cash-management vehicle that can be accessed quickly enough to meet futures margin needs should be considered comparable.

The result does not alter the signal strategy itself and does not retroactively change the v1.17 decision rules.
