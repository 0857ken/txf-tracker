#!/usr/bin/env python3
"""Phase A only: rebuild frozen v1.26 inputs and compare its signal to exact Forward rules."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

EXPECTED_FUTURES_ROWS = 30065
EXPECTED_FUTURES_SHA = "8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b"
EXPECTED_MARGIN_STATES = 57
EXPECTED_MISSING_MARGIN_CSV = 2
EVAL_START = pd.Timestamp("2017-03-30")
EVAL_END = pd.Timestamp("2026-09-15")
REFERENCE = {
    "terminal": 32734579.0, "cagr": 0.44598, "mdd": -0.37750,
    "calmar": 1.181, "sides": 1486, "cost": 252345.0,
    "mean_exposure_error": 0.0671, "p95_exposure_error": 0.1964,
    "max_exposure_error": 0.2219, "min_close_risk": 5.00220,
    "min_next_open_risk": 4.18975,
}


def sha_lines(frame: pd.DataFrame, columns: list[str]) -> str:
    z = frame[columns].copy()
    if isinstance(z.index, pd.DatetimeIndex):
        z.insert(0, "date", z.index.strftime("%Y-%m-%d"))
    raw = z.to_csv(index=False, float_format="%.10g", lineterminator="\n")
    return hashlib.sha256(raw.encode()).hexdigest()


def load_v126(root: Path) -> dict:
    os.chdir(root)
    p = Path("research/backtest_v125_position_band.py")
    s = p.read_text(encoding="utf-8")
    s = s.replace("RESERVE=5.0\nBANDS=[0.0,0.025,0.05,0.075,0.10]",
                  "FLOOR=5.0\nRESET=5.5\nBANDS=[0.05]", 1)
    old = """            target_cash=RESERVE*im
            if is_first_month_day:
                desired_fut=min(before,target_cash); transfer=desired_fut-fut_cash
            elif fut_cash<target_cash:
                transfer=min(external,target_cash-fut_cash)
"""
    new = """            target_cash=RESET*im
            floor_cash=FLOOR*im
            if is_first_month_day:
                desired_fut=min(before,target_cash); transfer=desired_fut-fut_cash
            elif fut_cash<floor_cash:
                transfer=min(external,target_cash-fut_cash)
