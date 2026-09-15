# Backtest v1.17 — Actual TAIFEX Futures / Margin-First Validation

Date: 2026-09-15
Branch: `backtest-v1`

## Scope
This test implements the previously frozen v1.17 protocol using actual TAIFEX daily contract data for TX / MTX / TMF, not a cash-index return proxy. The strategy signal is unchanged and remains based on 0050.

Data window: 2017-03-30 through 2026-09-15. Starting capital: **NT$1,000,000**.

Actual futures dataset downloaded from TAIFEX contained 30,065 contract-day rows: TX 13,401; MTX 13,544; TMF 3,120. TMF is only used from its actual historical availability onward.

## Frozen signal / exposure mapping
- Confirmed bear = 0050 close <= MA60 AND MA60 <= MA60 20 trading days earlier.
- Non-bear = 100% 00685L-equivalent = 2.0x index notional exposure.
- Confirmed bear = 25% equivalent = 0.5x.
- Still bear + 0050 close > MA10 = 50% equivalent = 1.0x.
- Still bear + 0050 close > MA20 = 75% equivalent = 1.5x.
- Bear ends = 100% equivalent = 2.0x.

Positions use integer TX/MTX/TMF contracts. Roll rule is the trading day before the third Wednesday. The execution proxy uses the actual regular-session futures close after the 0050 closing signal; no earlier same-day futures price is used.

User-supplied single-side commissions: TX NT$38, MTX NT$19, TMF NT$16. Futures transaction tax is modeled at 0.002% of contract notional per side. Slippage is tested at 0, 1 and 2 index points per contract side. Unused cash earns 0%.

## Historical margin reconstruction
57 margin states/adjustments were assembled for the test period. A continuity audit after correction found **0 margin-chain mismatches**. Two January-2020 announcements did not expose a machine-readable CSV through the current archive and were entered from the corresponding official TAIFEX announcement values; the resulting chain reconciles with the next machine-readable adjustment.

## Main result

| Slippage / side | Terminal value | Total return | CAGR | MDD | Calmar | Max initial-margin usage | Max maintenance usage | Max regular-session-low maintenance usage |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 pt | NT$32,355,855 | +3135.6% | 44.4% | -37.9% | 1.17 | 18.0% | 13.8% | 13.9% |
| **1 pt** | **NT$31,504,877** | **+3050.5%** | **44.0%** | **-38.2%** | **1.15** | **17.9%** | **13.8%** | **13.9%** |
| 2 pt | NT$28,966,863 | +2796.7% | 42.7% | -38.3% | 1.12 | 18.1% | 13.9% | 14.0% |

## Margin-first gate — 1-point base case
The worst normal initial-margin utilization occurred on **2025-06-02**:

- Account equity: **NT$7,403,921**
- Holdings: **TX 3 / MTX 2 / TMF 1**
- Target exposure state: **2.0x**
- Contract expiry: 202506
- Required initial margin: **NT$1,327,700**
- Required maintenance margin: **NT$1,018,850**
- Initial-margin usage: **17.9%**
- Maintenance-margin usage: **13.8%**
- Free equity after initial margin: **NT$6,076,221**
- Regular-session-low maintenance-use proxy: **13.9%**

### Margin shocks

| Margin multiplier | Max initial-margin usage | Max maintenance usage | Maintenance breach days | Free equity at worst initial-margin date |
|---:|---:|---:|---:|---:|
| 1.0x | 17.9% | 13.8% | 0 | NT$6,076,221 |
| 1.5x | 26.9% | 20.6% | 0 | NT$5,412,371 |
| **2.0x** | **35.9%** | **27.5%** | **0** | **NT$4,748,521** |

Pre-registered margin gates:
- M1 survival: **PASS** — no maintenance-margin breach.
- M2 max original margin <= 50%: **PASS** — actual 17.9%.
- M3 1.5x shock: **PASS** — max maintenance usage 20.6%, no breach.
- M3 2.0x shock: **PASS** — max maintenance usage 27.5%, no breach.

**OVERALL MARGIN RESULT: PASS.**

## Performance gate versus 00685L
Frozen benchmark from the prior 00685L implementation: CAGR 44.1%, MDD -36.8%, Calmar 1.20.

The pre-registered 1-point futures requirements were CAGR >=44.6%, MDD no worse than -38.8%, and Calmar >=1.20.

| Gate | Required | Actual | Result |
|---|---:|---:|---|
| CAGR | >=44.6% | 44.0% | **FAIL** |
| MDD | >=-38.8% | -38.2% | **PASS** |
| Calmar | >=1.20 | 1.15 | **FAIL** |

**OVERALL PERFORMANCE RESULT: FAIL under the pre-registered replacement standard.**

The difference from 00685L is small in absolute terms: the 1-point actual-futures run ended at approximately NT$31.505m versus the prior 00685L reference of about NT$31.701m from the same NT$1m starting scale. The result therefore does not show a material historical performance advantage sufficient to justify formally replacing 00685L solely on return/risk grounds.

## Stress windows — 1-point base case

| Window | Futures total return | Futures MDD |
|---|---:|---:|
| 2018 | -22.6% | -30.6% |
| COVID 2020 | +68.2% | -34.2% |
| 2022 | -16.9% | -29.7% |
| 2023–2024 | +150.3% | -38.2% |
| 2025–2026 | +295.4% | -33.1% |

## Costs and sizing — 1-point base case
- Total modeled futures transaction costs: **NT$265,053**
- Contract transaction sides: **1,878**
- Average realized index exposure: **1.803x**
- Mean absolute exposure tracking error versus the target state: **6.1 percentage points**, caused by integer-contract sizing.

## Interpretation
The user’s primary concern — margin sufficiency — passes with a wide historical buffer. Even after doubling every historical margin requirement in the stress test, the maximum maintenance-margin usage was only 27.5%, with zero breach days. Under this historical implementation, margin was not the limiting risk.

However, actual-contract performance does not pass the pre-registered threshold for replacing 00685L. At 1-point slippage, futures CAGR was 44.0% and Calmar 1.15, versus the frozen 00685L benchmark of 44.1% CAGR and 1.20 Calmar. This is materially less optimistic than the v1.16 total-return-index proxy and demonstrates why the actual-contract gate was necessary.

Therefore the current decision is:
- **Futures execution is historically feasible from a margin perspective for the NT$1m test account.**
- **It is not yet justified to replace 00685L solely because of superior backtested performance.**
- 00685L remains the observed benchmark; futures remains a viable alternative when intraday flexibility, capital efficiency, or futures-specific execution benefits are valued.

No strategy parameters or acceptance thresholds were relaxed after observing these results.
