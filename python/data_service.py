"""Static reference directory. This build does not fetch live market or policy rates.

Never present the entries below as current rates or verified financial data.
Official links are supplied so users can check the primary source themselves.
"""
from __future__ import annotations
from typing import Any

SNAPSHOT = {
    "status": "reference_links_only",
    "as_of": None,
    "items": [
        {
            "id": "rbi_policy_repo",
            "category": "rbi_policy",
            "title": "RBI policy repo rate",
            "value": "Check official source — no live feed",
            "numeric": None,
            "unit": "percent",
            "source": "Reserve Bank of India",
            "source_url": "https://www.rbi.org.in/",
            "effective_from": None,
            "verified_on": None,
            "update_cadence": "After policy announcements",
            "notes": "Hisaab does not publish a current value without a verified data feed. Confirm the latest policy decision on RBI's official site.",
        },
        {
            "id": "cpi_inflation_india",
            "category": "inflation",
            "title": "India CPI inflation",
            "value": "Check official source — no live feed",
            "numeric": None,
            "unit": "percent",
            "source": "MoSPI / Reserve Bank of India",
            "source_url": "https://www.mospi.gov.in/",
            "effective_from": None,
            "verified_on": None,
            "update_cadence": "Monthly when published",
            "notes": "No latest CPI observation is asserted by this application. Check the official release and reference month.",
        },
        {
            "id": "tax_year_active",
            "category": "income_tax",
            "title": "Income tax rule-pack reference",
            "value": "Tax Year 2026–27 — illustrative only",
            "numeric": None,
            "unit": "tax_year",
            "source": "Income Tax Department",
            "source_url": "https://www.incometax.gov.in/",
            "effective_from": "2026-04-01",
            "verified_on": None,
            "update_cadence": "On official notification",
            "notes": "The in-app calculator is a simplified illustration, not a tax-return calculation. Check the official Income Tax Calculator for your taxpayer category, age and residential status.",
        },
        {
            "id": "gst_standard_goods",
            "category": "gst",
            "title": "GST rates",
            "value": "Check official rate schedule",
            "numeric": None,
            "unit": "percent",
            "source": "CBIC",
            "source_url": "https://cbic-gst.gov.in/",
            "effective_from": None,
            "verified_on": None,
            "update_cadence": "On official notification",
            "notes": "GST rates vary by goods and services classification. No generic current rate is asserted here.",
        },
        {
            "id": "nsc_rate",
            "category": "savings_schemes",
            "title": "National Savings Certificate rate",
            "value": "Check current quarter notification",
            "numeric": None,
            "unit": "percent",
            "source": "India Post / Ministry of Finance",
            "source_url": "https://www.indiapost.gov.in/",
            "effective_from": None,
            "verified_on": None,
            "update_cadence": "When rates are revised",
            "notes": "Small-savings rates can change by quarter. Confirm the applicable issue date and official notification.",
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
            "verified_on": None,
        },
        {
            "id": "inflation_erodes",
            "title_en": "Why inflation matters for goals",
            "title_te": "లక్ష్యాలకు ద్రవ్యోల్బణం ఎందుకు ముఖ్యం",
            "body_en": "Goal costs in Hisaab grow with category-specific inflation (education, medical, home, general). A ₹10 lakh goal today can require substantially more in future rupees.",
            "body_te": "Hisaabలో లక్ష్య ఖర్చులు వర్గాల వారీ ద్రవ్యోల్బణంతో పెరుగుతాయి (విద్య, వైద్యం, ఇల్లు, సాధారణ). నేటి ₹10 లక్షల లక్ష్యానికి భవిష్యత్తులో ఎక్కువ మొత్తం కావచ్చు.",
            "source": "Hisaab education",
            "verified_on": None,
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
