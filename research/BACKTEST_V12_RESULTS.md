# Backtest v1.2 — C Strategy Regime Filter Search

Data through: 2026-09-14

## Goal
Test whether the C monthly-volatility strategy can beat 0050 while reducing the drawdown of fixed 2.5x–3x leverage.

## Regime rule
Use the 60-day moving average as a leverage regime filter.

- Bull: close > MA60 **and** MA60 > MA60 20 trading days ago.
- Neutral: exactly one of those two conditions is true.
- Bear: neither condition is true.

The base C position remains the same: -3% / -6% / -9% drawdown from the month-running high maps to 20% / 50% / 100% base exposure. The regime multiplier is applied on top of that base exposure.

## Strongest candidate: MA60 3x / 2x / 0.5x

| Period | 0050 B&H | Candidate return | Candidate MDD |
|---|---:|---:|---:|
| 5Y | +249.1% / -33.8% MDD | **+443.7%** | **-30.9%** |
| 10Y | +754.5% / -33.8% MDD | **+913.2%** | **-31.4%** |

10Y CAGR: 26.1%
10Y return/MDD: 29.11
Average gross exposure: 1.15x
Maximum exposure: 3.0x

## Nearby candidates

| Regime multiplier | 5Y Return / MDD | 10Y Return / MDD | 10Y avg exposure |
|---|---:|---:|---:|
| 3 / 2 / 1.0 | +403.5% / -30.9% | +929.3% / -34.6% | 1.22x |
| 3 / 2 / 0.75 | +424.2% / -30.9% | +924.1% / -33.0% | 1.19x |
| **3 / 2 / 0.5** | **+443.7% / -30.9%** | **+913.2% / -31.4%** | **1.15x** |
| 2.5 / 2 / 0.5 | +386.1% / -26.0% | +759.6% / -30.7% | 1.03x |

## Interpretation
The improvement does not come from increasing leverage further. It comes from using high leverage only when trend conditions are favorable and sharply reducing leverage when both price and MA60 indicate a bearish regime.

For the 3 / 2 / 0.5 candidate, effective exposure at the three C grid levels is:

- Bull: 60% / 150% / 300%
- Neutral: 40% / 100% / 200%
- Bear: 10% / 25% / 50%

This substantially limits exposure while the market is in a falling trend, while preserving aggressive exposure during recoveries and bull trends.

## Important caution
This is an in-sample parameter search over the same historical data used to evaluate the candidate. The result is promising but **not yet validated**. Before treating it as a usable strategy, run walk-forward / out-of-sample tests, crisis-period checks, parameter sensitivity tests, and realistic cost / futures implementation tests.
