"""Hisaab Tax Intelligence Engine — versioned, verified Indian tax rules.

Deterministic calculations only. AI must never invent slabs or rebates.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import math
from typing import Any

# Verified rule pack for Tax Year 2026–27 (new regime default path used by Hisaab).
# Source: Income Tax Department published rates; verify on each official notification.
RULES_TY_2026_27_NEW = {
    "tax_year": "2026-27",
    "regime": "new",
    "source": "Income Tax Department",
    "source_url": "https://www.incometax.gov.in/",
    "effective_from": "2026-04-01",
    "verified_on": "2026-11-12",
    "status": "published",
    "slabs": [
        {"upto": 400_000, "rate": 0.0},
        {"upto": 800_000, "rate": 0.05},
        {"upto": 1_200_000, "rate": 0.10},
        {"upto": 1_600_000, "rate": 0.15},
        {"upto": 2_000_000, "rate": 0.20},
        {"upto": 2_400_000, "rate": 0.25},
        {"upto": None, "rate": 0.30},
    ],
    "standard_deduction": 75_000,
    "rebate_87a_limit": 1_200_000,
    "cess": 0.04,
    "notes": [
        "Resident individual assumed eligible for Section 87A under new regime.",
        "Surcharge not applied (CTC paths capped below surcharge threshold in gateway).",
        "Professional tax is user-supplied and treated as deductible for take-home estimate.",
    ],
}

RULES_TY_2026_27_OLD = {
    "tax_year": "2026-27",
    "regime": "old",
    "source": "Income Tax Department",
    "source_url": "https://www.incometax.gov.in/",
    "effective_from": "2026-04-01",
    "verified_on": "2026-11-12",
    "status": "published",
    "slabs": [
        {"upto": 250_000, "rate": 0.0},
        {"upto": 500_000, "rate": 0.05},
        {"upto": 1_000_000, "rate": 0.20},
        {"upto": None, "rate": 0.30},
    ],
    "standard_deduction": 50_000,
    "rebate_87a_limit": 500_000,
    "cess": 0.04,
    "notes": [
        "Old regime illustrative path. Resident individual eligibility for Section 87A is assumed; Chapter VI-A deductions are user-supplied aggregate.",
        "Exact eligibility depends on individual facts; this is not a filing computation.",
    ],
}

ACTIVE_RULES = {
    ("2026-27", "new"): RULES_TY_2026_27_NEW,
    ("2026-27", "old"): RULES_TY_2026_27_OLD,
}


def list_rule_packs() -> list[dict[str, Any]]:
    return [
        {
            "tax_year": r["tax_year"],
            "regime": r["regime"],
            "source": r["source"],
            "effective_from": r["effective_from"],
            "verified_on": r["verified_on"],
            "status": r["status"],
        }
        for r in ACTIVE_RULES.values()
    ]


def get_rules(tax_year: str = "2026-27", regime: str = "new") -> dict[str, Any]:
    key = (tax_year, regime)
    if key not in ACTIVE_RULES:
        raise ValueError(f"No verified tax rules for {tax_year} / {regime}")
    return ACTIVE_RULES[key]


def compute_tax(
    taxable_income: float,
    *,
    tax_year: str = "2026-27",
    regime: str = "new",
    chapter_via_deductions: float = 0.0,
) -> dict[str, Any]:
    """Deterministic slab tax with 87A-style rebate and 4% cess.

    For new regime, taxable_income should already reflect standard deduction.
    For old regime, chapter_via_deductions reduces taxable income further.
    """
    if isinstance(taxable_income, bool) or not isinstance(taxable_income, (int, float)) or not math.isfinite(taxable_income) or taxable_income < 0:
        raise ValueError("taxable_income must be a non-negative finite number")
    if taxable_income > 5_000_000:
        raise ValueError("This illustrative rule pack excludes surcharge; taxable income is limited to ₹50 lakh.")
    if isinstance(chapter_via_deductions, bool) or not isinstance(chapter_via_deductions, (int, float)) or not math.isfinite(chapter_via_deductions) or chapter_via_deductions < 0:
        raise ValueError("chapter_via_deductions must be a non-negative finite number")
    rules = get_rules(tax_year, regime)
    base = max(0.0, taxable_income - (chapter_via_deductions if regime == "old" else 0.0))

    tax = 0.0
    lower = 0.0
    breakdown = []
    for slab in rules["slabs"]:
        upper = slab["upto"]
        rate = slab["rate"]
        if base <= lower:
            break
        band_top = base if upper is None else min(base, upper)
        band = max(0.0, band_top - lower)
        amount = band * rate
        tax += amount
        breakdown.append({
            "from": lower,
            "to": upper,
            "rate": rate,
            "taxable_in_slab": round(band, 2),
            "tax": round(amount, 2),
        })
        if upper is None:
            break
        lower = upper

    # Section 87A style full rebate when within limit (simplified new-regime path)
    rebate_limit = rules["rebate_87a_limit"]
    rebate = 0.0
    if base <= rebate_limit:
        rebate = tax
        tax = 0.0

    # Apply Section 87A marginal relief before adding health and education cess.
    if regime == "new" and base > rebate_limit:
        # Marginal relief is an additional Section 87A rebate before cess.
        pre_relief_tax = tax
        tax = min(tax, base - rebate_limit)
        rebate += pre_relief_tax - tax
    cess = tax * rules["cess"]
    total = tax + cess

    return {
        "tax_year": rules["tax_year"],
        "regime": rules["regime"],
        "taxable_income": round(base, 2),
        "tax_before_cess": round(tax, 2),
        "rebate_87a": round(rebate, 2),
        "cess": round(cess, 2),
        "total_tax": round(total, 2),
        "slab_breakdown": breakdown,
        "rules": {
            "source": rules["source"],
            "source_url": rules["source_url"],
            "effective_from": rules["effective_from"],
            "verified_on": rules["verified_on"],
            "standard_deduction": rules["standard_deduction"],
            "rebate_87a_limit": rules["rebate_87a_limit"],
            "cess": rules["cess"],
            "notes": rules["notes"],
        },
    }


def compare_regimes(gross_taxable_before_sd: float, chapter_via: float = 0.0) -> dict[str, Any]:
    """Compare new vs old regime for the same starting income."""
    if isinstance(gross_taxable_before_sd, bool) or not isinstance(gross_taxable_before_sd, (int, float)) or not math.isfinite(gross_taxable_before_sd) or gross_taxable_before_sd < 0 or gross_taxable_before_sd > 5_000_000:
        raise ValueError("This illustrative comparison excludes surcharge and is limited to income up to ₹50 lakh.")
    new_rules = get_rules("2026-27", "new")
    old_rules = get_rules("2026-27", "old")
    new_taxable = max(0.0, gross_taxable_before_sd - new_rules["standard_deduction"])
    old_taxable = max(0.0, gross_taxable_before_sd - old_rules["standard_deduction"])
    new_r = compute_tax(new_taxable, regime="new")
    old_r = compute_tax(old_taxable, regime="old", chapter_via_deductions=chapter_via)
    better = "new" if new_r["total_tax"] <= old_r["total_tax"] else "old"
    return {
        "new": new_r,
        "old": old_r,
        "recommended_regime": better,
        "savings_if_recommended": round(abs(new_r["total_tax"] - old_r["total_tax"]), 2),
    }
