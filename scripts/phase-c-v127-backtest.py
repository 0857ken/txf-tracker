#!/usr/bin/env python3
"""Preregistered Phase C comparison: Exact-rule v1.26 versus v1.27 safe allocator."""
from __future__ import annotations

import argparse
import contextlib
from collections import Counter
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd

FUTURES_ROWS = 30065
FUTURES_SHA = "8cdf38ebed9eae1e6bd96ccc79484e1e36beee83ce4ef378c92c5246a00f911b"
SIGNAL_SHA = "1398efdf099d4a5884eb631fc5fb205a148ccf11380b75aa07408c1419523fdf"
MARGIN_STATES = 57
MISSING_MARGIN_CSV = 2
BAND = .05
FLOOR = 5.0
RESET = 5.5
SLIP = 1.0
PRODUCTS = ("TX", "MTX", "TMF")


def load_phase_a(repo: Path):
    path = repo / "scripts/phase-a-exact-parity.py"
    spec = importlib.util.spec_from_file_location("phase_a", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def fetch_futures_reliably(ns, cache: Path):
    """Same v1.26 source/parser, but empty 28-day responses are retried instead of silently omitted."""
    source = ns["fetch_futures_open"].__globals__
    cache.mkdir(parents=True, exist_ok=True)
    jobs = []
    for product, start in (("TX", source["DL_START"]), ("MTX", source["DL_START"]),
                           ("TMF", pd.Timestamp("2024-07-01"))):
        jobs.extend((product, a, b) for a, b in source["chunks"](start, ns["END"]))

    def one(job):
        product, start, end = job
        saved = cache / f"{product}-{start:%Y%m%d}-{end:%Y%m%d}.pkl"
        if saved.exists():
            frame = pd.read_pickle(saved)
            if not frame.empty: return frame
        last = None
        for attempt in range(5):
            try:
                frame = source["fetch_fut_chunk_open"](product, start, end)
                if not frame.empty:
                    frame.to_pickle(saved); return frame
                last = RuntimeError("empty TAIFEX segment")
            except Exception as exc: last = exc
            time.sleep(.5 * (2 ** attempt))
        raise RuntimeError(f"TAIFEX_SEGMENT_FAILED {job}: {last!r}")

    frames = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(one, job): job for job in jobs}
        for i, future in enumerate(as_completed(futures), 1):
            frames.append(future.result())
            if i % 50 == 0: print(f"reliable download chunks {i} / {len(jobs)}", file=sys.stderr)
    result = pd.concat(frames, ignore_index=True).sort_values(["date", "product", "expiry"])
    return result[(result.date >= ns["START"]) & (result.date <= ns["END"])].reset_index(drop=True)


def rank_better(rank, best):
    if best is None:
        return True
    for i, value in enumerate(rank):
        if all(abs(rank[j] - best[j]) < 1e-8 for j in range(i)) and value < best[i] - 1e-8:
            return True
        if abs(value - best[i]) >= 1e-8:
            return False
    return False


def allocation(target, equity, d, expiry, prices, margins, point):
    available = [p for p in PRODUCTS if (p, expiry, d) in prices]
    candidates = []
    bounds = {p: int(np.floor(equity / (RESET * margins[p][0]))) for p in available}
    for tx in range(bounds.get("TX", 0) + 1):
        for mtx in range(bounds.get("MTX", 0) + 1):
            for tmf in range(bounds.get("TMF", 0) + 1):
                counts = {"TX": tx, "MTX": mtx, "TMF": tmf}
                if any(counts[p] and p not in available for p in PRODUCTS) or not sum(counts.values()):
                    continue
                im = sum(counts[p] * margins[p][0] for p in PRODUCTS)
                mm = sum(counts[p] * margins[p][1] for p in PRODUCTS)
                if RESET * im > equity + 1e-9:
                    continue
                notional = sum(counts[p] * point[p] * prices[(p, expiry, d)] for p in PRODUCTS)
                exposure = notional / equity
                error = exposure - target
                rank = (abs(error), int(exposure > target), sum(counts.values()), -tx, -mtx)
                candidates.append((rank, counts, notional, exposure, error, im, mm))
    if not candidates:
        return {"status": "margin-limited", "holdings": {}, "safe_count": 0, "within_count": 0}
    best = None
    for candidate in candidates:
        if rank_better(candidate[0], best[0] if best else None):
            best = candidate
    rank, counts, notional, exposure, error, im, mm = best
    within = sum(abs(x[4]) <= BAND + 1e-12 for x in candidates)
    return {"status": "within-band" if within else "granularity-limited",
            "holdings": {(p, expiry): q for p, q in counts.items() if q},
            "safe_count": len(candidates), "within_count": within, "notional": notional,
            "exposure": exposure, "error": error, "initial": im, "maintenance": mm,
            "required550": RESET * im}


