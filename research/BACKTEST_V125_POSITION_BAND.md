# Backtest v1.25 — Position No-Trade Band

Date: 2026-09-16
Branch: `backtest-v1`
Workflow run: `35057620430`
Job: `104670987295`

## Frozen setup
The 0050 signal, MA rules, exposure states, futures denomination/roll rules, plain 500% reserve rule, 1-point slippage, and 1.5% external-cash yield are unchanged. Only same-signal/same-contract integer-contract rebalancing is suppressed when realized exposure is within the tested absolute band around target. Signal changes and rolls always execute.

Dataset: 30,065 rows; SHA-256 `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`.

## Results

| Position band | Terminal wealth | CAGR | MDD | Calmar | Contract sides | Modeled transaction costs | Trading days with quantity changes | Mean abs tracking error | P95 abs tracking error | Max abs tracking error | Min close ratio | Min next-open ratio |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.000x | NT$32,690,742 | 44.577% | -37.866% | 1.177 | 1,992 | NT$277,431 | 608 | 0.0647x | 0.1966x | 0.2221x | 500.000% | 368.975% |
| 0.025x | NT$32,732,518 | 44.597% | -37.866% | 1.178 | 1,699 | NT$262,092 | 474 | 0.0654x | 0.1966x | 0.2221x | 500.000% | 368.975% |
| 0.050x | NT$32,751,165 | 44.605% | -37.750% | 1.182 | 1,481 | NT$251,332 | 383 | 0.0672x | 0.1966x | 0.2221x | 500.000% | 368.975% |
| 0.075x | NT$32,217,568 | 44.354% | -37.810% | 1.173 | 1,412 | NT$245,937 | 344 | 0.0693x | 0.1966x | 0.2221x | 500.000% | 368.975% |
| 0.100x | NT$31,303,935 | 43.916% | -38.045% | 1.154 | 1,267 | NT$231,773 | 311 | 0.0713x | 0.1966x | 0.2221x | 500.000% | 368.975% |

## Operational interpretation
The 0.050x band is the cleanest elbow in the pre-registered set. Relative to no band, it reduces contract sides by about 25.7% and quantity-change trading days by about 37.0%, while mean absolute exposure tracking error rises only from 0.0647x to 0.0672x. The P95 and maximum tracking errors are essentially unchanged because integer contract granularity already dominates the tail error.

The small historical performance improvement at 0.025x/0.050x must not be treated as new alpha; it is path-dependent and was observed after costs. At 0.075x and especially 0.100x, delayed resizing begins to create meaningful performance drag despite lower transaction costs.

Therefore ±0.05x is the preferred operational position no-trade band from this frozen comparison.