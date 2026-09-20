# v1.27 Data Integrity Gate Addendum

Status: frozen before resuming the Phase C historical comparison.

This addendum changes research-data validation only. It does not amend the preregistered v1.27
allocator candidate set, 550% hard gate, ranking, 500/550 funding rules, inclusive 0.05x band, MA
rules, target exposures, transaction assumptions, or any Phase D/E rule.

## Unchanged hard gates

The run stops before performance comparison unless all four values match exactly:

- TAIFEX contract-day rows: 30,065;
- TAIFEX canonical SHA-256: `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`;
- reconstructed margin states: 57;
- preserved missing margin CSV records: 2.

## Yahoo audit metadata

0050 continues to use Yahoo Finance through `yfinance`, with `auto_adjust=True` and
`actions=False`. Every run records row count, first and last date, yfinance version, download time,
and the raw adjusted-close SHA-256. The Phase A raw hash is retained as an audit reference; equality
is reported but is not a hard gate because source precision can change without changing the signal
schedule.

Raw Yahoo prices must not be committed to the public repository.

## Semantic signal gate

Every download derives one canonical UTF-8 schedule with LF endings and this exact header:

`date,exact_bear,target_x`

Rows use `YYYY-MM-DD`, lower-case `true`/`false`, and target formatted to one decimal place. The
SHA-256 of those exact bytes is `signalScheduleSha256`. The full derived schedule is uploaded as a
research artifact; it contains no raw Yahoo price.

Before v1.27 may run, all of the following must pass:

- 0050 range is 2016-01-04 through 2026-09-15 and contains 2,602 rows;
- Python versus JavaScript semantic calculation has zero mismatches;
- old v1.26 target versus exact-rule target differs on zero evaluation days;
- the same exact signal schedule reproduces the accepted v1.26 metrics within the frozen
  per-metric tolerances implemented in `scripts/phase-c-v127-backtest.py`.

If reproduction fails, v1.27 is not executed. Both allocators receive the same schedule, futures,
margins, roll rule, costs, slippage, cash yield and transfer assumptions. Only allocator selection
may differ.
