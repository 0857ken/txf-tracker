# v1.16 protocol — corrected futures proxy using TAIEX total-return index

Protocol frozen before seeing v1.16 output.

## Why v1.15 is not decision-grade
v1.15 used the TAIEX **price index** (^TWII) close-to-close change as a futures P&L proxy. That is too pessimistic for long TAIEX futures because the cash index mechanically drops for cash dividends, while expected dividends are reflected in the futures basis before ex-dividend dates. A long rolling futures position therefore should not be treated as if it directly loses every cash-index dividend drop.

Taiwan Index Plus describes its official TAIEX Futures Index as a long near-month TX rolling strategy and notes it can be used to approximately replicate the TAIEX total-return index. Therefore v1.16 uses the official TWSE **TAIEX total-return index** as the return proxy for the directional futures exposure, while still using the TAIEX price level to size TX/MTX/TMF contract notional and transaction tax.

v1.15 results remain in the research branch as a lower-quality reference and must not be used to decide ETF vs futures.

## Frozen strategy and capital
Same as v1.15:
- Initial capital NT$1,000,000.
- Signal source 0050.
- Confirmed bear = 0050 close <= MA60 and MA60 <= MA60 20 trading days earlier.
- Non-bear 100% 00685L-equivalent; bear 25%; bear+close>MA10 50%; bear+close>MA20 75%; bear ends 100%.
- Futures target mapping = 0.5x / 1.0x / 1.5x / 2.0x current account equity.

## Futures execution costs
User-supplied single-side commission:
- TX: NT$38/contract.
- MTX: NT$19/contract.
- TMF: NT$16/contract.

Other assumptions:
- Futures transaction tax 0.002% of contract notional per transaction side.
- Base slippage 1 index point per contract side; also test 0 and 2 points.
- Monthly roll proxy on trading day before third Wednesday: close old mix + open new mix, charging two transaction sides.
- No interest on unused cash (conservative versus a collateralized futures total-return framework).
- Contract multipliers TX/MTX/TMF = NT$200/50/10 per index point.
- TMF historical-availability date 2024-07-29.

## Return proxy mechanics
- Daily return source for futures exposure: TWSE 發行量加權股價報酬指數 (TAIEX total-return index), fetched from the official TWSE monthly MFI94U endpoint.
- Contract notional / tax sizing source: TAIEX price index (^TWII).
- For a held contract mix, daily futures-proxy P&L = previous close realized contract notional × TAIEX total-return-index daily percentage return.
- This is still a proxy, not actual roll-adjusted TX contract history. It does not reproduce exact basis or each realized roll spread.

## ETF side
Keep v1.13 base-friction 00685L comparison unchanged for continuity: 0.05% commission, 0.10% sell tax, 0.03% slippage on allocation turnover; adjusted-close price path embeds fund expenses and daily-reset mechanics.

## Output
Same main/stress/current-contract tables as v1.15, plus explicit comparison of v1.15 price-index proxy vs v1.16 total-return proxy. Do not alter the signal based on results.