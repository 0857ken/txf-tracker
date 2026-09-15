# v1.13 protocol — frozen 0050 tactical 00685L practical stress test

Pre-registered before running v1.13 results.

## Frozen strategy
Signal source is **0050** by user decision. Traded asset is **00685L**.

Core rule:
- Non-bear: 100% 00685L.
- Confirmed bear: 25%.
- Still confirmed bear and signal close > fast MA: 50%.
- Still confirmed bear and signal close > slow MA: 75%.
- Confirmed bear ends: 100%.
- Confirmed bear = signal close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Central parameters: fast MA10, slow MA20.

The signal source will NOT be re-selected in this test.

## Stress dimensions
1. MA neighborhood: fast MA in {8,10,12}; slow MA in {18,20,22} (9 combinations).
2. Execution delay: signal effective after 1, 2, or 3 trading days.
3. Trading friction scenarios, applied to allocation turnover:
   - Low: commission 0.03% per traded notional per side-equivalent change, ETF sell tax 0.10% on reductions, slippage 0.02% per traded notional.
   - Base: commission 0.05%, sell tax 0.10%, slippage 0.03%.
   - Conservative: commission 0.1425%, sell tax 0.10%, slippage 0.05%.

TWSE notes that ETF transaction tax is 0.1% on sales and broker commissions are broker-defined, with 0.1425% an important reference ceiling/notification threshold; therefore the commission/slippage scenarios are treated as assumptions, not claims about the user's broker.

Uninvested cash earns 0% in this test. 00685L adjusted-close returns already reflect the fund's path and embedded fund expenses in market prices; no separate fund fee is added.

## Pre-registered pass criteria
The strategy passes this gate if all of the following hold:
1. Central MA10/20, 1-day lag, **conservative friction**: CAGR >= 35% and MDD <= 40%.
2. Under **base friction, 1-day lag**, at least 7 of 9 MA-neighborhood combinations: CAGR >= 38% and MDD <= 40%.
3. Central MA10/20 with **2-day lag and base friction**: CAGR >= 35% and MDD <= 42%.
4. No MA-neighborhood combination under base friction / 1-day lag has CAGR < 30% or MDD worse than -45%.

These thresholds are frozen before seeing v1.13 output. If the strategy fails, do not change the thresholds after the fact.
