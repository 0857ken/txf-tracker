# Backtest v1.24 — Operational Robustness

Date: 2026-09-16
Branch: `backtest-v1`
Successful workflow run: `35057368259`
Job: `104670242347`

## Scope
This diagnostic keeps the frozen 0050 signal, MA10/20/60 rules, 0.5x/1.0x/1.5x/2.0x exposure states, roll logic, contract denomination, commissions/tax, and the 500% broker-style reserve floor unchanged. It tests operational implementation only.

The pre-registered protocol is `research/V124_OPERATIONAL_ROBUSTNESS_PROTOCOL.md`.

## Data-integrity gate
- Sample: 2017-03-30 through 2026-09-15.
- Actual TAIFEX regular-session monthly TX / MTX / TMF contracts.
- Contract-day rows: **30,065**, exactly matching the frozen expected count.
- SHA-256 of sorted fields used in this run: `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`.
- Historical margin states/events: 57; two missing archive CSVs continue to use the previously documented official/manual reconstruction.

## Night-session / next-open interpretation
TAIFEX currently classifies TX, MTX, and TMF as after-hours-session products exempt from mandatory broker liquidation (`https://www.taifex.com.tw/cht/5/productsExemptedAH`). TAIFEX also states that after all general-session contracts have closed, it does not conduct intraday margin calls during 16:15 to 05:00 (`https://www.taifex.com.tw/cht/5/intradayMargingCall`). Broker house rules can still differ.

Therefore v1.24 focuses the new gap-risk audit on the **next regular-session actual open**: the position held from the prior regular-session close is marked to the following regular-session open, with no pre-open rescue from external cash.

## 500% baseline — next regular-session opening gap
Worst historical opening ratio:
- Date: **2025-04-07**
- Prior-close held position: TX 0 / MTX 3 / TMF 2, expiry 202504
- Effective position P&L from prior regular close to next regular open: **-10.02% of prior notional**
- Opening P&L: **-NT$362,950**
- Futures-account opening equity: **NT$962,840**
- Required initial margin: **NT$260,950**
- Maintenance margin: **NT$199,750**
- Broker-style opening ratio: **368.97%**
- Maintenance/initial equivalent: 76.55%
- No maintenance-equivalent breach occurred anywhere in the historical opening audit.

Opening-ratio stress if margin requirements were simultaneously multiplied without pre-open transfer:

| Margin multiplier | Minimum opening ratio | Days <250% | Days <200% | Days <150% | Days <100% | Maintenance-equivalent breaches |
|---:|---:|---:|---:|---:|---:|---:|
| 1.0x | 368.97% | 0 | 0 | 0 | 0 | 0 |
| 1.2x | 307.48% | 0 | 0 | 0 | 0 | 0 |
| 1.5x | 245.98% | 1 | 0 | 0 | 0 | 0 |
| 2.0x | 184.49% | 280 | 2 | 0 | 0 | 0 |

This opening-gap test is more relevant to forced-liquidation timing for TX/MTX/TMF than treating an arbitrary overnight low as an immediate liquidation event. It is still not tick-by-tick and does not override broker-specific house rules.

## 500% floor with hysteresis / refill buffer
The floor remains **500%** in every candidate. Only the month-start and emergency refill/reset target changes.

| Reset target | Terminal wealth | CAGR | MDD | Calmar | External interest | Total transfers | Emergency top-ups | Monthly transfers | Min close | Min next-open | Avg external share |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500% | NT$32,690,742 | 44.58% | -37.87% | 1.177 | NT$285,263 | 435 | 320 | 115 | 500.00% | 368.97% | 45.72% |
| 525% | NT$32,573,116 | 44.52% | -37.87% | 1.176 | NT$264,968 | 245 | 130 | 115 | 500.02% | 393.97% | 43.60% |
| 550% | NT$32,507,532 | 44.49% | -37.87% | 1.175 | NT$249,142 | 195 | 80 | 115 | 500.26% | 418.97% | 41.56% |
| 575% | NT$32,433,837 | 44.46% | -37.87% | 1.174 | NT$232,335 | 170 | 55 | 115 | 502.02% | 414.04% | 39.80% |
| 600% | NT$32,431,272 | 44.46% | -37.87% | 1.174 | NT$213,259 | 157 | 42 | 115 | 502.06% | 447.88% | 37.69% |

