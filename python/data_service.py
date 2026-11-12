"""Hisaab Financial Data Service — curated official reference information.

Values are versioned snapshots with source, effective date and verified date.
In production, a scheduled job should refresh these from official publications
and require human validation before activation.
"""
from __future__ import annotations
from typing import Any

SNAPSHOT = {
    "as_of": "2026-11-12",
    "items": [
        {
            "id": "rbi_policy_repo",
            "category": "rbi_policy",
            "title": "RBI policy repo rate",
            "value": "6.50%",
            "numeric": 6.5,
            "unit": "percent",
            "source": "Reserve Bank of India",
            "source_url": "https://www.rbi.org.in/",
            "effective_from": "2025-02-07",
            "verified_on": "2026-11-12",
            "update_cadence": "After policy announcements",
            "notes": "Illustrative snapshot for UI; always confirm on rbi.org.in before decisions.",
        },
        {
            "id": "cpi_inflation_india",
            "category": "inflation",
            "title": "India CPI inflation (latest published reference)",
            "value": "4.5%",
            "numeric": 4.5,
            "unit": "percent",
            "source": "RBI / MoSPI publications",
            "source_url": "https://www.rbi.org.in/",
            "effective_from": "2026-09-01",
            "verified_on": "2026-11-12",
            "update_cadence": "Monthly when published",
            "notes": "Used only as educational context for inflation assumptions in the twin.",
        },
        {
            "id": "tax_year_active",
            "category": "income_tax",
            "title": "Active tax year in Hisaab Tax Intelligence",
            "value": "2026-27",
            "numeric": None,
            "unit": "tax_year",
            "source": "Income Tax Department",
            "source_url": "https://www.incometax.gov.in/",
            "effective_from": "2026-04-01",
            "verified_on": "2026-11-12",
            "update_cadence": "On official notification",
            "notes": "Hisaab distinguishes Tax Year 2026–27 rules from prior assessment years.",
        },
        {
            "id": "gst_standard_goods",
            "category": "gst",
            "title": "Standard GST rate reference (goods)",
            "value": "18%",
            "numeric": 18.0,
            "unit": "percent",
            "source": "CBIC",
            "source_url": "https://cbic-gst.gov.in/",
            "effective_from": "2017-07-01",
            "verified_on": "2026-11-12",
            "update_cadence": "On official notification",
            "notes": "Category-specific rates differ; consult official rate schedules.",
        },
        {
            "id": "nsc_rate",
            "category": "savings_schemes",
            "title": "National Savings Certificate (illustrative)",
            "value": "7.7%",
            "numeric": 7.7,
            "unit": "percent",
            "source": "India Post / MoF savings scheme notifications",
            "source_url": "https://www.indiapost.gov.in/",
            "effective_from": "2025-01-01",
            "verified_on": "2026-11-12",
            "update_cadence": "When rates are revised",
            "notes": "Rates change by quarter/notification; verify before investing.",
        },
    ],
    "education_articles": [
        {
            "id": "sip_basics",
            "title_en": "What is an SIP?",
            "title_te": "SIP అంటే ఏమిటి?",
            "body_en": "A Systematic Investment Plan invests a fixed amount at regular intervals. Hisaab models monthly SIPs capped by your surplus after expenses.",
            "body_te": "సిస్టమాటిక్ ఇన్వెస్ట్‌మెంట్ ప్లాన్ (SIP) ద్వారా మీరు నెలవారీ నిర్ణీత మొత్తాన్ని పెట్టుబడి పెడతారు. Hisaab మీ ఖర్చుల తర్వాత మిగిలిన మొత్తానికి SIPని పరిమితం చేస్తుంది.",
            "source": "Hisaab education",
            "verified_on": "2026-11-12",
        },
        {
            "id": "inflation_erodes",
            "title_en": "Why inflation matters for goals",
            "title_te": "లక్ష్యాలకు ద్రవ్యోల్బణం ఎందుకు ముఖ్యం",
            "body_en": "Goal costs in Hisaab grow with category-specific inflation (education, medical, home, general). A ₹10 lakh goal today can require substantially more in future rupees.",
            "body_te": "Hisaabలో లక్ష్య ఖర్చులు వర్గాల వారీ ద్రవ్యోల్బణంతో పెరుగుతాయి (విద్య, వైద్యం, ఇల్లు, సాధారణ). నేటి ₹10 లక్షల లక్ష్యానికి భవిష్యత్తులో ఎక్కువ మొత్తం కావచ్చు.",
            "source": "Hisaab education",
            "verified_on": "2026-11-12",
        },
    ],
}


def snapshot() -> dict[str, Any]:
    return SNAPSHOT


def get_item(item_id: str) -> dict[str, Any] | None:
    for item in SNAPSHOT["items"]:
        if item["id"] == item_id:
            return item
    return None
