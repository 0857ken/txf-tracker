# v1.19 — Futures Free-Cash Yield Sensitivity Protocol

Date frozen: 2026-09-15
Branch: `backtest-v1`

## Objective
Measure whether interest earned on capital not required as futures initial margin changes the actual-contract v1.17 comparison versus 00685L.

This is a financing/cash-management sensitivity test only. It does **not** change the 0050 signal, MA parameters, target exposure states, contract sizing rule, roll rule, transaction-cost assumptions, or margin gates.

## Base implementation
Use the corrected v1.17 actual-contract framework:
- 0050 frozen MA10 / MA20 / MA60 signal.
- Target index notional exposure: 0.5x / 1.0x / 1.5x / 2.0x account equity.
- Actual TAIFEX TX / MTX / TMF regular-session contract prices.
- TMF only from its actual listing date onward.
- Starting capital: NT$1,000,000.
- Roll: trading day before the third Wednesday.
- Commissions per side: TX NT$38 / MTX NT$19 / TMF NT$16.
- Futures transaction tax: 0.002% of notional per side.
- Slippage: **1 index point per contract side** for the main comparison.
- Historical margin reconstruction and margin gates unchanged from v1.17.

## Cash-yield definition
Only **free equity above required initial margin** earns interest:

    free_cash_t = max(account_equity_t - required_initial_margin_t, 0)

The amount posted as initial margin itself earns 0% in this test.

Interest is accrued between trading dates using actual calendar-day gaps and an effective annual rate. The prior trading day's free cash is the interest-bearing principal. Interest is credited to strategy equity before the next day's position resize, so compounding and integer-contract sizing effects are naturally reflected.

This is a deliberately favorable-liquidity assumption for the free-cash sleeve: no tax, management fee, bid/ask spread, settlement delay, haircut, withdrawal delay, or liquidity constraint is charged to the cash-yield instrument. Therefore this test measures the **gross value of cash yield**, not a guaranteed investable net return.

## Frozen scenarios
Test annual free-cash yields of:
- 0.0%
- 1.5%
- 2.0%
- 3.0%

Also estimate the approximate annual free-cash yield required to:
1. match the prior 00685L benchmark CAGR of 44.1%;
2. reach the pre-registered futures replacement threshold CAGR of 44.6%.

## Required outputs
For each scenario report:
- terminal wealth;
- total return;
- CAGR;
- MDD;
- Calmar;
- cumulative interest credited;
- maximum initial-margin usage;
- maximum maintenance-margin usage;
- 1.5x and 2.0x margin-shock survival status.

Reference values:
- v1.17 actual futures, 1-point slippage, 0% cash yield: terminal approximately NT$31.505m, CAGR 44.0%, MDD -38.2%, Calmar 1.15.
- 00685L base-cost benchmark: terminal approximately NT$31.701m, CAGR 44.1%, MDD -36.8%, Calmar 1.20.

## Research discipline
The cash-yield rates above are fixed before observing v1.19 results. No strategy parameter may be altered based on these results. This test is diagnostic and does not retroactively change the v1.17 replacement decision standard.
