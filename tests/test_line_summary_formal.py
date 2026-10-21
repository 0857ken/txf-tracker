#!/usr/bin/env python3
"""離線驗證 LINE 期貨正式主帳與條件式策略區塊，不呼叫 Firebase／LINE。"""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "line_summary.py"

# Firebase Admin / snapshot 模組只供 import，所有遠端操作由 mock 攔截。
fb = types.ModuleType("firebase_admin")
fb._apps = {}
fb.credentials = types.ModuleType("firebase_admin.credentials")
fb.firestore = types.ModuleType("firebase_admin.firestore")
sys.modules["firebase_admin"] = fb
sys.modules["firebase_admin.credentials"] = fb.credentials
sys.modules["firebase_admin.firestore"] = fb.firestore

snapshot = types.ModuleType("snapshot_assets")
snapshot.load_futures_master = lambda *args, **kwargs: None
snapshot.read_collection = lambda *args, **kwargs: []
snapshot.load_json_optional = lambda *args, **kwargs: None
sys.modules["snapshot_assets"] = snapshot

spec = importlib.util.spec_from_file_location("line_summary", SCRIPT)
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


def market():
    return {
        "market": {
            "current_price": 46888,
            "change": 100,
            "change_pct": 0.21,
        },
        "ma_state": {
            "state": "觀察", "mode": "保守",
            "ma5": 46000, "ma20": 45500, "ma60": 45000,
            "leverage": "0.8–1.0",
        },
        "trend": {"dates": ["2026-10-20", "2026-10-21"]},
    }


def position(product="TMF", lots=1, entry=48666, price=47284):
    return {
        "product": product, "month": "2026-10",
        "lots": lots, "entry_price": entry,
        "current_price": price, "price_date": "2026-10-21",
    }


def master(rows):
    return {
        "positions": rows,
        "market_date": "2026-10-21",
        "expected_price_date": "2026-10-21",
    }


class LineFormalPositionTests(unittest.TestCase):
    def test_tmf_uses_taifex_settlement_not_twii(self):
        message = summary.build_message(market(), master([position()]))
        self.assertIn("微台 2026-10 1口 @48,666 → 47,284", message)
        self.assertIn("期貨總未實現損益:-13,820 元", message)
        self.assertNotIn("2口 @50,068", message)
        self.assertIn("加權指數:46,888", message)

    def test_all_three_contract_multipliers(self):
        rows = [
            position(product="TX", entry=47000, price=47001),
            position(product="MTX", entry=47000, price=47001),
            position(product="TMF", entry=47000, price=47001),
        ]
        self.assertIn("期貨總未實現損益:+260 元", summary.build_message(market(), master(rows)))

    def test_short_position_sign_reverses(self):
        self.assertIn("期貨總未實現損益:-20 元", summary.build_message(
            market(), master([position(lots=-2, entry=47000, price=47001)])
        ))

    def test_master_missing_not_mislabelled_empty(self):
        message = summary.build_message(market(), None)
        self.assertIn("待核對", message)
        self.assertNotIn("目前無期貨部位", message)
        self.assertNotIn("期貨總未實現損益", message)

    def test_confirmed_empty_master(self):
        message = summary.build_message(market(), master([]))
        self.assertIn("正式主帳目前無期貨部位", message)
        self.assertNotIn("待核對", message)

    def test_invalid_product_and_date_rejected(self):
        with self.assertRaises(ValueError):
            summary.build_message(market(), master([position(product="UNKNOWN")]))
        with self.assertRaises(ValueError):
            summary.build_message(market(), master([{
                **position(), "price_date": "2026-10-20",
            }]))

    def test_fubon_and_benchmark_must_be_same_date(self):
        bad = {"schema_version": 1, "quote": {
            "symbol": "0050", "isClose": True, "date": "2026-10-20"
        }}
        with mock.patch.object(summary, "load_json", return_value=bad), mock.patch.object(
            summary, "get_db"
        ) as get_db:
            with self.assertRaisesRegex(ValueError, "未對齊"):
                summary.load_positions(market())
            get_db.assert_not_called()

    def test_formal_master_receives_contract_cache_and_legacy_only_for_cost(self):
        fubon = {"schema_version": 1, "quote": {
            "symbol": "0050", "isClose": True, "date": "2026-10-21"
        }}
        expected = master([position()])
        cache = {"date": "2026-10-21", "rows": []}
        with mock.patch.object(summary, "load_json", return_value=fubon), mock.patch.object(
            summary, "get_db", return_value="fake_database"
        ), mock.patch.object(
            summary, "read_collection", return_value=[{"type":"TMF","lots":99}]
        ), mock.patch.object(
            summary, "load_json_optional", return_value=cache
        ), mock.patch.object(
            summary, "load_futures_master", return_value=expected
        ) as load_master:
            self.assertEqual(summary.load_positions(market()), expected)
            load_master.assert_called_once_with(
                "fake_database", [{"type":"TMF","lots":99}],
                futures_cache=cache, expected_date="2026-10-21",
            )

    def test_no_fixed_strategy_block_and_conditional_signal(self):
        sent = []
        fake_strategy = types.SimpleNamespace(
            compute_signals=lambda s: {"signals": [], "price": 108.1, "rs": 0.1}
        )
        with mock.patch.object(summary, "load_market", return_value=market()), mock.patch.object(
            summary, "load_positions", return_value=master([position()])
        ), mock.patch.object(
            summary, "load_json", return_value={}
        ), mock.patch.object(
            summary, "strategy_calc", fake_strategy
        ), mock.patch.object(
            summary, "push_line", side_effect=sent.append
        ):
            summary.main()
        self.assertEqual(len(sent), 1)
        self.assertNotIn("🛡️ 0050 變速防守", sent[0])
        self.assertNotIn("📈 0050 其他策略訊號", sent[0])
        fake_strategy.compute_signals = lambda s: {
            "signals": ["🟢 TEST SIGNAL"], "price": 108.1, "rs": 0.1,
        }
        sent.clear()
        with mock.patch.object(summary, "load_market", return_value=market()), mock.patch.object(
            summary, "load_positions", return_value=master([position()])
        ), mock.patch.object(
            summary, "load_json", return_value={}
        ), mock.patch.object(
            summary, "strategy_calc", fake_strategy
        ), mock.patch.object(
            summary, "push_line", side_effect=sent.append
        ):
            summary.main()
        self.assertIn("📈 0050 其他策略訊號", sent[0])
        self.assertIn("🟢 TEST SIGNAL", sent[0])

    def test_source_failure_never_sends_false_positions(self):
        sent=[]
        with mock.patch.object(summary, "load_market", return_value=market()), mock.patch.object(
            summary, "load_positions", side_effect=ValueError("date mismatch")
        ), mock.patch.object(
            summary, "strategy_calc", None
        ), mock.patch.object(
            summary, "push_line", side_effect=sent.append
        ):
            summary.main()
        self.assertEqual(len(sent), 1)
        self.assertIn("待核對", sent[0])
        self.assertNotIn("期貨總未實現損益", sent[0])


if __name__ == "__main__":
    unittest.main()
