# v1.18 — 0050 futures residual-fill protocol

Date frozen: 2026-09-15
Branch: backtest-v1

## Purpose
Test the user's proposal to use small 0050 futures exposure only to fill **under-exposure caused by integer TX/MTX/TMF contract sizing**. This is an implementation experiment after observing v1.17, so it is **not pristine out-of-sample evidence** and must not be presented as such.

## Frozen core strategy
No signal or regime parameter is changed from v1.17:
- Signal source: 0050.
- Confirmed bear: 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Exposure states: 0.5x / 1.0x / 1.5x / 2.0x account equity.
- Starting capital: NT$1,000,000.
- Main futures book: actual TAIFEX TX/MTX/TMF contracts, same v1.17 roll rule and sizing logic.
- User commission per side: TX 38, MTX 19, TMF 16.

## Residual-fill rule
1. Size the main TX/MTX/TMF book exactly as v1.17.
2. Compute the remaining positive notional shortfall versus the strategy target.
3. Only when the main book is under target, add small 0050 futures-equivalent units to minimize the absolute residual.
4. Never add a 0050 residual position when the main book is already at or above target.
5. The residual is not allowed to alter the MA rules or target exposure states.

## 0050 futures modeling for this exploratory pass
Exact historical SRF contract-adjustment bookkeeping across ETF distributions/splits is a separate implementation task. To isolate whether residual filling is economically useful before building that machinery:
- 0050 raw close is used for residual contract notional sizing at 1,000 ETF units per small-contract equivalent.
- 0050 adjusted-close total return is used for the residual directional P&L proxy.
- This therefore estimates a **small-0050-futures-equivalent residual leg**, not a final exact SRF contract ledger.
- ETF-futures transaction tax: 0.002% of notional per side.
- Base assumed residual commission: NT$20 per contract side, with NT$10 and NT$30 sensitivity.
- Residual slippage: one ETF-futures minimum tick per side; tick = NT$0.01 below price 50 and NT$0.05 at/above 50.
- Conservative residual margin diagnostic: initial 10% of residual notional and maintenance 8% of residual notional. This is intentionally conservative relative to many current SRF states.

## Decision questions
This pass is not allowed to redefine the v1.17 replacement threshold. It only answers:
- Does mean absolute exposure tracking error materially improve from v1.17's 6.1 percentage points?
- Does the improvement add enough CAGR/Calmar to matter after residual costs?
- Does combined margin usage remain comfortably safe, including 1.5x and 2.0x margin shocks?

If the residual-fill benefit is material, the next gate is an exact historical SRF contract-adjustment backtest. If it is negligible, no further complexity is justified.
