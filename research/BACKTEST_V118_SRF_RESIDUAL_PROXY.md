# Backtest v1.18 — 0050 Futures Residual-Fill Proxy

Date: 2026-09-15
Branch: `backtest-v1`

## Purpose
Test whether using small 0050 futures exposure to fill only the positive notional shortfall from integer TX/MTX/TMF sizing materially improves the v1.17 implementation.

This candidate was proposed after observing v1.17, so this is **exploratory historical evidence**, not pristine out-of-sample validation.

## Core strategy
Unchanged from v1.17:
- Signal source: 0050.
- Exposure states: 0.5x / 1.0x / 1.5x / 2.0x.
- Starting capital: NT$1,000,000.
- Main book: actual TAIFEX TX / MTX / TMF contracts.
- User single-side commissions: TX 38 / MTX 19 / TMF 16.
- Main-book slippage: 1 index point per contract side.

Residual rule:
- Size TX/MTX/TMF exactly as v1.17.
- If main-book notional is below target, add a small 0050-futures-equivalent residual position to minimize the remaining gap.
- Never add residual exposure when the main book is already at/above target.

## Residual modeling
The official small 0050 ETF futures (SRF) dataset begins **2024-07-29**, matching its actual listing date. Official TAIFEX SRF data downloaded for this test contained 1,506 contract-day rows through 2026-09-15.

For this exploratory pass:
- actual SRF contract closes are used for residual contract notional sizing;
- 0050 adjusted total return is used for residual directional P&L to avoid falsely treating ETF distributions/split-related contract adjustments as trading losses;
- residual contract multiplier: 1,000 ETF units;
- base assumed residual commission: NT$20 per side; NT$10 and NT$30 sensitivity also tested;
- futures transaction tax: 0.002% of notional per side;
- residual slippage: one ETF-futures minimum tick per side;
- conservative residual margin diagnostic: initial 10% / maintenance 8% of residual notional.

This is therefore a **small-0050-futures-equivalent proxy**, not yet an exact SRF contract-adjustment ledger.

## Main result — NT$20 residual commission

| Metric | v1.17 TX/MTX/TMF only | v1.18 + 0050 residual fill |
|---|---:|---:|
| Terminal value | NT$31,504,877 | **NT$31,510,632** |
| CAGR | 44.0% | **44.0%** |
| MDD | -38.2% | **-38.2%** |
| Calmar | 1.15 | **1.15** |
| Full-sample mean abs exposure error | 6.1 pp | **6.09 pp** |
| Post-SRF-listing mean abs exposure error | — | **0.45 pp** |

The key result is that SRF-like residual filling is **very effective mechanically after the product exists**: post-2024-07-29 exposure error falls to roughly **0.45 percentage point**.

However, it does **not materially change full-period performance**. Terminal wealth improves by only about NT$5,755 versus v1.17, with essentially unchanged CAGR, MDD and Calmar.

## Why the performance impact is tiny
- SRF only became available on 2024-07-29, so it cannot repair the larger integer-sizing error during most of the 2017–2024 sample.
- The average residual position after listing was only **0.33 SRF-equivalent contracts** and the maximum was 2.
- Residual-leg modeled transaction costs were about **NT$17,341** across 252 residual contract sides.
- The main TX/MTX/TMF book already captured almost all target market exposure, so reducing a small remaining tracking error has little compounding impact.

## Residual commission sensitivity

| Residual commission / side | Terminal value | CAGR | MDD | Calmar |
|---:|---:|---:|---:|---:|
| NT$10 | NT$31,525,849 | 44.02% | -38.24% | 1.15 |
| **NT$20** | **NT$31,510,632** | **44.02%** | **-38.24%** | **1.15** |
| NT$30 | NT$31,524,587 | 44.02% | -38.24% | 1.15 |

Small non-monotonic terminal differences arise because tiny cost changes can alter later integer-contract rounding; economically the commission sensitivity is negligible at this residual size.

## Margin
Combined margin safety remains essentially unchanged from v1.17:
- max normal initial-margin usage: **17.9%**;
- max normal maintenance usage: **13.8%**;
- 1.5x margin shock: max initial 26.9%, max maintenance 20.6%, zero breach days;
- 2.0x margin shock: max initial 35.9%, max maintenance 27.5%, zero breach days.

## Conclusion
Using small 0050 futures as a residual filler is a **good execution refinement**, because after SRF's listing it reduces exposure-tracking error from multi-percentage-point granularity to about 0.45 pp. But it does **not solve the historical performance gap versus 00685L**, because the product only exists from mid-2024 and the residual exposure is small.

Therefore:
- keep SRF residual-fill as a sensible **forward/execution feature** if the user chooses a futures implementation;
- do not treat it as evidence that futures now beats 00685L historically;
- an exact SRF adjusted-contract ledger is only worth building if precise forward implementation is desired, not because this proxy suggests a large hidden return advantage.
