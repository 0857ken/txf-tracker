# Phase C v1.27 validation record

Status: implementation and deterministic tests complete; historical comparison blocked by the
preregistered signal-data integrity gate. No Phase D/E work was started.

## Traceability

- Branch: `feature/v127-margin-aware`
- Phase B parent: `c903cb5e1d5508d50ea8e41f2b531c38a690c9fb`
- Protocol preregistration: `c3c89f950752e56121d8620ef47166312ca67bfc`
- Phase A accepted workflow run: `35438574240`
- Frozen futures expectation: 30,065 rows, SHA-256
  `8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b`
- Frozen adjusted-close expectation:
  `1398efdf099d4a5884eb631fc5fb205a148ccf11380b75aa07408c1419523fdf`
- Frozen margin expectation: 57 states and 2 preserved missing CSV records.

## Deterministic acceptance result

At futures price 47,428 and strategy equity NT$1,000,000, the allocator returns:

| Target | Selected position | Status |
|---:|---|---|
| 0.5x | TMF 1 | within-band |
| 1.0x | TMF 2 | granularity-limited |
| 1.5x | TMF 3 | granularity-limited |
| 2.0x | TMF 4 | granularity-limited |

TX 1 fails the dynamic 550% gate in this fixture. MTX 1 is feasible but does not win any of the four
frozen ranks. A separate test raises equity sufficiently and proves TX is then selected, so there is
no fixed product/capital ban.

The allocator also returns initial margin, maintenance margin, 500% and 550% required equity,
internal top-up, and execution readiness. Missing/stale valuation returns `valuation-unavailable`;
non-positive strategy equity returns `infeasible`; neither produces suggested lots. A current
best-safe granularity-limited position produces no repeated daily rebalance.

## Tests

- JavaScript: 86 passed, 0 failed.
- Python: 2 passed, 0 failed.
- Python compile check: passed.
- Whitespace/diff check: passed.
- Existing three-strategy regression checks remain included in the 86-test suite.

## Historical comparison gate result

The local reconstruction completed all 280 TAIFEX chunks using the original source/parser and
entered the original margin-event flow. Yahoo Finance then returned HTTP 429 on every
`yfinance.download(..., auto_adjust=True)` retry, so the accepted Phase A adjusted-close series was
not available.

As a diagnostic only, Yahoo's direct chart endpoints returned 2,602 rows for the same date range,
but their adjusted-close hashes were `5367165d21ccf8239d688ec1621e8782a7a3a606fac6f6404ce09708014d4eb5`
and `c29928f14580bd96a721517de9dded25b72a4aa8dbc22b42589544c860adf8ee`. Both differ from the frozen
Phase A hash and even from each other. They were rejected and were not used for performance.

Therefore terminal wealth, CAGR, MDD, Calmar, turnover, cost, historical exposure/risk statistics,
product-use proportions, and different-holdings dates remain intentionally unreported. Producing
them from either mismatched series would violate the preregistered gate.

## Isolated rerun path

`.github/workflows/phase-c-v127-research.yml` is restricted to
`feature/v127-margin-aware`, checks out the frozen `backtest-v1` baseline, runs all JavaScript tests,
then runs the historical comparison and uploads reports. The workflow has not run because GitHub
HTTPS authentication was unavailable; no branch, main, gh-pages, Railway, Firestore, or deployment
state was changed.
