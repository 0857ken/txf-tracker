# Backtest v1.22 — 500% / 600% / 700% Reserve Comparison

Date: 2026-09-15
Branch: `backtest-v1`
Workflow run: 34993514384

## Frozen setup
- Start capital NT$1,000,000.
- Frozen 0050 signal and 0.5x / 1.0x / 1.5x / 2.0x exposure states.
- Actual historical TAIFEX TX / MTX / TMF regular-session contract prices.
- 1 point slippage per contract side; commissions and futures tax unchanged.
- External cash earns 1.5% gross; futures-account cash earns 0%.
- Monthly outward sweep plus emergency inward top-up.
- Broker-style ratio = futures-account equity / required initial margin.
- External cash does not count toward the ratio until transferred.
- Intraday proxy uses the position held from the prior close and the regular-session daily low; no same-day transfer rescue is assumed.

## Main results

| Reserve target | Terminal wealth | CAGR | MDD | Calmar | Cum. external interest | Avg. external share | Transfer count | Minimum close ratio | Minimum intraday proxy | 2x-margin shock minimum close | 2x-margin shock minimum intraday |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500% | NT$32,690,742 | 44.58% | -37.87% | 1.177 | NT$285,263 | 45.72% | 435 | 500.00% | 268.92% | 250.00% | 134.46% |
| 600% | NT$32,400,258 | 44.44% | -37.88% | 1.173 | NT$194,845 | 35.55% | 441 | 556.78% | 368.92% | 278.39% | 184.46% |
| 700% | NT$32,352,698 | 44.42% | -37.98% | 1.169 | NT$115,679 | 25.87% | 431 | 557.16% | 468.92% | 278.58% | 234.46% |

## 2x margin-shock intraday safety

| Reserve target | Minimum intraday ratio | Days below 250% | Days below 200% | Days below 150% | Days below 100% | Days below maintenance-trigger equivalent |
|---:|---:|---:|---:|---:|---:|---:|
| 500% | 134.46% | 550 | 11 | 1 | 0 | 0 |
| 600% | 184.46% | 11 | 1 | 0 | 0 | 0 |
| 700% | 234.46% | 1 | 0 | 0 | 0 | 0 |

The worst intraday observation for all three candidates remained 2017-08-03, the historical flash-crash day. The historical maintenance-trigger-equivalent ratio on that position was about 77.11%.

## Marginal trade-off
- 500% -> 600%: terminal wealth -NT$290,484; CAGR -0.136 percentage points; 2x-shock minimum intraday ratio +50.00 percentage points; cumulative external interest -NT$90,418.
- 600% -> 700%: terminal wealth -NT$47,560; CAGR -0.022 percentage points; 2x-shock minimum intraday ratio +50.00 percentage points; cumulative external interest -NT$79,166.
- 500% -> 700%: terminal wealth -NT$338,044; CAGR about -0.159 percentage points; 2x-shock minimum intraday ratio +100.00 percentage points.

## Versus frozen 00685L benchmark
Reference: terminal NT$31,700,514; CAGR 44.1%; MDD -36.8%; Calmar 1.20.

- 500%: terminal +NT$990,228; CAGR +0.477pp; MDD about 1.07pp deeper; Calmar -0.023.
- 600%: terminal +NT$699,744; CAGR +0.341pp; MDD about 1.08pp deeper; Calmar -0.027.
- 700%: terminal +NT$652,184; CAGR +0.318pp; MDD about 1.18pp deeper; Calmar -0.031.

## Important feasibility observation
A reserve *target* above roughly the portfolio's all-cash-in-futures capacity is not always attainable without reducing market exposure. On 2025-06-02, both the 600% and 700% variants had already moved all available external cash into the futures account, yet the close broker ratios were only 556.78% and 557.16% respectively. Therefore these variants should be interpreted as "try to retain 600% / 700% when possible, capped by available total strategy equity," not as hard guaranteed floors.

If a hard 600% or 700% minimum ratio is required at all times, the next design must reduce contract exposure when total equity cannot support the required reserve level. That would be a genuine risk-rule change and should be separately pre-registered before testing.

## Data consistency note
This v1.22 run downloaded 30,065 contract-day rows, matching the stable v1.17/v1.19 data count. The earlier v1.21 run happened to report 29,981 rows from the TAIFEX pull, so its 500% headline terminal value differed slightly. For an apples-to-apples 500/600/700 comparison, use the v1.22 results above because all three candidates were run in the same workflow against the same 30,065-row dataset.

## Interpretation
For a user who explicitly prioritizes margin safety, the 700% target gives the strongest safety trade-off among the three tested levels: compared with 600%, it sacrifices only about 0.022 percentage points of CAGR and NT$47,560 of terminal wealth, while lifting the 2x-margin-shock minimum intraday ratio by 50 percentage points, from 184.46% to 234.46%.

This is a capital-management comparison only. No signal, MA, roll, sizing, slippage, or performance threshold was tuned after seeing the result.
