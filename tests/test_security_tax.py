import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import ingestion
import tax_engine


class SecurityAndTaxTests(unittest.TestCase):
    def test_ingestion_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            candidates = Path(directory) / "candidates"
            approved = Path(directory) / "approved"
            with patch.object(ingestion, "CANDIDATES", candidates), patch.object(ingestion, "APPROVED", approved):
                with self.assertRaises(ValueError):
                    ingestion.approve_candidate("../outside.json")

    def test_marginal_relief_is_applied_before_cess(self):
        result = tax_engine.compute_tax(1_250_000, regime="new")
        self.assertLessEqual(result["tax_before_cess"], 50_000)
        self.assertAlmostEqual(result["cess"], result["tax_before_cess"] * 0.04)
        self.assertAlmostEqual(result["total_tax"], result["tax_before_cess"] + result["cess"])


if __name__ == "__main__":
    unittest.main()
