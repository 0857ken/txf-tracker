# v1.22 Protocol — 500% / 600% / 700% Futures-Account Reserve Comparison

Date: 2026-09-15
Branch: `backtest-v1`

## Purpose
Compare three practical futures-account reserve targets after v1.21 established the 500% broker-style reserve framework. This is a capital-management diagnostic only; it does not change the 0050 signal strategy, futures exposure targets, roll rule, contract sizing, transaction-cost assumptions, or margin history.

## Frozen assumptions
- Start capital: NT$1,000,000.
- Signal: frozen 0050 MA10/20/60 regime/recovery logic.
- Target market exposure: 0.5x / 1.0x / 1.5x / 2.0x of combined strategy equity.
- Execution: actual historical TAIFEX TX / MTX / TMF regular-session contract closes.
- Roll: trading day before third Wednesday.
- Commissions: TX NT$38, MTX NT$19, TMF NT$16 per side.
- Futures transaction tax: 0.002% notional per side.
- Slippage: 1 index point per contract side.
- External cash yield: 1.5% annual gross.
- Futures-account cash yield: 0%.
- Rebalancing: monthly outward sweep; emergency inward top-up whenever post-close futures-account equity would otherwise be below the reserve target.
- External cash is excluded from the broker-style maintenance ratio until transferred into the futures account.
- Intraday test assumes no same-day transfer rescue and uses the prior-close position with the regular-session daily low proxy.

## Reserve levels to compare
Broker-style reserve target = futures-account equity / required initial margin.

- 500% = 5.0x initial margin.
- 600% = 6.0x initial margin.
- 700% = 7.0x initial margin.

No intermediate reserve target may be added after seeing results in this comparison.

## Required outputs
For each reserve level report:
1. Terminal wealth, CAGR, MDD, Calmar.
2. Cumulative external-cash interest.
3. Average and maximum external-cash share.
4. Transfer count and gross transfer amount.
5. Minimum close broker ratio and date.
6. Minimum intraday-low broker ratio and date.
7. 1.5x and 2.0x margin-shock minimum close and intraday ratios.
8. Counts of intraday observations below 250%, 200%, 150%, 100%, and the historical maintenance-trigger-equivalent ratio under the 2.0x margin shock.
9. 2025-06-02 reconciliation.
10. Delta versus the frozen 00685L benchmark: terminal NT$31,700,514; CAGR 44.1%; MDD -36.8%; Calmar 1.20.

## Interpretation rule
The comparison is descriptive, not an optimization search. Higher reserve targets are expected to trade away external-cash yield for larger margin safety. Recommendation should explicitly show the marginal safety gained per unit of CAGR/terminal-wealth sacrificed and should not alter the signal or execution rules to improve any candidate.
