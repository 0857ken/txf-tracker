# TXF Tracker — Codex / Coding Agent Instructions

Repository: `0857ken/txf-tracker`. This file is shared engineering context for the ChatGPT 「投資秘書」project and Codex. Do **not** assume Codex can read the ChatGPT project's conversations or memory automatically. Inspect real code and GitHub history for each task.

## Scope and branch safety

- Production: GitHub Pages + GitHub Actions + Firebase Firestore + LINE; **no always-on production server**.
- `gh-pages`: production website, JavaScript, Python scripts, tests, docs and public data files. For website/script changes, branch from the current `gh-pages`, create a small PR against `gh-pages`.
- `main`: production scheduled GitHub Actions workflows must live on `main`. For schedule/workflow changes, branch from the current `main` and PR against `main`; never move schedules to `gh-pages`.
- Workflows that commit to `gh-pages` must `git pull --rebase origin gh-pages` before pushing, to handle concurrent scheduled commits.
- Default checkout branches may not contain the same files. Confirm `git branch`, `git status`, and file paths before editing; do not copy the old `main` app into `gh-pages`.
- Treat older `README.md` and archived files as potentially obsolete; currently deployed code and validated tests take precedence. Do not revive old multiplier values from historical docs.
- Do not merge/deploy a new feature, edit Firestore data or rules, or enable a schedule without explicit user approval. Keep PRs small, scoped, and easy to revert. Report changed files, validation and deployment checks.

## Frozen business and accounting rules

- Futures point multipliers: **TXF / TX = 200; MXF / MTX = 50; TMF = 10**. Never use old `TXF_POINT = {50,10,5}` or treat `^TWII` as an actual futures quote.
- Futures leverage = **futures notional exposure / 2,000,000**. The denominator is fixed, never dynamic account equity.
- Monthly volatility grid high = **rolling 20-trading-day high**, not calendar-month high. Preserve the benchmark pullback `gridActive` activation condition.
- `strategy-calc.js` and `strategy_calc.py` implement strategies independently; examine and test **both** whenever strategy formulas change.
- 「0050 變速防守」 (strategy ID `0050-defense-v1`) is the authoritative forward futures account. Actual positions come from its formal account state. `users/me/positions` is a legacy **read-only cost backup**, not an independent position master.
- Futures cost basis and future realized P&L use the post-cutover futures trade ledger; reconcile lots with the formal account rather than inventing fills. For realized P&L, do not double count broker-reconciled historical entries. TMF=10 per point for every P&L calculation.
- `data/market_data.json` is the **^TWII benchmark**, not a futures quote. Formal TAIFEX contract-month settlements are stored separately in `data/futures_market.json`; always verify product + month + as-of date. Do not mislabel settlement prices as live quotes.
- Daily NAV snapshots are in `users/me/dailySnapshots/{YYYY-MM-DD}`. Preserve existing schemas, historical snapshots, idempotent daily writes and the distinction between realized and unrealized P&L. Stop writes rather than invent missing prices or mixing stale dates.
- The `follow.html` friend-following portfolio is an independent ledger; do not silently merge it into the 2,000,000 plan.

## Firebase, LINE and security

- Keep formal secure Firestore rules; **never enable temporary 30-day permissive test rules**.
- Firebase ES-module loading is asynchronous. Keep `fbReady` / `waitInit`-style initialization and authorization checks.
- LINE strategy sections are appended **only when a strategy emits a signal**; do not turn them into unconditional daily broadcasts. Preserve stock alert baseline / re-arm / dedup semantics.
- Never ask for, print, embed, commit or echo `LINE_TOKEN`, `FIREBASE_KEY`, service-account private keys or other secrets. Use existing environment secret references only, and redact logs.
- Fubon Neo market-data integration is read-only. Do not add broker order placement or modify a frozen production-like qualification environment without a separate approved task.

## UI and regression safety

- Preserve the mobile-first dark dashboard: ~`#0a0e1a` background, semantic blue/gold/red/green and monospaced numbers. Avoid unrelated redesigns.
- `closePosition` and `sellStock` rely on cost parameters passed through HTML `onclick`; do not drop those parameters during refactors.
- Protect the existing working views: `index.html`, `stocks.html`, `assets.html`, `strategy.html`, `defense.html`, `follow.html` and associated scripts.
- Do not change strategy signals, exposure rules or accounting while doing display-only tasks.

## Validation and handoff

- Read the **actual targeted files** before changing them; avoid guessing from earlier chat summaries or comments.
- Run suitable Node syntax/unit tests, Python compile/tests, lint/diff checks and targeted mock or fixture tests in the Codex/cloud runtime. The user's older macOS computer has no usable modern Python; **never ask the user to install or run Python locally**.
- Explicitly list assumptions and known limitations. Do not claim live pricing, successful Firebase writes or finished deployment from static tests.
- Use GitHub Actions logs and actual deployed Pages screenshots for final acceptance. If deployment requires user action, give **one stage at a time** and wait for the user.
- ChatGPT「投資秘書」handles goals, requirements and final review; Codex implements narrowly scoped, testable PRs. Include PR URL, branch, changed files, test results, and outstanding decisions when handing work back.
