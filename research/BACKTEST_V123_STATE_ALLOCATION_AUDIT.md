# Backtest v1.23 — 500% Reserve State Allocation Audit

Date: 2026-09-16
Branch: `backtest-v1`
Workflow run: `35037859705`

## Frozen setup
- Start capital NT$1,000,000.
- Same frozen 0050 signal and exposure states as prior tests.
- Exposure states: 0.5x / 1.0x / 1.5x / 2.0x index exposure, equivalent to 25% / 50% / 75% / 100% of the original 00685L allocation scheme.
- Actual historical TAIFEX TX / MTX / TMF regular-session contract prices.
- 500% broker-style reserve target = futures-account equity target of 5x required initial margin.
- Monthly outward sweep plus emergency inward top-up.
- External cash earns 1.5% gross; futures-account cash earns 0%.
- External cash does not count toward broker-style margin ratio until transferred.

## Base 500% result
- Terminal wealth: NT$32,690,742
- CAGR: 44.58%
- MDD: -37.87%
- Calmar: 1.177

## Exposure-state allocation audit

| Target exposure | 00685L-equivalent allocation | Trading days | Share of days | Avg total equity | Avg initial margin | Avg initial margin / total equity | Avg 5x reserve target | Avg reserve target / total equity | Avg external cash | Avg external share | Median external share | Avg realized exposure |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.5x | 25% | 191 | 8.30% | NT$2,961,699 | NT$89,704 | 2.78% | NT$448,518 | 13.89% | NT$1,838,100 | 63.45% | 64.30% | 0.477x |
| 1.0x | 50% | 64 | 2.78% | NT$2,954,543 | NT$186,325 | 5.68% | NT$931,625 | 28.38% | NT$1,632,190 | 61.11% | 64.93% | 0.954x |
| 1.5x | 75% | 114 | 4.95% | NT$2,992,101 | NT$285,543 | 8.90% | NT$1,427,715 | 44.50% | NT$1,385,571 | 49.87% | 48.87% | 1.494x |
| 2.0x | 100% | 1,933 | 83.97% | NT$6,038,235 | NT$740,019 | 10.63% | NT$3,700,094 | 53.17% | NT$2,098,529 | 43.22% | 44.74% | 1.983x |

Total audited trading days: 2,302.

## State durations
- 0.5x: 35 episodes; average 5.5 trading days; median 4; maximum 19.
- 1.0x: 30 episodes; average 2.1 trading days; median 2; maximum 7.
- 1.5x: 26 episodes; average 4.4 trading days; median 2; maximum 16.
- 2.0x: 27 episodes; average 71.6 trading days; median 10; maximum 330.
- Total state transitions: 117.

## Interpretation
The strategy spent 83.97% of audited trading days at the full 2.0x index exposure. The most defensive 0.5x state occurred on 8.30% of days. During 0.5x periods, average initial margin fell to only 2.78% of total strategy equity and the 5x reserve target averaged 13.89% of total equity, leaving an average 63.45% of total equity in the external cash sleeve after applying the monthly sweep / emergency top-up mechanics. At 2.0x exposure, the 5x reserve target averaged 53.17% of total equity and the external sleeve averaged 43.22%.

The external-share figures are actual modeled post-transfer averages, not simply `100% - 5x initial-margin ratio`, because the implementation sweeps outward only monthly and tops up inward as needed between month boundaries. Therefore the futures account can temporarily hold more than exactly 5x initial margin.

This audit is descriptive only; no strategy parameter was changed.
