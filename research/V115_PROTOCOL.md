# v1.15 protocol — 00685L vs TAIEX futures execution

Protocol frozen before seeing v1.15 output.

## Objective
Compare the already-frozen 0050 signal system when executed with (A) 00685L and (B) TAIEX futures-like exposure, using NT$1,000,000 starting capital.

This test does **not** change the signal rule or MA parameters.

## Frozen signal
- Signal source: 0050.
- Confirmed bear: 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Non-bear allocation state: 100% 00685L equivalent.
- Confirmed bear: 25%.
- Still bear + close > MA10: 50%.
- Still bear + close > MA20: 75%.
- Bear ends: 100%.
- Signal is determined at the close and new exposure applies from that close to the next close.

## Futures exposure mapping
Because 00685L targets approximately 2x daily TAIEX return, map the four allocation states to TAIEX notional exposure as:
- 25% 00685L -> 0.5x capital TAIEX notional.
- 50% -> 1.0x.
- 75% -> 1.5x.
- 100% -> 2.0x.

## Capital and contracts
- Initial capital: NT$1,000,000.
- Futures contract multipliers: TX NT$200/point, MTX NT$50/point, TMF NT$10/point.
- User-supplied single-side commissions: TX NT$38, MTX NT$19, TMF NT$16 per contract.
- Futures transaction tax: 0.002% of contract notional per transaction side.
- Base slippage stress: 1 index point per traded contract side. Also report 0-point and 2-point variants.
- Unused cash earns 0%.

## Futures data limitation
Actual continuous TX futures history with clean roll-adjusted closes is not available in the current research dataset. Futures P&L is therefore proxied by TAIEX (^TWII) close-to-close point changes. This captures directional index exposure but not actual futures basis, dividend fair-value effects, or roll spread.

Three futures implementations will be reported:
1. **Ideal continuous exposure** — fractional 0.5/1/1.5/2x TAIEX exposure, no contract granularity and no trading costs. This is only a theoretical ceiling/reference.
2. **Current toolkit synthetic** — TX/MTX/TMF contract sizes are allowed over the full historical sample to isolate today's contract-granularity effect. TMF did not exist for the early part of history, so this is not historically tradable.
3. **Historical-availability proxy** — TX/MTX only before 2024-07-29; TX/MTX/TMF from 2024-07-29 onward.

For integer futures implementations, contract counts are selected at each close to minimize absolute notional error versus the target exposure using the available contract sizes. For an equally close solution, prefer lower commission structure by decomposing into TX first, then MTX, then TMF.

## Monthly roll-cost model
Use a monthly roll proxy on the trading day before the third Wednesday. If a futures position is open, model closing and reopening the same contract mix, charging two transaction sides of commission, tax, and the selected slippage. No separate basis/roll-spread amount is assumed beyond slippage; this limitation must be stated.

## ETF comparison
00685L uses adjusted-close returns. Base execution friction is retained from v1.13 for continuity:
- commission 0.05% of traded notional,
- ETF sell tax 0.10% on reductions,
- slippage 0.03% of traded notional.

The ETF market price path already embeds fund expenses and daily-reset behavior; no separate management fee is subtracted.

## Required outputs
Report since 2017-03-30 through latest common date:
- terminal equity from NT$1,000,000,
- total return, CAGR, MDD, Calmar,
- transaction/roll cost totals,
- average realized futures notional multiple and tracking error to target,
- stress windows 2018, COVID 2020, 2022, 2023-24, 2025-26,
- current NT$1,000,000 contract examples for the four target states using TMF/TX/MTX sizes.

Do not modify the signal rule based on the result.