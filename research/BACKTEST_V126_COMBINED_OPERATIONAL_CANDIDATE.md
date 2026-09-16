# Backtest v1.26 — Combined Operational Candidate

Date: 2026-09-16
Branch: `backtest-v1`
Workflow run: `35057843114`
Job: `104671637226`

## Candidate confirmed before run
- 500% broker-style reserve floor / emergency trigger remains unchanged.
- Refill and month-start reset target: **550%**.
- Position no-trade band: **±0.05x** when signal state and active futures month are unchanged.
- Signal changes and rolls always execute.
- External cash gross yield: 1.5%; futures-account cash yield: 0%.
- Base slippage: 1 point / contract side.
- All frozen 0050 signal and exposure rules unchanged.

Dataset: 30,065 rows; SHA-256 `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`.

## Result
- Terminal wealth: **NT$32,734,579**
- CAGR: **44.598%**
- MDD: **-37.750%**
- Calmar: **1.181**
- Contract transaction sides: **1,486**
- Modeled transaction costs: **NT$252,345**
- Trading days with quantity changes: **382**
- Mean absolute exposure tracking error: **0.0671x**
- P95 absolute tracking error: **0.1964x**
- Maximum absolute tracking error: **0.2219x**
- Minimum close broker-style ratio: **500.220%**
- Minimum next-regular-session opening ratio: **418.975%**
- Cumulative modeled external interest: **NT$249,874**

## Next-open margin requirement stress
Worst date remains 2025-04-07.

| Margin requirement multiplier | Minimum next-open ratio | Days below 250% | Days below 200% | Days below 150% | Days below 100% | Maintenance-equivalent breaches |
|---:|---:|---:|---:|---:|---:|---:|
| 1.2x | 349.146% | 0 | 0 | 0 | 0 | 0 |
| 1.5x | 279.317% | 0 | 0 | 0 | 0 | 0 |
| 2.0x | 209.487% | 41 | 0 | 0 | 0 | 0 |

## Versus plain 500% / no-position-band baseline
Baseline from v1.24/v1.25:
- terminal NT$32,690,742
- CAGR 44.577%-44.58%
- MDD -37.866%-37.87%
- contract sides 1,992
- modeled transaction costs NT$277,431
- quantity-change trading days 608
- minimum close ratio 500.000%
- minimum next-open ratio 368.975%

Combined candidate:
- contract sides fall by **506 (-25.4%)**;
- quantity-change days fall by **226 (-37.2%)**;
- modeled transaction costs fall by about **NT$25,086 (-9.0%)**;
- worst next-open ratio rises by **50.0 percentage points**;
- CAGR is essentially unchanged/slightly higher historically, but that small difference is not treated as alpha or as a reason for further tuning;
- MDD is slightly shallower in this sample.

## Interpretation
The two operational changes remain compatible when combined. The 550% refill reset supplies extra margin cushion without changing the 500% trigger, while the ±0.05x no-trade band materially reduces integer-contract churn without materially worsening exposure tracking. This is a reasonable candidate implementation for forward testing; it does not alter the underlying market-timing strategy.

Broker-specific house margin/risk rules and the exact external-yield vehicle remain live-deployment dependencies rather than solved by this historical test.