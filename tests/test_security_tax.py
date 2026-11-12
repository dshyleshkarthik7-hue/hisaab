import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import ingestion
import tax_engine
import llm_provider
import data_service


class SecurityAndTaxTests(unittest.TestCase):
    def test_ingestion_caps_external_response_size(self):
        class Response:
            status = 200
            headers = {"Content-Type": "text/html"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1): return b"x" * size
        with patch("ingestion.urllib.request.urlopen", return_value=Response()):
            result = ingestion.fetch_source("rbi")
        self.assertEqual(result["status"], "fetch_failed")
        self.assertIn("2 MB", result["error"])

    def test_ingestion_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            candidates = Path(directory) / "candidates"
            approved = Path(directory) / "approved"
            with patch.object(ingestion, "CANDIDATES", candidates), patch.object(ingestion, "APPROVED", approved):
                with self.assertRaises(ValueError):
                    ingestion.approve_candidate("../outside.json")

    def test_ingestion_rejects_candidate_symlink_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates = root / "candidates"
            approved = root / "approved"
            candidates.mkdir()
            approved.mkdir()
            outside = root / "outside.json"
            outside.write_text('{"ok": true}', encoding="utf-8")
            (candidates / "candidate.json").symlink_to(outside)
            with patch.object(ingestion, "CANDIDATES", candidates), patch.object(ingestion, "APPROVED", approved):
                with self.assertRaises(ValueError):
                    ingestion.approve_candidate("candidate.json")

    def test_ingestion_rejects_approved_destination_symlink_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates = root / "candidates"
            approved = root / "approved"
            candidates.mkdir()
            approved.mkdir()
            (candidates / "candidate.json").write_text('{"ok": true}', encoding="utf-8")
            outside = root / "outside.json"
            (approved / "candidate.json").symlink_to(outside)
            with patch.object(ingestion, "CANDIDATES", candidates), patch.object(ingestion, "APPROVED", approved):
                with self.assertRaises(ValueError):
                    ingestion.approve_candidate("candidate.json")

    def test_tax_rule_packs_are_marked_illustrative(self):
        self.assertTrue(all(pack["status"] == "illustrative" for pack in tax_engine.list_rule_packs()))

    def test_reference_data_does_not_publish_unverified_rates(self):
        snap = data_service.snapshot()
        self.assertEqual(snap["status"], "reference_links_only")
        for item in snap["items"]:
            if item["category"] != "income_tax":
                self.assertIsNone(item["numeric"])
                self.assertIsNone(item["verified_on"])

    def test_external_llm_requires_explicit_opt_in(self):
        with patch.object(llm_provider, "ENABLED", False), patch.object(llm_provider, "PROVIDER", "gemini"), patch.object(llm_provider, "API_KEY", "test-key"):
            self.assertFalse(llm_provider.available())
        with patch.object(llm_provider, "ENABLED", True), patch.object(llm_provider, "PROVIDER", "gemini"), patch.object(llm_provider, "API_KEY", "test-key"):
            self.assertTrue(llm_provider.available())

    def test_marginal_relief_is_applied_before_cess(self):
        result = tax_engine.compute_tax(1_250_000, regime="new")
        self.assertLessEqual(result["tax_before_cess"], 50_000)
        self.assertAlmostEqual(result["cess"], result["tax_before_cess"] * 0.04)
        self.assertAlmostEqual(result["total_tax"], result["tax_before_cess"] + result["cess"])


if __name__ == "__main__":
    unittest.main()
