import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Document:
    def __init__(self, value, identity="test"):
        self.value, self.id, self.exists = value, identity, value is not None

    def to_dict(self):
        return self.value


class Store:
    def __init__(self, path=()):
        self.path = path

    def collection(self, value):
        return Store(self.path + (value,))

    def document(self, value):
        return Store(self.path + (value,))

    def stream(self):
        return iter([Document({"symbol": "1111", "market": "TW"})])

    def get(self):
        return Document({"snapshot": {"items": [{"symbol": "1111", "shares": 10}, {"symbol": "2222", "market": "TWO", "shares": 20}]}, "holdings": [{"symbol": "3333", "market": "TW", "shares": 1}]})


class QuoteTests(unittest.TestCase):
    def setUp(self):
        fake = types.ModuleType("firebase_admin")
        fake.initialize_app = lambda _cred: None
        fake.credentials = types.SimpleNamespace(Certificate=lambda value: value)
        fake.firestore = types.SimpleNamespace(client=Store)
        with patch.dict(sys.modules, {"firebase_admin": fake}):
            spec = importlib.util.spec_from_file_location("fetch_stocks_under_test", Path(__file__).parents[1] / "scripts/fetch_stocks.py")
            self.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.module)

    def test_union_is_deduplicated_and_does_not_publish_holdings(self):
        with patch.dict("os.environ", {"FIREBASE_KEY": "{}"}):
            rows = self.module.load_stock_list()
        self.assertEqual([s["symbol"] for s in rows], ["1111", "2222", "3333"])
        self.assertEqual(rows[1], {"symbol": "2222", "market": "TWO"})

    def test_market_timestamp_is_carried_through(self):
        payload = {"chart": {"result": [{"meta": {"regularMarketPrice": 100, "chartPreviousClose": 99, "regularMarketTime": 1700000000}}]}}

        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self): return json.dumps(payload).encode()

        with patch.object(self.module.urllib.request, "urlopen", return_value=Response()):
            price, previous, as_of = self.module.fetch_price("2222", "TWO")
        self.assertEqual((price, previous), (100, 99))
        self.assertEqual(as_of, "2023-11-15 06:13:20")


if __name__ == "__main__":
    unittest.main()