"""
    if old not in s:
        raise RuntimeError("V126_PATCH_GATE: reserve block missing")
    s = s.replace(old, new, 1)
    prefix = s.split("print('V125_BEGIN')", 1)[0]
    ns = {"__name__": "phase_a_v126", "__file__": str(p)}
    exec(compile(prefix, str(p), "exec"), ns)
    return ns


def download_signal() -> tuple[pd.DataFrame, dict]:
    last = None
    for attempt in range(4):
        try:
            x = yf.download("0050.TW", start="2016-01-01", end="2026-09-16",
                            auto_adjust=True, actions=False, progress=False, threads=False,
                            timeout=45)
            if len(x):
                break
        except Exception as exc:
            last = exc
        if attempt == 3:
            raise RuntimeError(f"YAHOO_ADJUSTED_DOWNLOAD_FAILED: {last!r}")
        import time
        time.sleep(15 * (2 ** attempt))
    if isinstance(x.columns, pd.MultiIndex):
        x.columns = x.columns.get_level_values(0)
    x.columns = [str(c).lower() for c in x.columns]
    x.index = pd.to_datetime(x.index).tz_localize(None)
    x = x.sort_index()
    if x.index.has_duplicates or not x.index.is_monotonic_increasing:
        raise RuntimeError("0050_DATE_INTEGRITY_FAIL")
    x = x[["close"]].dropna()
    for n in (10, 20, 60):
        x[f"ma{n}"] = x.close.rolling(n).mean()
    x["ma60_20ago"] = x.ma60.shift(20)
    old_bear = (x.close <= x.ma60) & (x.ma60 <= x.ma60_20ago)
    x["old_bear"] = old_bear
    x["old_target"] = np.where(~old_bear, 2.0,
        np.where(x.close > x.ma20, 1.5, np.where(x.close > x.ma10, 1.0, 0.5)))
    exact_bear = (x.close < x.ma60) & (x.ma60 < x.ma60_20ago)
    x["exact_bear"] = exact_bear
    x["exact_target"] = np.where(~exact_bear, 2.0,
        np.where(x.close >= x.ma20, 1.5, np.where(x.close > x.ma10, 1.0, 0.5)))
    manifest = {
        "symbol": "0050.TW", "source": "Yahoo Finance via yfinance",
        "corporateActionHandling": "yfinance auto_adjust=True, actions=False; adjusted close used at source precision",
        "start": x.index.min().strftime("%Y-%m-%d"), "end": x.index.max().strftime("%Y-%m-%d"),
        "rows": int(len(x)), "adjustedCloseSha256": sha_lines(x, ["close"]),
        "downloadedAt": datetime.now(timezone.utc).isoformat(),
        "yfinanceVersion": getattr(yf, "__version__", "unknown"),
    }
    return x, manifest


def js_parity(repo: Path, signal: pd.DataFrame) -> dict:
    payload = [{"date": d.strftime("%Y-%m-%d"), "close": float(v)} for d, v in signal.close.items()]
    p = subprocess.run(["node", str(repo / "scripts/phase-a-js-parity.cjs")],
                       input=json.dumps(payload), text=True, capture_output=True, check=True)
    js = pd.DataFrame(json.loads(p.stdout)).set_index("date")
    py = signal.iloc[79:].copy(); py.index = py.index.strftime("%Y-%m-%d")
    fields = [("close", "close"), ("ma10", "ma10"), ("ma20", "ma20"),
              ("ma60", "ma60"), ("ma60_20ago", "ma60_20ago"),
              ("exact_bear", "bear"), ("exact_target", "target_x")]
    mismatches = []
    for a, b in fields:
        if a in ("exact_bear",):
            bad = py[a].astype(bool) != js[b].astype(bool)
        else:
            bad = ~np.isclose(py[a].astype(float), js[b].astype(float), rtol=1e-12, atol=1e-12, equal_nan=True)
        mismatches.extend({"date": d, "field": a, "python": str(py.at[d, a]), "js": str(js.at[d, b])}
                          for d in py.index[bad])
    return {"comparedRows": int(len(py)), "mismatchCount": len(mismatches), "mismatches": mismatches[:100]}


def differences(x: pd.DataFrame) -> list[dict]:
    z = x.loc[EVAL_START:EVAL_END]
    z = z[z.old_target != z.exact_target]
    out = []
    for d, r in z.iterrows():
        reasons = []
        if bool(r.old_bear) != bool(r.exact_bear): reasons.append("strict bear boundary (< instead of <=)")
        if bool(r.exact_bear) and r.close == r.ma20: reasons.append("MA20 equality belongs to 1.5x")
        if not reasons: reasons.append("MA20-priority exact-rule ordering")
        out.append({"date": d.strftime("%Y-%m-%d"), "oldTarget": float(r.old_target),
                    "newTarget": float(r.exact_target), "reason": "; ".join(reasons),
                    "close": float(r.close), "ma10": float(r.ma10), "ma20": float(r.ma20),
                    "ma60": float(r.ma60), "ma60_20ago": float(r.ma60_20ago)})
    return out


def stats(ns: dict, result: pd.DataFrame, px: pd.DataFrame, events) -> dict:
    m = ns["metrics"](result); op = ns["open_gap_audit"](result, px, events)
    ae = result.abs_track_error.dropna()
    return {"terminal": float(m["terminal"]), "cagr": float(m["cagr"]), "mdd": float(m["mdd"]),
            "calmar": float(m["calmar"]), "sides": int(result.attrs["total_sides"]),
            "cost": float(result.attrs["total_cost"]), "mean_exposure_error": float(ae.mean()),
            "p95_exposure_error": float(ae.quantile(.95)), "max_exposure_error": float(ae.max()),
            "min_close_risk": float(result.broker_ratio.dropna().min()),
            "min_next_open_risk": float(op.open_ratio.min())}


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--baseline-root", required=True); ap.add_argument("--output", required=True)
    a = ap.parse_args(); repo = Path(__file__).resolve().parents[1]; baseline = Path(a.baseline_root).resolve(); out = Path(a.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    ns = load_v126(baseline)
    with contextlib.redirect_stdout(sys.stderr):
        px = ns["fetch_futures_open"]()
    fut_hash = ns["data_hash"](px)
    gate = {"rows": int(len(px)), "sha256": fut_hash, "expectedRows": EXPECTED_FUTURES_ROWS,
            "expectedSha256": EXPECTED_FUTURES_SHA, "passed": len(px) == EXPECTED_FUTURES_ROWS and fut_hash == EXPECTED_FUTURES_SHA}
    (out / "futures-integrity.json").write_text(json.dumps(gate, indent=2), encoding="utf-8")
    if not gate["passed"]:
        raise RuntimeError("FUTURES_DATA_INTEGRITY_GATE_FAILED")
    with contextlib.redirect_stdout(sys.stderr):
        events, missing = ns["fetch_margin_events"]()
    # Frozen v1.26 run 35057843114 reported exactly 57 parsed states and two
    # missing source CSVs. Preserve that calibrated behavior; do not reinterpret
    # either announcement during this signal-only parity run.
    margin_gate = {"states": int(len(events)), "expectedStates": EXPECTED_MARGIN_STATES,
                   "missingCsvCount": int(len(missing)), "expectedMissingCsvCount": EXPECTED_MISSING_MARGIN_CSV,
                   "missingCsv": list(map(str, missing)),
                   "passed": len(events) == EXPECTED_MARGIN_STATES and len(missing) == EXPECTED_MISSING_MARGIN_CSV}
    (out / "margin-integrity.json").write_text(json.dumps(margin_gate, indent=2), encoding="utf-8")
    if not margin_gate["passed"]:
        raise RuntimeError("MARGIN_STATE_INTEGRITY_GATE_FAILED")
    sig, sig_manifest = download_signal()
    parity = js_parity(repo, sig)
    (out / "python-js-parity.json").write_text(json.dumps(parity, indent=2), encoding="utf-8")
    if parity["mismatchCount"]:
        raise RuntimeError("PYTHON_JS_PARITY_GATE_FAILED")
    diffs = differences(sig)
    (out / "signal-differences.json").write_text(json.dumps({"count": len(diffs), "rows": diffs}, indent=2), encoding="utf-8")
    old_sig = sig.rename(columns={"old_target": "target_x"})[["close", "ma10", "ma20", "ma60", "ma60_20ago", "old_bear", "target_x"]]
    exact_sig = sig.rename(columns={"exact_target": "target_x"})[["close", "ma10", "ma20", "ma60", "ma60_20ago", "exact_bear", "target_x"]]
    with contextlib.redirect_stdout(sys.stderr):
        old_result = ns["run_band"](px, old_sig, events, 0.05)
        exact_result = ns["run_band"](px, exact_sig, events, 0.05)
        old_stats = stats(ns, old_result, px, events); exact_stats = stats(ns, exact_result, px, events)
    delta = {k: exact_stats[k] - old_stats[k] for k in exact_stats}
    reference_delta = {k: old_stats[k] - REFERENCE[k] for k in old_stats}
    result = {"oldV126Reproduction": old_stats, "exactRuleParityRun": exact_stats,
              "exactMinusReproducedV126": delta, "reproducedV126MinusPublishedReference": reference_delta}
    (out / "performance.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    manifest = {"phase": "A", "workflowRunId": os.getenv("GITHUB_RUN_ID"), "commitSha": os.getenv("GITHUB_SHA"),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "futures": gate, "margin": margin_gate,
                "0050": sig_manifest, "pythonJsParity": {k: parity[k] for k in ("comparedRows", "mismatchCount")},
                "signalDifferenceCount": len(diffs), "rawMarketDataIncluded": False,
                "baseline": "v1.26 unchanged allocation/execution; exact-rule changes signal only"}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": manifest, "differences": diffs, "performance": result}, indent=2))


if __name__ == "__main__":
    main()
