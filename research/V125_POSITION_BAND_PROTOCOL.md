# v1.25 Position No-Trade Band Protocol

Date frozen: 2026-09-16
Branch: `backtest-v1`

Purpose: test whether unnecessary same-signal integer-contract rebalancing can be reduced without materially changing exposure or performance.

## Frozen strategy
No changes to 0050 signal, MA10/20/60, exposure states, roll rule, commissions, futures tax, 1-point base slippage, 1.5% external-cash yield assumption, or the **500% broker-style reserve trigger/reset**. This test intentionally uses the plain 500% cash rule so the position-band effect is isolated from the v1.24 cash-buffer result.

## Position-band rule
Candidate absolute exposure bands around the target index exposure:
- 0.000x (baseline: resize to current integer optimum every close)
- 0.025x
- 0.050x
- 0.075x
- 0.100x

At each regular-session close:
1. If the target exposure state changed, resize normally regardless of the band.
2. If the active monthly contract changed / roll is required, roll normally regardless of the band.
3. Otherwise compute current held notional / combined strategy equity at that close.
4. If absolute deviation from target exposure is within the candidate band, keep the existing integer contract quantities.
5. If outside the band, resize using the same frozen TX-first / MTX / TMF denomination algorithm.

## Report
For each candidate:
- terminal wealth, CAGR, MDD, Calmar
- contract transaction sides and total modeled transaction costs
- number of trading days with quantity changes
- mean and 95th-percentile absolute exposure tracking error
- maximum absolute exposure tracking error
- minimum close broker ratio and minimum next-regular-session opening ratio
- cumulative external interest

Selection is operational rather than return-maximizing: prefer the smallest band that materially reduces transaction activity while keeping exposure tracking error and performance close to baseline. No signal parameter may be changed based on this result.

Data-integrity gate remains 30,065 contract-day rows and the same v1.24 SHA-256 dataset hash where applicable.