def run_v127(ns, px, sig, events):
    point, comm, tax = ns["POINT"], ns["COMM"], ns["TAX"]
    price = {(r.product, r.expiry, r.date): float(r.close) for r in px.itertuples()}
    rolls = ns["roll_map"](px); expiries = sorted(rolls)
    dates = sorted(set(px.loc[px.product == "TX", "date"]) &
                   set(sig.loc[(sig.index >= ns["START"]) & (sig.index <= ns["END"])].index))
    fut_cash = ns["START_CAPITAL"]; external = 0.0; holdings = {}; prev_close = {}
    last_target = 2.0; prev_date = None; prev_month = None; first = True
    total_cost = 0.0; total_sides = 0; rows = []; diff_reasons = Counter()
    for d in dates:
        interest = 0.0
        if prev_date is not None and external > 0:
            gap = max((d - prev_date).days, 0)
            interest = external * ((1 + ns["ANNUAL_YIELD"]) ** (gap / 365.25) - 1)
            external += interest
        held = dict(holdings); pnl = 0.0
        for key, qty in held.items():
            pnl += qty * point[key[0]] * (price[(key[0], key[1], d)] - prev_close[key])
        fut_cash += pnl
        target = float(sig.loc[d, "target_x"]) if d in sig.index else last_target
        signal_changed = not first and abs(target - last_target) > 1e-12
        last_target = target
        expiry = ns["active_expiry"](d, rolls, expiries)
        if expiry is None:
            continue
        equity = fut_cash + external
        state = ns["margin_state"](events, d); tx_i = float(state["initial"]); tx_m = float(state["maint"])
        scale = {"TX": 1.0, "MTX": .25, "TMF": .05}
        margins = {p: (tx_i * scale[p], tx_m * scale[p]) for p in PRODUCTS}
        selected = allocation(target, equity, d, expiry, price, margins, point)
        current_notional = 0.0; current_valid = True
        for (prod, exp0), qty in held.items():
            if (prod, exp0, d) not in price:
                current_valid = False; break
            current_notional += qty * point[prod] * price[(prod, exp0, d)]
        current_x = current_notional / equity if equity > 0 and current_valid else np.nan
        deviation = abs(current_x - target) if pd.notna(current_x) else np.inf
        current_im = sum(q * margins[p][0] for (p, _), q in held.items()) if current_valid else np.inf
        current_safe = RESET * current_im <= equity + 1e-9 and all(q >= 0 for q in held.values())
        roll_needed = bool(held and {e for (_, e), q in held.items() if q} != {expiry})
        same_best = selected["holdings"] == held
        selectable = selected["status"] in ("within-band", "granularity-limited")
        force = first or signal_changed or roll_needed or not current_valid or not current_safe
        trade = selectable and not same_best and (force or deviation > BAND + 1e-12)
        desired = selected["holdings"] if trade else held
        if selected["status"] == "granularity-limited" and same_best and deviation > BAND + 1e-12:
            action = "best-feasible-no-trade"
        elif trade:
            action = "rebalance-to-best-feasible"
        elif deviation <= BAND + 1e-12:
            action = "within-band-no-trade"
        else:
            action = selected["status"]

        cost = 0.0; sides = 0
        for key in set(held) | set(desired):
            delta = desired.get(key, 0) - held.get(key, 0)
            if not delta: continue
            prod, exp0 = key; n = abs(delta); notion = price[(prod, exp0, d)] * point[prod] * n
            cost += n * comm[prod] + notion * tax + n * SLIP * point[prod]; sides += n
        fut_cash -= cost; total_cost += cost; total_sides += sides
        holdings = desired
        prev_close = {(p, e): price[(p, e, d)] for p, e in holdings}
        im = sum(q * margins[p][0] for (p, _), q in holdings.items())
        mm = sum(q * margins[p][1] for (p, _), q in holdings.items())
        before = fut_cash + external
        first_month = prev_month is None or (d.year, d.month) != prev_month
        transfer = 0.0
        if im > 0:
            if first_month:
                transfer = min(before, RESET * im) - fut_cash
            elif fut_cash < FLOOR * im:
                transfer = min(external, RESET * im - fut_cash)
            transfer = min(transfer, external)
            if transfer < 0 and -transfer > fut_cash: transfer = -fut_cash
            fut_cash += transfer; external -= transfer
        total = fut_cash + external
        notional = sum(q * point[p] * price[(p, e, d)] for (p, e), q in holdings.items())
        realized = notional / total if total else np.nan
        rows.append({"date": d, "total_equity": total, "futures_equity": fut_cash, "external_cash": external,
          "interest": interest, "cost": cost, "sides": sides, "target_x": target, "realized_x": realized,
          "abs_track_error": abs(realized - target), "initial_margin": im, "maint_margin": mm,
          "broker_ratio": fut_cash / im if im else np.nan, "call_equiv_ratio": mm / im if im else np.nan,
          "TX": sum(q for (p, _), q in holdings.items() if p == "TX"),
          "MTX": sum(q for (p, _), q in holdings.items() if p == "MTX"),
          "TMF": sum(q for (p, _), q in holdings.items() if p == "TMF"), "expiry": expiry,
          "external_share": external / total if total else np.nan, "allocation_status": selected["status"],
          "action_state": action, "current_safe": current_safe, "required550": selected.get("required550")})
        prev_date = d; prev_month = (d.year, d.month); first = False
    result = pd.DataFrame(rows).set_index("date")
    result.attrs.update(total_cost=total_cost, total_sides=total_sides)
    return result


