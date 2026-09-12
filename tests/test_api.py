from __future__ import annotations

import json
import threading
import unittest
import urllib.request

import server


class AnalysisTests(unittest.TestCase):
    def test_semantic_mapping_handles_nonstandard_headers(self):
        suggestions = server.suggest_field_mapping(["幼兒園全稱", "所在區域", "核准招生容量"])
        self.assertEqual(suggestions[0]["target"], "name")
        self.assertEqual(suggestions[1]["target"], "district")
        self.assertEqual(suggestions[2]["target"], "capacity")
        self.assertTrue(all("confidence" in item and "reason" in item for item in suggestions))

    def test_ocr_returns_clause_and_risk_impact(self):
        result = server.analyze_ocr_text("評鑑待改善：生師比與核定人數需確認，並限期改善。", "scan.pdf")
        self.assertTrue(result["demo"])
        self.assertTrue(any("第30條" in item["clause"] for item in result["findings"]))
        self.assertTrue(any(item["riskImpact"] > 0 for item in result["findings"]))

    def test_sentiment_deduplicates_and_labels_clues(self):
        events = [
            {"title": "疑似不當管教爭議", "date": "2026-09-12", "source": "news", "url": "https://example.com/a"},
            {"title": "疑似不當管教爭議", "date": "2026-09-12", "source": "news", "url": "https://example.com/b"},
        ]
        result = server.deduplicate_sentiment(events)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["label"], "未經查證之公開線索")
        self.assertGreaterEqual(result[0]["negativeScore"], 28)

    def test_sensitive_data_is_masked(self):
        masked = server.mask_sensitive("王小明 A123456789 0912345678 user@example.com")
        self.assertNotIn("A123456789", masked)
        self.assertNotIn("0912345678", masked)
        self.assertNotIn("user@example.com", masked)

    def test_unsafe_urls_are_removed(self):
        self.assertEqual(server.safe_public_url("javascript:alert(1)"), "")
        self.assertEqual(server.safe_public_url("https://example.com/a?token=secret"), "https://example.com/a")


class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingServer(("127.0.0.1", 0), server.RadarAPIHandler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def test_health_has_security_headers(self):
        with urllib.request.urlopen(self.base + "/api/health", timeout=2) as response:
            body = json.load(response)
            self.assertEqual(body["status"], "ok")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")

    def test_field_map_endpoint(self):
        request = urllib.request.Request(
            self.base + "/api/ai/field-map",
            data=json.dumps({"headers": ["機構名稱", "鄉鎮市區"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            body = json.load(response)
            self.assertTrue(body["demo"])
            self.assertEqual(body["suggestions"][0]["target"], "name")


if __name__ == "__main__":
    unittest.main()
