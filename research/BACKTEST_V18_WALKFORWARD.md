# Backtest v1.8 — Anchored walk-forward validation

Data through: 2026-09-14

## Method
- Signals: 0050 monthly-volatility grid + MA60 regime.
- Returns: TAIEX open-to-open as a gross proxy for intended TXF trading.
- Candidate leverage grid: bull 3.0–4.0, neutral 2.0–3.0, bear 0.25–1.0 (100 combinations).
- At each fold, parameters are selected using only the training period.
- Fixed selection objective: maximize training CAGR subject to training MDD <= 40%.
- The selected parameters are then applied to the next unseen test window.
- Benchmark: TAIEX 1x, synthetic daily 2x TAIEX, and live 00685L.
- The previously proposed 3/3/0.25 rule is also shown as a fixed reference, but it is not pristine out-of-sample because it was discovered using the full historical sample before this walk-forward exercise.

## Fold results

| Fold | Train | Test | Selected bull/neutral/bear | Train CAGR | Train MDD | Test total | Test CAGR | Test MDD | Fixed 3/3/0.25 total | Fixed MDD | TAIEX 1x | TAIEX 2x | 00685L |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F1 | 2015–2018 | 2019–2020 | 3.00 / 3.00 / 1.00 | 5.7% | -25.3% | +54.1% | 24.2% | -41.8% | +43.9% | -35.5% | +51.5% | +116.9% | +176.0% |
| F2 | 2015–2020 | 2021–2022 | 3.00 / 3.00 / 0.75 | 11.1% | -39.7% | +22.1% | 10.6% | -27.1% | +29.6% | -19.5% | -4.0% | -13.9% | +9.9% |
| F3 | 2015–2022 | 2023–2024 | 3.00 / 3.00 / 0.25 | 11.0% | -35.5% | +138.5% | 54.7% | -30.8% | +138.5% | -30.8% | +62.9% | +150.5% | +158.2% |
| F4 | 2015–2024 | 2025–2026 | 3.50 / 3.00 / 0.25 | 19.0% | -38.7% | +193.2% | 89.0% | -32.4% | +169.5% | -29.9% | +100.5% | +256.0% | +232.4% |

## Chained pseudo-out-of-sample results, 2019–2026-09-14

| Strategy | Total | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|
| Adaptive walk-forward | +1216.0% | 39.8% | -41.8% | 0.95 |
| Fixed 3/3/0.25 reference | +1098.7% | 38.1% | -35.5% | 1.07 |
| TAIEX 1x | +374.8% | 22.5% | -31.6% | 0.71 |
| TAIEX synthetic daily 2x | +1564.8% | 44.1% | -54.8% | 0.81 |
| 00685L | +2502.2% | 52.8% | -54.8% | 0.96 |

Selected sequence by fold:
1. 3.00 / 3.00 / 1.00
2. 3.00 / 3.00 / 0.75
3. 3.00 / 3.00 / 0.25
4. 3.50 / 3.00 / 0.25

## Interpretation
- The strict adaptive walk-forward path is promising but does **not** fully pass the desired <=40% drawdown criterion out of sample: the 2019–2020 test reached -41.8% even though its training MDD was only -25.3%.
- From 2021 onward, the selected rules kept test-window drawdowns in roughly the -27% to -32% range while materially outperforming TAIEX 1x.
- The training selections progressively moved toward a lower bear multiplier (1.00 -> 0.75 -> 0.25), which supports the idea that aggressive de-leveraging in confirmed bear regimes has value, but the evidence is not yet enough to claim 0.25 is universally optimal.
- The fixed 3/3/0.25 reference looks excellent over 2019–2026, but because it was discovered using the full sample it must not be described as clean out-of-sample validation.
- Adaptive walk-forward Calmar (0.95) is close to 00685L (0.96) with much lower MDD (-41.8% vs -54.8%), but 00685L still has much higher terminal wealth.
- This is a historical pseudo-out-of-sample exercise, not a live forward test. The next validation should reduce researcher degrees of freedom rather than optimize more parameters: lock a simple rule before a cutoff date, test only later years, add transaction/roll/slippage/margin assumptions, and test MA/grid sensitivity.