def core_stats(ns, result, px, events):
    metric = ns["metrics"](result); opening = ns["open_gap_audit"](result, px, events)
    err = result.abs_track_error.dropna()
    ratios = result.broker_ratio.dropna()
    use = {p: {"days": int((result[p] > 0).sum()), "proportion": float((result[p] > 0).mean())} for p in PRODUCTS}
    avg_target = {str(t): float(g.realized_x.mean()) for t, g in result.groupby("target_x")}
    return {"terminal": float(metric["terminal"]), "cagr": float(metric["cagr"]), "mdd": float(metric["mdd"]),
      "calmar": float(metric["calmar"]), "sides": int(result.attrs["total_sides"]),
      "cost": float(result.attrs["total_cost"]), "mean_exposure_error": float(err.mean()),
      "p95_exposure_error": float(err.quantile(.95)), "max_exposure_error": float(err.max()),
      "min_close_risk": float(ratios.min()), "min_next_open_risk": float(opening.open_ratio.min()),
      "below500_days": int((ratios < 5.0).sum()),
      "granularity_limited_days": int((result.allocation_status == "granularity-limited").sum()),
      "margin_limited_days": int((result.allocation_status == "margin-limited").sum()),
      "average_actual_exposure_by_target": avg_target, "product_use": use}


