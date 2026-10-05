# Strategy 4 — Fubon 0050 feed integration candidate

Branch: `feature/strategy4-fubon-feed-2026-10-05`

This candidate wires the published read-only `data/fubon_market_data.json`
0050 close into Strategy 4 without modifying the accepted strategy engine.

- Fubon is accepted only when the payload is schema v1, symbol is 0050, the
  date and close are valid, and `isClose === true`.
- `data/strategy_data.json` remains the historical 0050 series for MA
  lookback.
- `data/market_data.json` remains the Taiwan weighted-index source.
- Missing, invalid, unclosed, or older Fubon snapshots fail closed for
  current-day close confirmation.
- Same-date Fubon data replaces only that day's close; it never duplicates a
  trading date.
- TX/MTX/TMF live quotes are not introduced here. Existing futures valuation
  and allocation readiness continue to fail closed when futures marks are
  unavailable.
- No order, account, position, or funds API is introduced.

Frozen engine files remain byte-identical:
`defense-core.js`, `defense-governance.js`, and `defense-ledger.js`.
The MA rules, four exposure levels, dynamic strategy equity, 500/550 gates,
±0.05x band, 13:30 signal gate, 13:45 EOD gate, margin governance, and
allocator logic are unchanged.

This branch is an integration candidate only. It does not modify `gh-pages`
or `main`. The Strategy 4 account/storage mode remains preview until a
separate production-storage acceptance is approved.
