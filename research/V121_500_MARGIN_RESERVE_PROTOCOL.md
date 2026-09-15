# v1.21 Protocol — 500% Broker-Style Margin Reserve + 1.5% External Cash Yield

Date frozen: 2026-09-15
Branch: `backtest-v1`

## Purpose
Test a practical cash-allocation rule for the frozen 0050-signal futures strategy after correcting the displayed margin-ratio definition.

The user's priority is margin safety. The broker-style ratio used here is:

`futures-account equity / required initial margin * 100%`

The target floor is **500% at close** under the normal historical exchange margin schedule.

## Strategy assumptions — unchanged
- Start combined capital: NT$1,000,000.
- Signal source: 0050.
- Frozen MA10 / MA20 / MA60 recovery logic.
- Target index exposure states: 0.5x / 1.0x / 1.5x / 2.0x of combined equity.
- Actual TAIFEX TX / MTX / TMF monthly-contract data.
- Roll: trading day before the third Wednesday.
- Commissions: TX NT$38, MTX NT$19, TMF NT$16 per side.
- Futures transaction tax: 0.002% of notional per side.
- Slippage: 1 index point per contract side.
- Historical exchange initial / maintenance margin schedule reconstructed as in corrected v1.17-v1.20.
- No strategy-parameter changes and no post-result threshold relaxation.

## Cash sleeve
- External cash yield: **1.5% annualized gross**.
- Futures-account cash earns 0%.
- External cash interest has no tax, product fee, bid/ask spread, haircut, settlement delay or liquidity delay in this sensitivity test.
- Contract sizing is always based on **combined equity = futures-account equity + external cash**.

## Primary implementation: monthly sweep + emergency top-up
This is intended to avoid unnecessary daily cash movements while preserving the 500% close floor.

1. Interest accrues on external cash between trading dates.
2. The futures account receives actual futures P&L and pays modeled trading costs.
3. After close and after the day's new position is established, calculate required initial margin.
4. On the **first strategy trading day of each calendar month**, rebalance cash between the futures account and external sleeve so futures-account equity equals `5.0 × required initial margin`, if combined equity is sufficient.
5. On other days, do **not sweep excess cash outward**. If post-close futures-account equity falls below `5.0 × required initial margin`, transfer external cash inward up to the 500% target. If external cash is insufficient, transfer all available external cash and report the resulting ratio.
6. No intraday transfers are assumed. Intraday safety is evaluated using the prior-close position and a conservative simultaneous-daily-low proxy.

## Sensitivity: daily ideal sweep
After every close, rebalance to exactly `5.0 × required initial margin` when combined equity is sufficient. This is an operational upper bound for external-cash yield and is not the primary practical result.

## Required outputs
For both monthly and daily implementations report:
- terminal combined equity, total return, CAGR, MDD, Calmar;
- cumulative external-cash interest;
- average and maximum external-cash share;
- number and gross amount of cash transfers;
- minimum close broker-style ratio;
- minimum conservative intraday broker-style ratio;
- date and account details of worst intraday ratio;
- maintenance-trigger equivalent (`maintenance / initial`);
- 1.5x and 2.0x margin-shock minimum close and intraday ratios;
- counts below maintenance-trigger equivalent, 100%, 200%, and 250% under 2x shock;
- comparison with v1.17 zero-yield futures and the 00685L benchmark.

## Interpretation rule
A higher CAGR from the external cash sleeve is only considered operationally meaningful if the 500% normal-margin close floor is maintained whenever combined equity is sufficient and the 2x-margin-shock / intraday diagnostics remain comfortably above the maintenance-trigger equivalent.

This test changes cash management only. It does not change the trading signal or exposure rule.
