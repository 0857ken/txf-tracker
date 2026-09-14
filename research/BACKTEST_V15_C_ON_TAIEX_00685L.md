# Backtest v1.5 — C signals applied to TAIEX proxy vs 00685L

Data through: 2026-09-14

00685L official listing date: 2017-03-30. The C strategy still derives its grid and MA60 regime signals from 0050, but returns are now applied to TAIEX open-to-open returns as a gross proxy for trading TXF. This is closer to the intended TXF use case than applying the leverage directly to 0050 returns.

| Window | Strategy | Total | CAGR | MDD | Calmar |
|---|---|---:|---:|---:|---:|
| 1Y | C signals -> TAIEX proxy | +79.0% | 80.2% | -25.9% | 3.09 |
| 1Y | TAIEX 1x | +80.9% | 81.2% | -16.4% | 4.97 |
| 1Y | TAIEX daily 2x synthetic | +204.4% | 205.6% | -31.1% | 6.60 |
| 1Y | 00685L | +177.3% | 178.2% | -33.3% | 5.35 |
| 3Y | C signals -> TAIEX proxy | +144.0% | 34.7% | -28.5% | 1.22 |
| 3Y | TAIEX 1x | +172.9% | 39.7% | -28.7% | 1.38 |
| 3Y | TAIEX daily 2x synthetic | +529.0% | 84.6% | -52.0% | 1.63 |
| 3Y | 00685L | +474.0% | 79.0% | -54.8% | 1.44 |
| 5Y | C signals -> TAIEX proxy | +316.4% | 33.1% | -28.5% | 1.16 |
| 5Y | TAIEX 1x | +163.1% | 21.3% | -31.6% | 0.67 |
| 5Y | TAIEX daily 2x synthetic | +453.3% | 40.8% | -54.8% | 0.75 |
| 5Y | 00685L | +515.5% | 43.8% | -54.8% | 0.80 |
| Since 00685L listing | C signals -> TAIEX proxy | +649.7% | 23.8% | -34.6% | 0.69 |
| Since 00685L listing | TAIEX 1x | +365.7% | 17.7% | -31.6% | 0.56 |
| Since 00685L listing | TAIEX daily 2x synthetic | +1453.7% | 33.6% | -54.8% | 0.61 |
| Since 00685L listing | 00685L | +2725.8% | 42.4% | -54.8% | 0.77 |

## Interpretation
- When C signals are actually applied to the TAIEX proxy, performance is weaker than the earlier version that applied leverage to 0050 itself.
- C still clearly beats 1x TAIEX over 5Y and since 00685L listing, while keeping MDD near one-times-index levels.
- C does not beat permanent 2x exposure (00685L or theoretical 2x TAIEX) on raw return.
- Over 5Y, C delivers +316.4% with -28.5% MDD, versus 00685L +515.5% with -54.8% MDD.
- Since 00685L listing, C delivers +649.7% with -34.6% MDD, versus 00685L +2725.8% with -54.8% MDD.
- The strategy's value, if any, is as a drawdown-reduced dynamic leverage approach, not as a replacement for permanent 2x exposure when maximizing terminal wealth is the only goal.