### Operational elbow
Relative to a 500% reset, a **550% reset**:
- cuts emergency top-ups from 320 to 80 (**-75%**),
- cuts all transfer events from 435 to 195 (**-55%**),
- raises the worst next-open ratio by about **50 percentage points** (368.97% to 418.97%),
- costs about **0.09 percentage point of CAGR** (44.58% to 44.49%),
- reduces terminal wealth by about NT$183,210 over the full sample.

575% is not clearly superior to 550% because its observed minimum next-open ratio is slightly lower (integer sizing/path dependence), although it has fewer transfer events. 600% gives the highest opening cushion of the tested reset levels but uses more idle futures-account cash and reduces external-yield participation further. The 550% reset is therefore the cleanest operational elbow among the pre-registered candidates, while the hard trigger/floor remains 500%.

## Slippage robustness
Plain 500% reset policy:

| Slippage / contract side | Terminal wealth | CAGR | MDD | Calmar | Min close ratio | Min next-open ratio |
|---:|---:|---:|---:|---:|---:|---:|
| 1 point | NT$32,690,742 | 44.58% | -37.87% | 1.177 | 500.00% | 368.97% |
| 3 points | NT$28,933,666 | 42.72% | -38.47% | 1.110 | 500.00% | 368.98% |
| 5 points | NT$25,879,922 | 41.05% | -38.11% | 1.077 | 500.00% | 368.95% |

The margin-safety picture is stable, but performance is materially sensitive to unusually high assumed slippage. At 3 and 5 points per side, the futures implementation no longer matches the frozen 00685L CAGR benchmark of 44.1%. This makes execution quality a real performance risk, not merely a cosmetic cost assumption.

## External-liquidity timing
500% reset, 1-point slippage:

| Emergency transfer assumption | Terminal | CAGR | MDD | Min close ratio | Close days <500% | Min next-open ratio | Maintenance-equivalent breaches |
|---|---:|---:|---:|---:|---:|---:|---:|
| Same-close availability | NT$32,690,742 | 44.58% | -37.87% | 500.00% | 0 | 368.97% | 0 |
| Conservative T+1 availability | NT$32,690,742 | 44.58% | -37.87% | 190.20% | 320 | 180.60% | 0 |

Under T+1, the transfer is requested when the close falls below 500%, but it is not credited into the futures account until after the next trading day's close. The maximum pending transfer was **NT$2,272,373**. Economic total wealth is unchanged in this simplified model because the pending amount remains owned by the strategy, but the broker-account ratio can temporarily be far below 500%. No maintenance-equivalent breach occurred historically, but this demonstrates that **the 500% rule is only operationally real if the external reserve can be moved promptly enough**.

## Conclusions
1. For TX/MTX/TMF, the user's emphasis on the next regular-session open rather than an overnight forced-liquidation event is supported by current TAIFEX treatment of these contracts as after-hours exempt products. Broker-specific house rules still need verification before live deployment.
2. The historical worst next-open ratio for the 500% baseline was 368.97%, on 2025-04-07 after an approximately 10.02% adverse effective opening move on the held futures notional. Even a simultaneous 2x margin-requirement stress produced a minimum opening ratio of 184.49% and no maintenance-equivalent breach in this sample.
3. The **550% refill/reset target with a 500% trigger/floor** is the best operational elbow in the pre-registered 500/525/550/575/600 comparison: much fewer top-ups and more opening cushion for a small historical CAGR cost.
4. Slippage is the largest remaining performance sensitivity found here. 3-5 points per contract side materially reduce CAGR.
5. External-liquidity delay matters primarily to margin safety, not modeled economic return. A T+1-only reserve weakens the effective 500% protection substantially even though historical maintenance thresholds were not breached.
6. The dataset is now integrity-gated by row count and SHA-256; future reruns should reject incomplete TAIFEX downloads rather than silently compare mismatched samples.

No production branch or live strategy file was modified.