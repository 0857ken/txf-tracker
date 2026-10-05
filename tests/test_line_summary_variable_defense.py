import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("line_summary", ROOT / "scripts" / "line_summary.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class VariableDefenseLineSummaryTest(unittest.TestCase):
    def test_current_production_data_is_nonbear_2x(self):
        strategy = M.load_json(ROOT / "data" / "strategy_data.json")
        fubon = M.load_json(ROOT / "data" / "fubon_market_data.json")
        r = M.compute_variable_defense(strategy, fubon)
        self.assertTrue(r["ready"])
        self.assertEqual(r["date"], fubon["quote"]["date"])
        self.assertAlmostEqual(r["close"], fubon["quote"]["closePrice"])
        self.assertFalse(r["bear"])
        self.assertEqual(r["target"], 2.0)
        text = "\n".join(M.variable_defense_lines(r))
        self.assertIn("🛡️ 0050 變速防守", text)
        self.assertIn("目標曝險:2.0x", text)
        self.assertIn("defense.html", text)

    def test_unclosed_fubon_fails_closed(self):
        strategy = M.load_json(ROOT / "data" / "strategy_data.json")
        fubon = M.load_json(ROOT / "data" / "fubon_market_data.json")
        fubon["quote"]["isClose"] = False
        r = M.compute_variable_defense(strategy, fubon)
        self.assertFalse(r["ready"])
        self.assertIn("尚未確認", r["reason"])

    def test_bear_exposure_levels_follow_frozen_rule_order(self):
        rows = [{"date": f"2026-01-{(i % 28) + 1:02d}", "close": 100 - i * 0.2} for i in range(80)]
        # Dates only need ordering for this pure summary helper, so replace with monotonic synthetic labels.
        rows = [{"date": f"{i:010d}", "close": 120 - i * 0.5} for i in range(80)]
        strategy = {"target": rows}
        fubon = {"schema_version": 1, "quote": {"symbol": "0050", "date": rows[-1]["date"], "closePrice": 80.0, "isClose": True}}
        r = M.compute_variable_defense(strategy, fubon)
        self.assertTrue(r["ready"])
        self.assertTrue(r["bear"])
        self.assertIn(r["target"], (0.5, 1.0, 1.5))


if __name__ == "__main__":
    unittest.main()


class VariableDefenseLotStatusTest(unittest.TestCase):
    def setUp(self):
        self.signal = {"ready": True, "target": 2.0}

    def test_100w_two_tmf_at_49949_targets_four_lots(self):
        account = {
            "equity": 450000,
            "outside": 550000,
            "positions": [{"product": "TMF", "lots": 2, "mark": 49949}],
        }
        r = M.defense_lot_status(self.signal, account)
        self.assertTrue(r["ready"])
        self.assertEqual(r["target_lots"], 4)
        self.assertEqual(r["current_lots"], 2)
        self.assertEqual(r["delta_lots"], 2)
        self.assertFalse(r["same"])
        lines = "\n".join(M.defense_lot_lines(r))
        self.assertIn("策略口數:微台 4口｜目前:2口", lines)
        self.assertIn("口數核對:⚠️ 少 2 口", lines)

    def test_matching_lots_reports_same(self):
        account = {
            "equity": 450000,
            "outside": 550000,
            "positions": [{"product": "TMF", "lots": 4, "mark": 49949}],
        }
        r = M.defense_lot_status(self.signal, account)
        self.assertTrue(r["same"])
        self.assertIn("✅ 與策略相同", "\n".join(M.defense_lot_lines(r)))

    def test_margin_values_do_not_change_theoretical_target_lots(self):
        a = {
            "equity": 450000,
            "outside": 550000,
            "initialMargin": 140200,
            "maintenanceMargin": 107600,
            "positions": [{"product": "TMF", "lots": 2, "mark": 49949}],
        }
        b = dict(a)
        b["initialMargin"] = 999999
        b["maintenanceMargin"] = 888888
        self.assertEqual(
            M.defense_lot_status(self.signal, a)["target_lots"],
            M.defense_lot_status(self.signal, b)["target_lots"],
        )
