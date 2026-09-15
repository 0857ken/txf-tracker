# v1.17 — Actual Futures / Margin-First Validation Protocol

Date frozen: 2026-09-15
Branch: backtest-v1

## Objective
Validate whether the frozen 0050 signal system can be executed with actual Taiwan index futures contract data without unacceptable margin risk, and only then compare performance with 00685L.

## Frozen strategy
Signal source: 0050.
- Confirmed bear: 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Non-bear: 100% 00685L-equivalent exposure.
- Confirmed bear: 25%.
- Still bear + close > MA10: 50%.
- Still bear + close > MA20: 75%.
- Bear ends: 100%.

For futures these map to target index notional exposure of 0.5x / 1.0x / 1.5x / 2.0x account equity.

Starting capital: NT$1,000,000.

## Execution assumptions
- Use actual historical TX / MTX contract prices from TAIFEX; TMF only from its actual listing date onward.
- Signal determined after 0050 close.
- Use a predefined post-signal futures execution proxy; no same-day price earlier than the signal may be used.
- Roll rule frozen before results: roll on the trading day before the third Wednesday unless the actual contract's final settlement schedule requires an earlier valid trading date.
- User commissions per side: TX NT$38; MTX NT$19; TMF NT$16.
- Futures transaction tax: use applicable official rate.
- Slippage sensitivity: 0, 1, 2 index points per contract side.
- Unused cash earns 0% in the main test.
- Position sizes must be integer contracts and cannot use products before their historical listing dates.

## Margin-first decision hierarchy
Margin safety is the first gate and overrides return metrics.

### Gate M1 — Survival
At no point may account equity fall below the historical maintenance-margin requirement for the held contracts. Any forced-margin breach is an automatic FAIL regardless of CAGR.

### Gate M2 — Normal margin buffer
For the main historical-margin run:

    original_margin_usage = required_original_margin / account_equity

The maximum original-margin usage should be <= 50%.

This is an internal risk standard, not an exchange rule. It requires approximately 2x equity-to-original-margin coverage at the historical worst point.

### Gate M3 — Margin shock sensitivity
Recalculate required margins under two artificial stress multipliers:
- 1.5x historical required margin
- 2.0x historical required margin

Required reporting:
- maximum margin usage under each multiplier;
- date of maximum usage;
- account equity at that time;
- held TX/MTX/TMF contracts;
- remaining free equity;
- whether maintenance margin would be breached.

The 2.0x stress case must not produce a maintenance-margin breach. The 1.5x case should remain comfortably below the forced-liquidation threshold.

## Secondary performance gates
Only evaluated after all margin gates pass.

00685L reference from v1.13/v1.16 base-cost implementation:
- CAGR: 44.1%
- MDD: -36.8%
- Calmar: 1.20

At 1-point-per-side futures slippage:
1. Net futures CAGR >= 44.6% (at least +0.5 percentage point over 00685L).
2. Futures MDD no worse than -38.8% (not >2 percentage points worse than 00685L).
3. Futures Calmar >= 1.20.
4. 2-point slippage result must not materially collapse versus the 00685L benchmark.
5. The full-period advantage must not be explained solely by one isolated bull-market subperiod; stress windows 2018, 2020, 2022, 2023-24 and 2025-26 will be reported separately.

## Required margin outputs
The final report must explicitly show:
- historical maximum original-margin usage;
- historical maximum maintenance-margin usage;
- exact worst date;
- equity, contracts held, required original and maintenance margin, and free equity on that date;
- 1.5x and 2.0x margin-stress equivalents;
- any dates with margin deficits;
- minimum free-equity ratio across the sample.

## Research discipline
These thresholds are frozen before the actual-contract result is viewed. They must not be relaxed after seeing the result. If the futures implementation fails a margin gate, no return advantage can override that failure.
