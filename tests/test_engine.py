import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import engine

BASE = {
    "years": 5, "savings": 1_000_000, "income": 100_000, "sip": 20_000,
    "expense": 40_000, "ret": 8, "vol": 10, "income_growth": 5,
    "medical_shock": 100_000, "shocks": False, "seed": 42, "trials": 300,
    "goals": [{"name": "Education", "at": 4, "cost": 500_000, "kind": "general", "flex": False}],
}

class EngineTests(unittest.TestCase):
    def test_reproducible_seed(self):
        self.assertEqual(engine.simulate(BASE), engine.simulate(BASE))

    def test_different_seed_changes_distribution(self):
        a = engine.simulate(BASE)
        b = engine.simulate({**BASE, "seed": 43})
        self.assertNotEqual(a["fan"], b["fan"])

    def test_expense_shortfall_reduces_corpus(self):
        low = engine.simulate(BASE)
        high = engine.simulate({**BASE, "income": 10_000, "expense": 100_000})
        self.assertLess(high["ending"]["p50"], low["ending"]["p50"])

    def test_sip_is_capped_by_surplus(self):
        surplus_sip = engine.simulate({**BASE, "sip": 100_000})
        huge_sip = engine.simulate({**BASE, "sip": 1_000_000})
        # Both are capped by the same monthly surplus (income minus expenses).
        self.assertEqual(surplus_sip["fan"], huge_sip["fan"])

    def test_shock_path_runs_and_is_reproducible(self):
        stressed = {**BASE, "years": 12, "shocks": True, "medical_shock": 250_000, "seed": 7}
        first = engine.simulate(stressed, trials=500)
        second = engine.simulate(stressed, trials=500)
        self.assertEqual(first, second)
        self.assertTrue(0 <= first["depletion_odds"] <= 1)

    def test_goal_success_probability_is_bounded(self):
        result = engine.simulate(BASE)
        self.assertTrue(0 <= result["score"] <= 1)
        self.assertTrue(0 <= result["goals"][0]["odds"] <= 1)
        self.assertEqual(len(result["fan"]), BASE["years"] + 1)

    def test_validation_rejects_invalid_goal_year(self):
        bad = copy.deepcopy(BASE); bad["goals"][0]["at"] = 8
        with self.assertRaises(engine.InputError): engine.validate(bad)

    def test_validation_rejects_fractional_years(self):
        bad = {**BASE, "years": 2.5}
        with self.assertRaises(engine.InputError): engine.validate(bad)

    def test_validation_rejects_non_finite_values(self):
        bad = {**BASE, "ret": float("nan")}
        with self.assertRaises(engine.InputError): engine.validate(bad)

    def test_life_event_validation(self):
        event_case = {**BASE, "events": [{"label": "New job", "year": 2, "kind": "income_change", "amount": 20000}]}
        result = engine.simulate(event_case, trials=300)
        self.assertEqual(result["assumptions"]["life_events"], event_case["events"])
        bad = {**BASE, "events": [{"year": 9, "kind": "income_change", "amount": 20000}]}
        with self.assertRaises(engine.InputError):
            engine.validate(bad)

    def test_goal_cost_inflation_categories_differ(self):
        # At a fixed seed and horizon, medical inflation should produce a higher goal cost path.
        education = engine.simulate(BASE)
        medical_goal = copy.deepcopy(BASE); medical_goal["goals"][0]["kind"] = "medical"
        medical = engine.simulate(medical_goal)
        self.assertLessEqual(medical["goals"][0]["odds"], education["goals"][0]["odds"])


    def test_three_way_comparison_shape(self):
        base = engine.simulate(BASE, trials=300)
        payload = engine.nudge(BASE, base)
        self.assertIn("scenarios", payload)
        self.assertEqual(len(payload["scenarios"]), 4)
        labels = [s["label"] for s in payload["scenarios"]]
        self.assertEqual(labels[0], "Baseline")
        for s in payload["scenarios"]:
            self.assertTrue(0 <= s["score"] <= 1)
            self.assertIn("ending_median", s)
            self.assertIn("depletion_odds", s)

    def test_sample_paths_and_diagnostics_are_returned(self):
        result = engine.simulate(BASE, trials=300)
        self.assertEqual(len(result["sample_paths"]), 25)
        self.assertIn("label", result["sample_paths"][0])
        self.assertIn("weakest_goal", result["diagnostics"])
        self.assertIn("failed_lives_with_shock_share", result["diagnostics"])
        self.assertIn("debt_bucket_volatility", result["assumptions"])
        self.assertEqual(len(result["_trial_success"]), 300)

    def test_glide_path_is_reported_and_reproducible(self):
        raw = {**BASE, "years": 5, "goals": [{"name": "Education", "at": 4, "cost": 500000, "kind": "education", "flex": False}]}
        a = engine.simulate(raw, trials=300, glide_path=True)
        b = engine.simulate(raw, trials=300, glide_path=True)
        self.assertEqual(a, b)
        self.assertTrue(a["assumptions"]["glide_path_enabled"])

    def test_target_sip_is_bounded(self):
        result = engine.target_sip(BASE, engine.simulate(BASE, trials=300))
        self.assertGreaterEqual(result["additional_monthly_sip"], 0)
        self.assertEqual(result["trials"], BASE["trials"])
        self.assertIn("achieved_score", result)



    def test_paired_shock_counterfactuals_use_same_trial_paths(self):
        raw = {**BASE, "shocks": True, "years": 8, "medical_shock": 250000}
        base = engine.simulate(raw, trials=300)
        result = engine.nudge(raw, base)
        self.assertIn("unemployment", result["shock_counterfactuals"])
        self.assertIn("medical", result["shock_counterfactuals"])
        for item in result["shock_counterfactuals"].values():
            self.assertEqual(item["paired_trials"], 300)
            self.assertGreaterEqual(item["failures_prevented_if_removed"], 0)

    def test_ingestion_rejects_path_traversal(self):
        import ingestion
        with self.assertRaises(ValueError):
            ingestion.approve_candidate("../outside.json")

    def test_tax_engine_rejects_income_above_no_surcharge_scope(self):
        import tax_engine
        with self.assertRaises(ValueError):
            tax_engine.compute_tax(5_000_001, regime="new")
        with self.assertRaises(ValueError):
            tax_engine.compare_regimes(5_000_001)

    def test_new_regime_marginal_relief_is_applied_before_cess(self):
        import tax_engine
        taxable = 1_200_001
        result = tax_engine.compute_tax(taxable, regime="new")
        self.assertLessEqual(result["total_tax"], (taxable - 1_200_000) * 1.04 + 0.01)

if __name__ == "__main__":
    unittest.main()
