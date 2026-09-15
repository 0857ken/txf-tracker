# Backtest v1.20 — Broker-style Margin Ratio Audit

Date: 2026-09-15
Branch: `backtest-v1`

## Definition
For this audit, the displayed broker-style account ratio is defined as:

`account equity / required initial margin * 100%`

This is intentionally different from the earlier `equity / maintenance margin` ratio. The maintenance-margin trigger equivalent on the same scale is:

`maintenance margin / initial margin * 100%`

This trigger-equivalent ratio varied slightly with the historical margin schedules; the minimum observed value was 76.35%, and on 2025-06-02 it was 76.74%.

A broker's separate risk-indicator / forced-liquidation threshold is not assumed to be the same formula and is not conflated with this ratio.

## Historical results
Actual TAIFEX TX / MTX / TMF contract data, 2017-03-30 through 2026-09-15, with the frozen 0050 signal and 1-point-per-side slippage.

| Free-cash yield | Minimum close broker ratio | Date | Minimum intraday-low proxy | Date | 2x margin shock minimum close | 2x margin shock minimum intraday |
|---:|---:|---|---:|---|---:|---:|
| 0.0% | 557.65% | 2025-06-02 | 538.30% | 2025-06-02 | 278.83% | 269.15% |
| 1.5% | 557.30% | 2025-06-03 | 540.79% | 2025-06-02 | 278.65% | 270.39% |
| 2.0% | 558.05% | 2025-06-02 | 540.38% | 2025-06-02 | 279.03% | 270.19% |
| 3.0% | 559.55% | 2025-06-03 | 543.31% | 2025-06-02 | 279.77% | 271.65% |

## 2025-06-02 reconciliation — 0% cash yield
- Account equity: NT$7,403,921
- Required initial margin: NT$1,327,700
- Required maintenance margin: NT$1,018,850
- Holdings: TX 3 / MTX 2 / TMF 1
- Broker-style ratio: 7,403,921 / 1,327,700 = **557.65%**
- Maintenance-trigger equivalent on the same denominator: 1,018,850 / 1,327,700 = **76.74%**

The conservative regular-session-low proxy for the held position on that date produced:
- Intraday equity floor: NT$7,348,302
- Initial margin of the position held during the session: NT$1,365,100
- Intraday broker-style ratio proxy: **538.30%**

## 1.5% free-cash-yield version
The historical minimum close broker-style ratio was **557.30%** on 2025-06-03. The minimum conservative intraday-low proxy was **540.79%** on 2025-06-02.

Margin-shock sensitivity for the 1.5% version:
- Normal historical margin: minimum close 557.30%; minimum intraday proxy 540.79%.
- 1.5x historical margin: minimum close 371.53%; minimum intraday proxy 360.53%.
- 2.0x historical margin: minimum close 278.65%; minimum intraday proxy 270.39%.

There were zero close-of-day observations below the maintenance-trigger equivalent, below 100%, or below 25%, even under the 2x margin shock simulation.

## Intraday caveat
The intraday stress is a conservative daily-low proxy. It applies each held contract's regular-session daily low to the prior-close position; those individual lows may not have occurred at the exact same instant. It is therefore not a tick-by-tick margin reconstruction, but it is more conservative than using closing equity alone.
