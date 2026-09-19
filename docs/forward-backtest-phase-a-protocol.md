# Forward / Backtest consistency — Phase A gate

Status: preparation only; historical parity and Exact-rule parity run NOT completed.
No performance result is inferred from unit tests.

## Frozen baseline

- Forward source: 5693fded53b64de12ee8c465e153e8fb36b4033c.
- Research: origin/backtest-v1, v1.26 implementation and its inherited dependencies.
- Evaluation: 2017-03-30 through 2026-09-15, with at least 80 earlier/available observations for each evaluated signal.
- Preserve allocator, execution prices/timing, contract availability, roll rule,
  commissions, tax, one-point slippage, 1.5% outside yield, 500/550 management,
  and 0.05x band. Do not introduce Phases B–E into this comparison.
- Prior reported futures input: 30,065 rows, SHA256
  8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b.
  A report is not a substitute for the underlying input dataset.
- Frozen v1.26 run 35057843114 reported `margin_events 57` and
  `missing_margin_csv 2`. Phase A must reproduce both counts and must not
  reinterpret or replace either missing 2020 announcement.

## Exact rule (ordered)

1. bear = close < MA60 AND MA60 < MA60_20ago.
2. If not bear: 2.0.
3. Otherwise if close >= MA20: 1.5.
4. Otherwise if close > MA10: 1.0.
5. Otherwise: 0.5.

MA20 has priority, including crossed averages. No epsilon or display rounding
may alter a comparison.

## Price definition and provenance

The inherited research loader uses yfinance auto_adjust=True. Forward currently
uses Yahoo quote.close rounded to two decimals: these are NOT price parity.
The intended common signal series is Yahoo adjusted close (dividend/split
adjustments), at source precision, for both Python and JS. Raw tradeable prices
must remain separate from adjusted signal prices. Never silently substitute raw
close when adjusted close is missing.

Archive raw close, adjusted close, adjustment factor, corporate actions, fetch
time, source, library version and content hash. Compute all moving averages and
lagged MA60 from the same frozen series. A later adjusted-price revision must not
overwrite an already archived Forward decision. Historical revised-series parity
does not establish point-in-time corporate-action correctness.

Before enabling this definition in Forward, validate at least 80 actual trading
days across Python and JS, including corporate-action windows, all intermediate
MA values and exact targets. Synthetic tests are supplemental, not a replacement.

## Required comparison artifacts

- Daily old/new targets and reason per changed date; count of differing dates.
- Separate identical-series signal-only comparison from any source-price change.
- Re-run unchanged v1.26 and Exact-rule parity run on the same frozen inputs.
- Terminal wealth, CAGR, MDD, Calmar, sides, costs, mean/P95/max absolute exposure
  error, minimum close and next-open risk ratios, with input/code hashes.
- Preserve pandas rolling numerical semantics for the baseline; investigate any
  Python/JS floating-point boundary difference rather than rounding it away.

## Gate / current evidence

On 2026-09-19: 68 existing Node tests and 2 Python unittest tests passed.
These do not establish historical parity. Original v1.26 Actions run 35057843114
has no downloadable artifacts. No local CSV/parquet historical input was found.
Yahoo query1 chart request returned HTTP 429. Historical daily differences and
performance metrics are therefore pending, not zero and not accepted.

Do not begin Phase B until Phase A's historical comparison and unchanged-allocator
rerun complete. Do not label Exact-rule parity run a new strategy. Phase C must
freeze its ranking protocol before results are generated. No production writes.
