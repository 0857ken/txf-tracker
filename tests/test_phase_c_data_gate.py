import importlib.util
from pathlib import Path
import unittest

import pandas as pd


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "phase-c-v127-backtest.py"
SPEC = importlib.util.spec_from_file_location("phase_c_v127", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PhaseCDataGateTest(unittest.TestCase):
    def test_signal_schedule_is_canonical_and_excludes_raw_price(self):
        frame = pd.DataFrame({"exact_bear": [False, True], "exact_target": [2.0, .5],
                              "close": [99.123456, 88.654321]},
                             index=pd.to_datetime(["2026-09-14", "2026-09-15"]))
        rows, raw, digest = MODULE.signal_schedule(frame)
        self.assertEqual(raw, b"date,exact_bear,target_x\n2026-09-14,false,2.0\n2026-09-15,true,0.5\n")
        self.assertNotIn(b"99.123456", raw)
        self.assertEqual(len(digest), 64)
        self.assertEqual(rows[1], {"date": "2026-09-15", "exact_bear": True, "target_x": .5})

    def test_v126_reproduction_gate_has_metric_specific_strict_tolerances(self):
        exact = dict(MODULE.V126_REFERENCE)
        self.assertTrue(MODULE.baseline_reproduction(exact)["passed"])
        exact["cagr"] += MODULE.V126_TOLERANCE["cagr"] * 2
        result = MODULE.baseline_reproduction(exact)
        self.assertFalse(result["passed"])
        self.assertGreater(result["delta"]["cagr"], result["tolerance"]["cagr"])


if __name__ == "__main__":
    unittest.main()
