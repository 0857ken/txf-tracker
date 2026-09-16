# v1.24 Operational Robustness Protocol

Date frozen: 2026-09-16
Branch: `backtest-v1`

This diagnostic does **not** change the frozen 0050 signal, MA10/20/60 rules, exposure states, contract denomination logic, roll rule, or the selected 500% reserve floor. It evaluates operational implementation risks only.

## A. Morning-open gap risk (primary new margin-safety test)
Rationale: TX/MTX/TMF are designated by TAIFEX as after-hours products exempt from mandatory broker liquidation during the after-hours session. Therefore the primary liquidation-risk checkpoint for the held portfolio is the next general-session open, not the after-hours intraday low.

Method:
- Keep the position established at the prior general-session close.
- Mark that position from prior general-session close to the next general-session **open** using actual TAIFEX regular-session contract open prices.
- No same-morning external transfer rescue is assumed before the open.
- Compute futures-account equity / required initial margin and equity / maintenance margin at the open.
- Use the margin schedule actually applicable at that open; a margin change stated as effective after a given general-session close is not applied to that morning's open.
- Report worst open ratio/date, open-to-prior-close move, position, initial/maintenance margins, and breach counts.
- Stress broker/exchange margin requirement multipliers of 1.0x, 1.2x, 1.5x, and 2.0x against the existing cash allocation without assuming an immediate transfer.

## B. 500% floor with hysteresis / buffer band
The hard operational trigger remains 500%. Only the refill/reset target varies.

Frozen candidate reset targets:
- 500%
- 525%
- 550%
- 575%
- 600%

Rules:
- At the first trading day of each month, move cash so the futures account targets the reset ratio, capped by total available strategy equity.
- Between month boundaries, do nothing while broker ratio is >=500%.
- If broker ratio falls below 500% at the close, transfer external cash inward to the candidate reset target, capped by available external cash.
- No extra outward sweep between month boundaries.
- External sleeve earns 1.5% gross; futures-account cash earns 0%.

Report for each candidate:
- terminal wealth, CAGR, MDD, Calmar
- cumulative external interest
- total transfer count and gross transferred amount
- emergency top-up count
- minimum close ratio and morning-open ratio
- external-cash share

Selection criterion is operational, not alpha optimization. Favor a candidate that materially reduces emergency top-ups without meaningfully reducing CAGR. Do not change the 500% floor based on results.

## C. Slippage robustness
Using the plain 500% reset version, rerun with slippage of:
- 1 point / contract side
- 3 points / contract side
- 5 points / contract side

All other assumptions fixed.

## D. External-liquidity delay diagnostic
Compare:
1. current same-close emergency transfer availability;
2. conservative T+1 emergency transfer, where a requested inward transfer is unavailable for the entire next general-session open and is credited only after that next trading day's close.

Monthly scheduled sweeps remain available at the close on the scheduled day. No same-morning rescue is allowed in either case for the open-gap test.

Report performance and minimum close/open ratios, plus any maintenance-equivalent breaches.

## E. Data-integrity gate
- Fixed sample remains 2017-03-30 through 2026-09-15.
- Expected contract-day row count is 30,065 for TX/MTX/TMF regular-session monthly contracts.
- Fail the run if row count differs.
- Print a deterministic SHA-256 hash of the sorted futures input fields used by this test so the exact dataset can be frozen for subsequent reruns.

No production branch or live strategy files may be modified by this diagnostic.