def holdings_differences(old, new, ns, events):
    common = old.index.intersection(new.index); rows = []; reasons = Counter()
    scale = {"TX": 1.0, "MTX": .25, "TMF": .05}
    for d in common:
        a, b = old.loc[d], new.loc[d]
        old_lots = tuple(int(a[p]) for p in PRODUCTS); new_lots = tuple(int(b[p]) for p in PRODUCTS)
        if old_lots == new_lots and str(a.expiry) == str(b.expiry): continue
        ms = ns["margin_state"](events, d); old_im = sum(old_lots[i] * float(ms["initial"]) * scale[p] for i, p in enumerate(PRODUCTS))
        if RESET * old_im > float(b.total_equity) + 1e-9: reason = "v1.26-holding-fails-550-gate"
        elif b.allocation_status == "granularity-limited": reason = "best-safe-granularity-ranking"
        else: reason = "best-safe-price-and-product-ranking"
        reasons[reason] += 1
        rows.append({"date": d.strftime("%Y-%m-%d"), "target": float(b.target_x),
          "v126": dict(zip(PRODUCTS, old_lots)), "v127": dict(zip(PRODUCTS, new_lots)), "reason": reason})
    return rows, reasons


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--baseline-root", required=True); parser.add_argument("--output", required=True)
    args = parser.parse_args(); repo = Path(__file__).resolve().parents[1]; out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    phase_a = load_phase_a(repo); ns = phase_a.load_v126(Path(args.baseline_root).resolve())
    with contextlib.redirect_stdout(sys.stderr): px = fetch_futures_reliably(ns, Path("/tmp/phase-c-v127-futures-cache"))
    futures_gate = {"rows": len(px), "sha256": ns["data_hash"](px)}
    if futures_gate != {"rows": FUTURES_ROWS, "sha256": FUTURES_SHA}: raise RuntimeError(f"FUTURES_GATE_FAILED {futures_gate}")
    with contextlib.redirect_stdout(sys.stderr): events, missing = ns["fetch_margin_events"]()
    margin_gate = {"states": len(events), "missingCsvCount": len(missing)}
    if margin_gate != {"states": MARGIN_STATES, "missingCsvCount": MISSING_MARGIN_CSV}: raise RuntimeError(f"MARGIN_GATE_FAILED {margin_gate}")
    signal, signal_manifest = phase_a.download_signal()
    if signal_manifest["adjustedCloseSha256"] != SIGNAL_SHA: raise RuntimeError(f"SIGNAL_GATE_FAILED {signal_manifest}")
    exact = signal.rename(columns={"exact_target": "target_x"})[["close", "ma10", "ma20", "ma60", "ma60_20ago", "exact_bear", "target_x"]]
    with contextlib.redirect_stdout(sys.stderr):
        old = ns["run_band"](px, exact, events, BAND); new = run_v127(ns, px, exact, events)
        old_stats = core_stats(ns, old.assign(allocation_status="v1.26"), px, events)
        new_stats = core_stats(ns, new, px, events)
    # v1.26 has no formal allocation statuses.
    old_stats["granularity_limited_days"] = None; old_stats["margin_limited_days"] = None
    differences, reasons = holdings_differences(old, new, ns, events)
    delta = {k: new_stats[k] - old_stats[k] for k in ("terminal", "cagr", "mdd", "calmar", "sides", "cost",
      "mean_exposure_error", "p95_exposure_error", "max_exposure_error", "min_close_risk", "min_next_open_risk", "below500_days")}
    report = {"protocolCommit": "c3c89f950752e56121d8620ef47166312ca67bfc",
      "generatedAt": datetime.now(timezone.utc).isoformat(), "workflowRunId": os.getenv("GITHUB_RUN_ID"),
      "commitSha": os.getenv("GITHUB_SHA"), "gates": {"futures": futures_gate, "margin": margin_gate, "signal": signal_manifest},
      "exactRuleV126": old_stats, "v127": new_stats, "v127MinusV126": delta,
      "differentHoldingsDays": len(differences), "differenceReasons": dict(reasons)}
    (out / "phase-c-v127-comparison.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "phase-c-v127-holdings-differences.json").write_text(json.dumps({"count": len(differences), "rows": differences}, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__": main()
