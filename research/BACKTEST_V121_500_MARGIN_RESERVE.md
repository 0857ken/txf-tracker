# Backtest v1.21 — 500% Broker-Style Margin Reserve + 1.5% External Cash Yield

Date: 2026-09-15
Branch: `backtest-v1`
Protocol frozen before result: `research/V121_500_MARGIN_RESERVE_PROTOCOL.md`
Workflow run: 34992623919

## Rule tested
Broker-style account ratio:

`futures-account equity / required initial margin * 100%`

Primary cash-management rule:
- 1.5% annualized gross yield on external cash;
- futures-account cash earns 0%;
- contract sizing uses combined equity;
- first strategy trading day of each calendar month: sweep / top-up so futures-account equity equals 5x required initial margin (500%) when combined equity is sufficient;
- other days: no outward sweep, but emergency inward top-up if the close ratio would fall below 500%;
- no intraday transfers;
- actual TAIFEX TX / MTX / TMF monthly contracts, frozen 0050 MA10/20/60 signal, same exposure states, commissions, transaction tax, roll rule and 1-point-per-side slippage as v1.17-v1.20.

Daily exact-500% sweeping was also tested only as an operational sensitivity.

## Primary result — monthly sweep + emergency top-up

- Terminal combined equity: **NT$32,984,007**
- Total return: **+3198.40%**
- CAGR: **44.71%**
- MDD: **-37.82%**
- Calmar: **1.18**
- Cumulative external-cash interest: **NT$286,858**
- Average external-cash share: **45.65%**
- Maximum external-cash share: **91.05%**
- Cash transfers: **430**
- Gross transfer amount over the full simulation: **NT$105,106,690**
- Days unable to restore the 500% close reserve because combined cash was insufficient: **0**

### Versus references
- v1.17 actual futures, zero cash yield: terminal NT$31,504,877; CAGR 44.01%; MDD -38.24%; Calmar 1.15.
- v1.19 idealized yield on all free cash at 1.5%: terminal NT$35,290,991; CAGR 45.75%; MDD -37.89%; Calmar 1.21.
- 00685L benchmark: terminal NT$31,700,514; CAGR 44.1%; MDD -36.8%; Calmar 1.20.

The primary practical 500% reserve version finished about **NT$1,283,493 above** the 00685L benchmark and exceeded it by about **0.61 percentage points of CAGR**. It did **not** exceed the ETF benchmark on Calmar because its MDD remained somewhat deeper.

Using the prior v1.17 formal performance gates as a conservative reference:
- CAGR >= 44.6%: **PASS** (44.71%)
- MDD >= -38.8%: **PASS** (-37.82%)
- Calmar >= 1.20: **FAIL** (1.18)

Therefore this result improves the case for futures as an execution vehicle, but does not turn the old formal replacement decision into an unqualified PASS.

## Margin-ratio results

### Normal historical margins
- Minimum close broker-style ratio: **500.00%** (by construction when a monthly sweep / emergency top-up was required).
- Minimum conservative intraday-low ratio: **268.92% on 2017-08-03**.
- No close or intraday observation fell below the maintenance-trigger-equivalent ratio.
- No intraday observation fell below 200% under normal historical margin requirements.

### Margin shocks

| Margin schedule multiplier | Minimum close ratio | Minimum conservative intraday ratio | Intraday below 100% | Intraday below maintenance-trigger equivalent |
|---:|---:|---:|---:|---:|
| 1.0x | 500.00% | 268.92% | 0 days | 0 days |
| 1.5x | 333.33% | 179.28% | 0 days | 0 days |
| 2.0x | 250.00% | **134.46%** | 0 days | 0 days |

Under the 2x historical-margin shock, 11 intraday proxy observations fell below 200% and 544 fell below 250%, but none fell below 100% or the maintenance-trigger-equivalent ratio.

## 2017-08-03 flash-crash validation
The worst intraday date is not a bad-price artifact. The official TAIFEX daily download reports the 201708 TX contract at:
- 2017-08-02 close: 10,453
- 2017-08-03 low: **9,408**
- 2017-08-03 close: 10,406

The same 9,408 low appears for MTX. Contemporary reporting documents that TAIEX futures fell to 9,408 in the first minute of 2017-08-03 before rapidly recovering. This was a genuine futures flash crash.

For the primary backtest, the conservative intraday proxy on that date was:
- futures-account equity at proxy low: **NT$223,200**
- required initial margin: **NT$83,000**
- required maintenance margin: **NT$64,000**
- broker-style intraday ratio: **268.92%**
- maintenance / initial ratio: **77.11%**

If that historical intraday move is combined with a hypothetical 2x margin schedule, the same account ratio becomes about **134.46%**, still above the maintenance-trigger-equivalent ratio but with materially less cushion than the normal-margin result.

## 2025-06-02 example under the primary rule
- Combined equity: NT$7,694,804
- Futures-account equity after top-up: NT$6,919,000
- External cash: NT$775,804
- Initial margin: NT$1,383,800
- Maintenance margin: NT$1,061,900
- Close broker-style ratio: **500.00%**
- Conservative intraday ratio: **476.35%**
- Cash moved into futures account that close: NT$181,061
- Holdings after close: TX 3 / MTX 2 / TMF 4

## Daily-sweep sensitivity
Daily exact-500% sweeping produced almost the same performance:
- terminal NT$32,981,629
- CAGR 44.71%
- MDD -37.87%
- Calmar 1.18
- cumulative interest NT$325,808

It required 2,282 transfers versus 430 in the primary monthly rule and produced a slightly worse worst-intraday ratio (248.19%) because less excess cash was allowed to remain in the futures account between sweeps.

The monthly rule is therefore the more practical of the two tested 500% implementations and did not give up meaningful performance.

## Interpretation
The 500% reserve rule materially changes the earlier conclusion that all account equity could be treated as available margin cushion. Once external yield cash is excluded from the futures account, the correct risk measure is based only on futures-account equity.

Historically, a 500% close target survived the actual 2017 flash crash with a 268.92% intraday proxy ratio and survived the combined flash-crash + 2x-margin stress with a 134.46% proxy ratio. That is a PASS for historical survival, but the 2x stress is no longer an extremely large cushion.

External-cash interest in this test is gross and assumes no tax, fees, liquidity delay, settlement delay or transfer friction. A real implementation should use a highly liquid instrument and retain an operational cash-transfer buffer.
