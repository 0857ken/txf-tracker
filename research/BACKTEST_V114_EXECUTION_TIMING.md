# v1.14 — Execution timing clarification and validation

Date: 2026-09-15

## Important correction
The v1.13 daily close-to-close implementation used:

```python
pos = target.shift(1)
asset_return_t = close_t / close_{t-1} - 1
strategy_return_t = pos_t * asset_return_t
```

This means a signal determined from the close on day **t** becomes the portfolio position for the return interval **close_t -> close_{t+1}**. Therefore the v1.13 `lag=1` case is economically equivalent to **same-day closing-price execution after the signal is known**, assuming the order can be filled at that day's closing price (for example via after-hours fixed-price trading).

It should not have been described as waiting until the next trading day's close.

`lag=2` is the appropriate daily-close proxy for waiting one additional full trading day before the new allocation becomes effective.

## Frozen strategy
- Signal source: 0050
- Traded asset: 00685L
- Confirmed bear: 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier
- Non-bear: 100%
- Bear: 25%
- Bear + close > MA10: 50%
- Bear + close > MA20: 75%
- Bear ends: 100%
- Base friction: 0.05% commission on traded notional, 0.10% ETF sell tax on reductions, 0.03% slippage on traded notional

## Timing comparison
Using the already-run v1.13 data (2017-03-30 through 2026-09-15):

| Execution interpretation | Code lag | Total return | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|---:|
| **Same-day closing-price / after-hours fill** | **1** | **+3070.1%** | **44.1%** | **-36.8%** | **1.20** |
| Wait one extra trading day / next-day close proxy | 2 | +2917.2% | 43.3% | -37.3% | 1.16 |
| Wait two extra trading days | 3 | +2608.3% | 41.7% | -40.8% | 1.02 |

## Result
The user's preferred rule — determine the state using the official 0050 close and then execute 00685L at that same day's closing price in the after-hours fixed-price session, assuming a fill — is the **existing v1.13 central execution model** and has the best of the tested realistic daily-close timing variants.

The apparent improvement versus waiting to the next day's close is modest but favorable: CAGR +0.8 percentage points (44.1% vs 43.3%) and historical MDD improves by 0.5 percentage points (-36.8% vs -37.3%).

## Caveat
This model assumes the desired 00685L quantity is fully filled at the official closing price in after-hours fixed-price trading. Actual after-hours matching is not guaranteed; fill availability and order size should be tracked in forward testing. A `lag=0` calculation that applies today's close-derived signal to today's already-completed close-to-close return would be look-ahead bias and must not be used.
