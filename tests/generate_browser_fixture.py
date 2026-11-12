"""Generate a deterministic browser-vs-Python reference fixture in CI."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import engine
import tax_engine

payload = {
    "years": 3, "savings": 1_000_000, "income": 100_000, "sip": 20_000,
    "expense": 40_000, "ret": 8, "vol": 10, "income_growth": 5,
    "medical_shock": 250_000, "shocks": True, "seed": 7, "trials": 100,
    "goals": [
        {"name": "Education", "at": 2, "cost": 500_000, "kind": "education", "flex": False},
        {"name": "Home", "at": 3, "cost": 300_000, "kind": "home", "flex": True},
    ],
    "events": [
        {"label": "New job", "year": 2, "kind": "income_change", "amount": 15_000},
        {"label": "Higher rent", "year": 3, "kind": "expense_change", "amount": 5_000},
    ],
}
base = engine.simulate(payload, trials=100, glide_path=True)
complete = engine.nudge(payload, base)
base["nudge"] = complete
base.pop("_trial_success", None)
tax_cases = [
    {"income": 0, "regime": "new", "via": 0},
    {"income": 1_200_000, "regime": "new", "via": 0},
    {"income": 1_200_001, "regime": "new", "via": 0},
    {"income": 1_250_000, "regime": "new", "via": 0},
    {"income": 2_400_000, "regime": "new", "via": 0},
    {"income": 1_500_000, "regime": "old", "via": 150_000},
]
tax_expected = [tax_engine.compute_tax(x["income"], regime=x["regime"], chapter_via_deductions=x["via"]) for x in tax_cases]
comparison = tax_engine.compare_regimes(1_500_000, 150_000)
out = {"input": payload, "options": {"glide_path": True}, "expected": base,
       "tax_cases": tax_cases, "tax_expected": tax_expected, "regime_comparison": comparison}
target = Path(__file__).resolve().parents[1] / "web" / "tests" / "python-fixture.json"
target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Wrote Python parity fixture: {target}")
