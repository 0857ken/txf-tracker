# Backtest v1.9 — Tactical 00685L hybrid

Data through: 2026-09-15

## User idea tested
Use the existing MA60 confirmed-bear regime to reduce 00685L exposure, then optionally buy 00685L back in stages after a further pullback, aiming to keep most of 00685L's upside while avoiding its full drawdown.

## Signal and execution assumptions
- Regime signal source: 0050.
- Confirmed bear: 0050 close <= MA60 **and** MA60 <= MA60 from 20 trading days earlier.
- Outside confirmed bear: hold 100% 00685L.
- On entry into confirmed bear: cut 00685L allocation to 0%, 25%, or 50% depending on variant.
- For staged-rebuy variants, freeze the 0050 prior 60-trading-day high at bear entry and increase 00685L allocation as 0050 drawdown reaches one of these grids:
  - -3% / -6% / -9%
  - -5% / -10% / -15%
  - -6% / -9% / -12%
  - -8% / -12% / -16%
- Rebuy exposure floors at the three thresholds: 25% / 50% / 100% 00685L.
- When confirmed bear ends: return to 100% 00685L.
- Signals are known after close; target is applied with a one-day lag to adjusted close-to-close returns.
- Adjusted close returns are used because some historical 00685L open fields from the data source are zero/invalid.
- No taxes, commissions, slippage, or cash interest.

## Main result
Only 2 of 15 simple variants kept since-listing MDD within 40%, and **both were no-rebuy variants**.

| Rule | Since-listing total | CAGR | MDD | Calmar | 5Y total | 5Y MDD | 3Y total | 3Y MDD | Avg 00685L allocation |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hold 100% normally; cut to 25% in confirmed bear; no staged rebuy** | **+2318.1%** | **40.0%** | **-36.8%** | **1.09** | +677.8% | -36.8% | +537.2% | -36.8% | 88% |
| Hold 100% normally; cut to 0% in confirmed bear; no staged rebuy | +2092.3% | 38.6% | -36.8% | 1.05 | +712.1% | -36.8% | +549.9% | -36.8% | 84% |

## Benchmarks since 00685L listing

| Strategy | Total | CAGR | MDD | Calmar |
|---|---:|---:|---:|---:|
| **00685L buy & hold** | **+2716.2%** | **42.3%** | **-54.8%** | 0.77 |
| **Tactical 00685L: 100% normal / 25% bear** | **+2318.1%** | **40.0%** | **-36.8%** | **1.09** |
| Current C 3/3/0.25 applied to TAIEX proxy | +1240.4% | 31.6% | -37.3% | 0.85 |
| TAIEX 1x | +364.8% | 17.6% | -31.6% | 0.56 |

The tactical 00685L rule retained most of buy-and-hold CAGR (40.0% vs 42.3%) while reducing historical maximum drawdown by roughly 18 percentage points (-36.8% vs -54.8%).

## Stress windows — best simple rule vs 00685L buy & hold

| Window | Tactical 00685L total | Tactical MDD | 00685L total | 00685L MDD |
|---|---:|---:|---:|---:|
| 2018 | -25.0% | -31.8% | -12.9% | -27.1% |
| COVID 2020 | +53.0% | -34.7% | +62.8% | -50.8% |
| 2022 | -20.8% | -28.8% | -34.1% | -48.9% |
| 2025–2026 | +276.0% | -33.3% | +234.2% | -49.8% |

## What happened to staged buybacks?
The staged-rebuy variants did **not** solve the drawdown problem in this first test. The highest-return variants were around 43–44% CAGR but still had roughly -49% to -51% MDD. Examples:
- cut 50%, rebuy at -8/-12/-16: CAGR 44.0%, MDD -49.5%
- cut 25%, rebuy at -8/-12/-16: CAGR 43.1%, MDD -49.5%
- cut 50%, rebuy at -5/-10/-15: CAGR 43.0%, MDD -50.8%

Interpretation: buying 00685L back while the confirmed-bear condition is still active restores too much 2x downside exposure before the downtrend has actually ended.

## Current takeaway
The user's core idea is strongly supported, but the useful part in this first pass is **trend-based de-risking**, not blind dip-buying during a confirmed bear market.

A surprisingly strong simple candidate is:

> **Normal / non-bear: 100% 00685L**  
> **Confirmed bear: 25% 00685L**  
> **Bear ends: return to 100% 00685L**

This candidate materially improves risk-adjusted return versus both 00685L buy-and-hold and the current C/TXF proxy in this in-sample history. It is not yet production-ready. The next useful test is to keep the 100%/25% regime rule fixed and test a **recovery-triggered** add-back (e.g. price recovers above short MA / prior drawdown low by X% / bear condition partially clears), rather than adding merely because price has fallen farther.
