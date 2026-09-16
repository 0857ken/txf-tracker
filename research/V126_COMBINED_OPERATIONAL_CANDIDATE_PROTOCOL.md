# v1.26 Combined Operational Candidate Protocol

Date frozen: 2026-09-16
Branch: `backtest-v1`

Purpose: verify that the two independently identified operational improvements remain compatible when applied together, without changing the frozen market signal.

Candidate:
- broker-style reserve **floor / trigger remains 500%**;
- month-start and emergency refill **reset target = 550%**;
- position no-trade band = **±0.05x index exposure** when the signal state and active contract month are unchanged;
- signal-state changes and monthly futures rolls always resize/roll regardless of the position band;
- external sleeve gross yield = 1.5%; futures-account cash yield = 0%;
- base slippage = 1 point per contract side;
- all other v1.17/v1.24/v1.25 rules unchanged.

This is a confirmation run, not a search. Report terminal wealth, CAGR, MDD, Calmar, contract sides, transaction costs, exposure tracking error, minimum close broker ratio, minimum next-general-session opening ratio, and next-open margin shocks at 1.2x/1.5x/2.0x requirements. Compare descriptively with the plain 500% / no-position-band baseline. Do not retune after seeing the result.