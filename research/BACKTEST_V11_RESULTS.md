# Backtest v1.1 — Leverage Stress Test

Data through: 2026-09-14

## Assumptions
- A/B use TAIEX as a 1x proxy for TXF.
- C uses 0050 directly.
- Strategy signals are unchanged from Backtest v1.0.
- Leverage multiplies daily strategy exposure: 1.5x / 2.0x / 2.5x / 3.0x.
- Signals are evaluated after the close and applied from next session's open.
- Results are gross: no fees, tax, slippage, futures roll/basis, financing, margin calls or forced liquidation.
- Benchmark is 0050 buy-and-hold on auto-adjusted prices.

## Does leverage beat 0050 on cumulative return?

| Period | 0050 B&H | A 3x | B 3x | C 1.5x | C 2x | C 2.5x | C 3x |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1Y | +94.8% | +68.4% | +87.6% | +43.6% | +60.2% | +77.7% | **+96.0%** |
| 3Y | +260.9% | +59.5% | **+286.8%** | +114.0% | +163.8% | +217.8% | **+274.0%** |
| 5Y | +249.1% | +2.3% | +159.1% | +156.0% | +225.3% | **+297.8%** | **+368.2%** |
| 10Y | +754.5% | +44.9% | +438.6% | +405.6% | +679.7% | **+1038.0%** | **+1470.5%** |

## Maximum drawdown comparison

| Period | 0050 B&H | A 3x | B 3x | C 2x | C 2.5x | C 3x |
|---|---:|---:|---:|---:|---:|---:|
| 1Y | -15.4% | -33.7% | -29.9% | -20.4% | -24.9% | -29.3% |
| 3Y | -27.5% | -57.1% | -55.4% | -35.5% | -42.9% | -49.8% |
| 5Y | -33.8% | -65.6% | -63.7% | -50.7% | -59.4% | -66.8% |
| 10Y | -33.8% | -68.8% | -63.7% | -50.7% | -59.4% | -66.8% |

## Key observations
1. A (Yao nine-turn/extreme) never beats 0050, even at 3x. Over 5Y/10Y, adding leverage hurts due to poor timing and volatility drag.
2. B (Orange Taro three-line) only beats 0050 in the 3Y window at 3x; it does not beat over 1Y, 5Y or 10Y.
3. C (monthly-volatility grid) is the only strategy that consistently crosses above 0050 when leverage is high enough.
4. C at 2x does not beat 0050 in any tested 1Y/3Y/5Y/10Y window. It comes closest over 10Y: +679.7% vs 0050 +754.5%.
5. C at 2.5x beats 0050 over 5Y and 10Y, but not over 1Y or 3Y.
6. C at 3x beats 0050 on cumulative return in all four windows: 1Y, 3Y, 5Y and 10Y.
7. The cost is much larger drawdown. Over 10Y, C 3x reaches -66.8% MDD versus -33.8% for 0050.
8. Risk-adjusted comparison still favors 0050 in most windows. On 10Y return/MDD, 0050 is 22.30 versus C 3x at 22.01; on shorter windows 0050 remains clearly superior.
