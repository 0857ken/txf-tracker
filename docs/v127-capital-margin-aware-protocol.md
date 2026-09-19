# v1.27 Capital & Margin-Aware Allocator — preregistered protocol

Status: **frozen before implementation and before any v1.27 historical result is generated**.

Preregistration branch: `feature/v127-margin-aware`  
Parent: Phase B commit `c903cb5e1d5508d50ea8e41f2b531c38a690c9fb`  
Scope: Phase C only. Phase D/E are excluded.

This protocol is operational and safety research, not performance optimisation. A worse CAGR,
terminal value, drawdown, cost or turnover result must not change the rules below. Any later rule
change requires a new version and a new preregistration made before looking at its results.

## 1. Frozen inputs at each decision

Use only information available at that decision time:

- `strategyEquity = decisionTimeFuturesEquity + outsideCash`.
- Existing positions are marked to the same decision-time per-contract futures quotes before sizing.
- `targetNotional = strategyEquity * targetX`.
- `targetX` remains exactly one of 0.5, 1.0, 1.5 or 2.0 from the frozen exact signal rule.
- Candidate prices are the decision-time executable futures prices for the relevant contract month.
- Contract multipliers are TX=200, MTX=50 and TMF=10.
- Initial and maintenance margin are the effective values for each product on that date.
- No future price, realised return, volatility or other alpha input may select a product.

Missing/non-finite required quotes, margins, contract month, decision-time futures equity or outside
cash produces `allocationStatus=valuation-unavailable`. `strategyEquity <= 0` produces
`allocationStatus=infeasible`. Neither state may produce suggested lots.

## 2. Candidate set and hard 550% gate

Enumerate every non-negative integer tuple `(TX, MTX, TMF)` for the selected contract month. Bounds
are derived only from the safety gate:

`maxLots(product) = floor(strategyEquity / (5.5 * productInitialMargin))`.

The all-zero tuple is not an executable positive-target candidate. For every non-zero tuple compute:

- futures notional and actual exposure;
- signed and absolute exposure error versus `targetX`;
- required initial and maintenance margin;
- `required500Equity = 5.0 * requiredInitialMargin`;
- `required550Equity = 5.5 * requiredInitialMargin`.

A candidate is safe only when, using unrounded values:

`required550Equity <= strategyEquity`.

Unsafe candidates are removed before ranking. No fixed capital threshold or product ban is allowed;
TX/MTX/TMF eligibility must be derived anew from current strategy equity and effective margin.

## 3. Frozen ranking among safe candidates

Rank lexicographically, without using performance:

1. smallest absolute exposure error;
2. if exactly tied, prefer not to exceed target exposure;
3. if still tied, fewer total contracts;
4. existing deterministic product priority: more TX first, then more MTX, then TMF.

Comparisons use full-precision values. A numerical tolerance may only neutralise binary floating-point
representations of mathematically equal values; it may not widen the 0.05x band or alter a real rank.

## 4. Allocation status

- `within-band`: at least one safe candidate has absolute exposure error `<= 0.05`.
- `granularity-limited`: safe non-zero candidates exist, but none is within the inclusive band; select
  the highest-ranked safe candidate.
- `margin-limited`: no safe non-zero candidate exists for the positive target.
- `valuation-unavailable`: required valuation/quote/margin inputs are absent or stale.
- `infeasible`: `strategyEquity <= 0` or another explicit mathematical impossibility not caused by
  missing valuation data.

`best-feasible` is an action state, not a fifth allocation status.

## 5. No false daily rebalance

Normal non-roll decisions apply this ordered action policy:

1. If current holdings fail the same 550% gate, move to the best safe candidate when one exists.
2. If the signal state changed, re-evaluate and move to the best safe candidate.
3. If current exposure is inside the inclusive +/-0.05x band, do not trade.
4. If current holdings exactly equal the current best safe candidate, do not trade even when the raw
   gap exceeds 0.05x. Report `best-feasible / granularity-limited / no-trade`.
5. Otherwise, move to the best safe candidate.

A roll always forces re-evaluation and the required contract-month change. Missing valuation or an
unexecutable allocation never turns into a trade recommendation.

## 6. Funding outputs and execution readiness

The allocator chooses positions; it does not create capital. For the selected candidate output:

- `requiredInitialMargin`;
- `requiredMaintenanceMargin`;
- `required550Equity`;
- `requiredInternalTopUp = max(0, required550Equity - decisionTimeFuturesEquity)`.

An internal transfer reduces outside cash by the same amount and does not increase strategy equity.
`executionReady` is true only when current immediately transferable outside cash is at least
`requiredInternalTopUp`. If accounting outside cash and immediately transferable cash differ, use the
latter for execution readiness but retain the former in strategy equity. Missing transferable-cash
confirmation is not treated as unlimited funds.

Same-decision fees, tax and fills do not feed back into that decision's sizing. They are recognised in
the ledger and subsequent valuation; a post-trade breach remains a risk event rather than a retroactive
change to the preregistered choice.

## 7. Frozen acceptance cases

At price 47,428, strategy equity 1,000,000, and effective initial margins TX 701,000,
MTX 175,250, TMF 35,050:

| Target | Required best candidate | Required allocation status |
|---:|---|---|
| 0.5x | TMF 1 | within-band |
| 1.0x | TMF 2 | granularity-limited |
| 1.5x | TMF 3 | granularity-limited |
| 2.0x | TMF 4 | granularity-limited |

TX 1 must fail the dynamic 550% gate. MTX 1 is safe but must not win any of these four ranks. Tests
must also cover changed margins/equity proving that no product has a hard-coded capital threshold.

## 8. Historical comparison gate

Use the Phase A accepted exact-rule signal and the identical futures/margin inputs:

- futures rows: 30,065;
- futures SHA-256: `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`;
- calibrated margin state/event count: 57;
- preserved missing margin CSV count: 2;
- evaluation: 2017-03-30 through 2026-09-15.

Do not run v1.27 performance if an integrity gate differs. Preserve signal, 500/550 transfers,
inclusive 0.05x band, cash yield, slippage, costs and roll rule. Compare v1.27 against the accepted
Exact-rule v1.26 run and report all requested performance, exposure, risk, status, product-use and
different-holdings-day metrics. Classify holdings differences by the allocator condition that caused
them. Do not revise this protocol after seeing those outputs.
