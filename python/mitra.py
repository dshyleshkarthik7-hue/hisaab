"""Hisaab Mitra — grounded bilingual financial education assistant.

Principle: AI explains; source-linked reference material supplies context; Hisaab engine calculates.
No invented tax slabs, rates or returns.
"""
from __future__ import annotations
import re
from typing import Any

from tax_engine import compare_regimes, compute_tax, get_rules, list_rule_packs
from data_service import snapshot
import llm_provider

TE_GREETING = "నమస్కారం! నేను Hisaab Mitra — మీ ఆర్థిక సహాయకుడిని. పన్ను, SIP, లక్ష్యాలు లేదా సిమ్యులేషన్ ఫలితాలు గురించి అడగండి."
EN_GREETING = "Hello! I am Hisaab Mitra — your financial guide. Ask about tax, SIP, goals or your simulation results."


def _lang(text: str) -> str:
    # Heuristic: Telugu Unicode block
    if re.search(r"[\u0C00-\u0C7F]", text):
        return "te"
    return "en"


def _sources_block(lang: str) -> list[dict[str, str]]:
    return [
        {"name": "Income Tax Department", "url": "https://www.incometax.gov.in/"},
        {"name": "Reserve Bank of India", "url": "https://www.rbi.org.in/"},
        {"name": "CBIC (GST)", "url": "https://cbic-gst.gov.in/"},
        {"name": "SEBI", "url": "https://www.sebi.gov.in/"},
    ]


def answer(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a grounded explanation. Never fabricates official rates."""
    q = (question or "").strip()
    if not q:
        return {
            "lang": "en",
            "reply": EN_GREETING,
            "reply_te": TE_GREETING,
            "sources": _sources_block("en"),
            "calculations": None,
        }
    lang = _lang(q)
    ql = q.lower()
    context = context or {}
    calcs: dict[str, Any] | None = None
    sources = _sources_block(lang)

    # Live sensitivity analysis uses the exact current household inputs and deterministic engine.
    if context.get("inputs") and any(k in ql for k in ("85%", "85 percent", "extra sip", "increase sip", "monthly sip needed", "fragile", "weakest goal", "bottleneck", "which shock", "job loss impact", "medical shock impact", "shock attribution")):
        try:
            from engine import simulate, target_sip
            raw = context["inputs"]
            baseline = context.get("simulation") or simulate(raw)
            target = (context.get("simulation") or {}).get("target_sip") or target_sip(raw, baseline, .85)
            diagnostics = (context.get("simulation") or {}).get("diagnostics") or {}
            weakest = diagnostics.get("weakest_goal")
            failures = diagnostics.get("goal_failure_share", [])
            bottleneck = max(failures, key=lambda x: x.get("failure_share", 0)) if failures else None
            shock_cf = (context.get("simulation") or {}).get("shock_counterfactuals") or {}
            shock_driver = max(
                ({"name": name, **values} for name, values in shock_cf.items()),
                key=lambda x: x.get("net_failure_reduction", 0),
                default=None,
            )
            if lang == "te":
                reply = (f"85% లక్ష్య సాధ్యత కోసం అదనపు నెలవారీ SIP: ₹{target['additional_monthly_sip']:,.0f}. "
                         + ("ఈ సిమ్యులేషన్ పరిధిలో లక్ష్యాన్ని చేరవచ్చు." if target["reachable"] else "పరీక్షించిన SIP పరిధిలో 85% సాధ్యం కాలేదు.")
                         + (f" బలహీనమైన లక్ష్యం: {weakest['name']} ({weakest['odds']*100:.1f}%)." if weakest else ""))
            else:
                reply = (f"Estimated additional monthly SIP to target 85% all-goals success: ₹{target['additional_monthly_sip']:,.0f}. "
                         + ("The target is reachable in the tested range." if target["reachable"] else "The 85% target was not reached within the tested SIP range.")
                         + (f" Weakest goal: {weakest['name']} ({weakest['odds']*100:.1f}% funded)." if weakest else "")
                         + (f" Goal with the highest observed miss rate: {bottleneck['name']}." if bottleneck else "")
                         + (f" Paired counterfactual: removing {shock_driver['name']} would have prevented {shock_driver['failures_prevented_if_removed']} failed lives (net reduction {shock_driver['net_failure_reduction']}) across {shock_driver['paired_trials']} identical random paths. This is model-conditional, not proof of real-world causation." if shock_driver and shock_driver["net_failure_reduction"] > 0 else " No positive net failure reduction was detected in the paired shock-removal tests."))
            calcs = {"target_sip": target, "weakest_goal": weakest, "largest_goal_failure_driver": bottleneck,
                     "paired_shock_counterfactual": shock_cf}
        except (ImportError, KeyError, TypeError, ValueError):
            reply = "Run a valid household simulation first, then ask for the SIP needed to reach 85%."

    # Tax slabs / rules
    elif any(k in ql for k in ("tax slab", "tax rule", "income tax", "పన్ను", "స్లాబ్", "87a", "regime")):
        rules = get_rules("2026-27", "new")
        if lang == "te":
            lines = [
                f"పన్ను సంవత్సరం {rules['tax_year']} (కొత్త పాలన) — మూలం: {rules['source']}.",
                f"ప్రామాణిక మినహాయింపు: ₹{rules['standard_deduction']:,}.",
                f"సెక్షన్ 87A రిబేట్ పరిధి: ₹{rules['rebate_87a_limit']:,}.",
                "స్లాబ్‌లు:",
            ]
            lower = 0
            for s in rules["slabs"]:
                up = "పైన" if s["upto"] is None else f"₹{s['upto']:,}"
                lines.append(f"  ₹{lower:,} – {up}: {int(s['rate']*100)}%")
                lower = s["upto"] or lower
            lines.append(f"ధృవీకరణ తేదీ: {rules['verified_on']}. అధికారిక నోటిఫికేషన్‌ను ఎల్లప్పుడూ సరిపోల్చండి.")
            reply = "\n".join(lines)
        else:
            lines = [
                f"Tax year {rules['tax_year']} (new regime) — source: {rules['source']}.",
                f"Standard deduction: ₹{rules['standard_deduction']:,}.",
                f"Section 87A rebate threshold: ₹{rules['rebate_87a_limit']:,}.",
                "Slabs:",
            ]
            lower = 0
            for s in rules["slabs"]:
                up = "and above" if s["upto"] is None else f"₹{s['upto']:,}"
                lines.append(f"  ₹{lower:,} – {up}: {int(s['rate']*100)}%")
                lower = s["upto"] or lower
            lines.append(f"Verified on {rules['verified_on']}. Always cross-check official notifications.")
            reply = "\n".join(lines)
        calcs = {"rules": rules, "packs": list_rule_packs()}

    # Old vs new regime
    elif any(k in ql for k in ("old regime", "new regime", "పాత పాలన", "కొత్త పాలన", "compare regime")):
        income = float(context.get("taxable_income") or context.get("income_annual") or 1_200_000)
        calcs = compare_regimes(income)
        if lang == "te":
            reply = (
                f"సంవత్సర ఆదాయం సుమారు ₹{income:,.0f} కోసం:\n"
                f"కొత్త పాలన పన్ను: ₹{calcs['new']['total_tax']:,.0f}\n"
                f"పాత పాలన పన్ను: ₹{calcs['old']['total_tax']:,.0f}\n"
                f"సిఫార్సు: {calcs['recommended_regime']} "
                f"(≈ ₹{calcs['savings_if_recommended']:,.0f} తేడా).\n"
                "ఇది Hisaab Tax Intelligence యొక్క నిర్ణయాత్మక లెక్క; AI ఊహించదు."
            )
        else:
            reply = (
                f"For ~₹{income:,.0f} annual income:\n"
                f"New regime tax: ₹{calcs['new']['total_tax']:,.0f}\n"
                f"Old regime tax: ₹{calcs['old']['total_tax']:,.0f}\n"
                f"Lower tax path: {calcs['recommended_regime']} "
                f"(difference ≈ ₹{calcs['savings_if_recommended']:,.0f}).\n"
                "Computed by Hisaab Tax Intelligence — not invented by the assistant."
            )

    # Simulation context: why goal fails
    elif context.get("simulation") and any(
        k in ql for k in ("why", "not reaching", "shortfall", "ఎందుకు", "చేరడం లేదు", "తక్కువ")
    ):
        sim = context["simulation"]
        score = float(sim.get("score") or 0)
        deplete = float(sim.get("depletion_odds") or 0)
        if lang == "te":
            reply = (
                f"మీ సిమ్యులేషన్‌లో అన్ని లక్ష్యాలు నెరవేరే అవకాశం {score*100:.1f}%.\n"
                f"నిధి ఖాళీ అయ్యే అవకాశం {deplete*100:.1f}%.\n"
                "సాధారణ కారణాలు:\n"
                "• నెలవారీ SIP, ఖర్చుల తర్వాత మిగిలిన మొత్తానికి పరిమితం\n"
                "• లక్ష్య ఖర్చులు వర్గాల వారీ ద్రవ్యోల్బణంతో పెరుగుతాయి\n"
                "• ఉద్యోగ విరామం / వైద్య ఖర్చు షాక్‌లు కార్పస్‌ను తగ్గించవచ్చు\n"
                "Scenario Labలో SIP +15% లేదా లక్ష్యాలను వాయిదా వేయడం ప్రయత్నించండి."
            )
        else:
            reply = (
                f"In your simulation, all-goals success is {score*100:.1f}%.\n"
                f"Corpus depletion odds are {deplete*100:.1f}%.\n"
                "Common drivers:\n"
                "• Monthly SIP is capped by surplus after expenses\n"
                "• Goal costs rise with category-specific inflation\n"
                "• Job-loss and medical shocks can reduce the corpus\n"
                "Try SIP +15% or delaying flexible goals in the Scenario Lab."
            )
        calcs = {"simulation_summary": {"score": score, "depletion_odds": deplete}}

    # SIP explanation
    elif any(k in ql for k in ("sip", "systematic", "పెట్టుబడి", "ఎస్ఐపి")):
        if lang == "te":
            reply = (
                "SIP అంటే నెలవారీ నిర్ణీత మొత్తాన్ని పెట్టుబడి పెట్టడం.\n"
                "Hisaabలో SIP = min(మీరు ప్లాన్ చేసిన SIP, ఆదాయం − ఖర్చులు).\n"
                "ఖర్చులు ఆదాయం కంటే ఎక్కువైతే, లోటు కార్పస్ నుండి తీసుకోబడుతుంది.\n"
                "లక్ష్య సాధ్యతను పెంచడానికి SIP పెంచడం లేదా లక్ష్యాలను వాయిదా వేయడం Scenario Labలో పరీక్షించండి."
            )
        else:
            reply = (
                "An SIP invests a fixed amount every month.\n"
                "In Hisaab, contribution = min(planned SIP, income − expenses).\n"
                "If expenses exceed income, the deficit is withdrawn from the corpus.\n"
                "To improve goal odds, test a higher SIP or delayed flexible goals in the Scenario Lab."
            )

    # Inflation / RBI snapshot
    elif any(k in ql for k in ("inflation", "rbi", "repo", "ద్రవ్యోల్బణం", "ఆర్‌బిఐ")):
        snap = snapshot()
        repo = next(i for i in snap["items"] if i["id"] == "rbi_policy_repo")
        cpi = next(i for i in snap["items"] if i["id"] == "cpi_inflation_india")
        if lang == "te":
            reply = (
                f"RBI పాలసీ రెపో రేటు: {repo['value']} "
                f"— మూలం {repo['source']}; ప్రత్యక్ష ధృవీకరణ లేదు.\n"
                f"CPI ద్రవ్యోల్బణం: {cpi['value']}.\n"
                "Hisaab సిమ్యులేషన్‌లో సాధారణ / విద్య / వైద్య / ఇల్లు వర్గాలకు వేర్వేరు ద్రవ్యోల్బణం ఉంటుంది.\n"
                "నిర్ణయాలకు ముందు rbi.org.inలో తాజా విలువలను చూడండి."
            )
        else:
            reply = (
                f"RBI policy repo: {repo['value']} "
                f"— source {repo['source']}; not live-verified.\n"
                f"CPI inflation: {cpi['value']}.\n"
                "Hisaab applies separate inflation paths for general, education, medical and home goals.\n"
                "Confirm latest figures on rbi.org.in before decisions."
            )
        calcs = {"snapshot_items": [repo, cpi]}

    # EMI
    elif any(k in ql for k in ("emi", "loan", "ఈఎంఐ", "రుణం")):
        if lang == "te":
            reply = (
                "EMI = [P × r × (1+r)^n] / [(1+r)^n − 1], "
                "ఇక్కడ r నెలవారీ వడ్డీ రేటు, n నెలల సంఖ్య.\n"
                "Hisaab కాలిక్యులేటర్ ఈ ఫార్ములాను ఉపయోగిస్తుంది — AI లెక్కించదు."
            )
        else:
            reply = (
                "EMI = [P × r × (1+r)^n] / [(1+r)^n − 1], "
                "where r is the monthly rate and n is the number of months.\n"
                "Hisaab's calculator uses this formula — the assistant does not invent numbers."
            )

    else:
        if lang == "te":
            reply = (
                TE_GREETING
                + "\n\nమీరు ఇలా అడగవచ్చు:\n"
                "• తాజా ఆదాయపు పన్ను స్లాబ్‌లు ఏమిటి?\n"
                "• పాత vs కొత్త పాలన\n"
                "• నా లక్ష్యం ఎందుకు చేరడం లేదు?\n"
                "• SIP అంటే ఏమిటి?\n"
                "• RBI రెపో రేటు ఎంత?"
            )
        else:
            reply = (
                EN_GREETING
                + "\n\nTry asking:\n"
                "• What are the latest income tax slabs?\n"
                "• Old vs new tax regime\n"
                "• Why am I not reaching my goal?\n"
                "• What is an SIP?\n"
                "• What is the RBI repo rate?"
            )

    disclaimer = (
        "Hisaab Mitra explains illustrative Hisaab calculations and links to official references. "
        "It does not provide personalised investment advice."
        if lang == "en"
        else "Hisaab Mitra Hisaab యొక్క ఉదాహరణాత్మక లెక్కలు మరియు అధికారిక మూలాలను వివరిస్తుంది. ఇది వ్యక్తిగతీకరించిన పెట్టుబడి సలహా కాదు."
    )
    llm_meta = None
    # Optional fluency layer: only rewrite the grounded reply; never replace facts.
    if llm_provider.available() and reply:
        grounded = f"Language={lang}\nGrounded answer to preserve:\n{reply}\n\nCalculations={calcs}"
        llm_out = llm_provider.complete(q, grounded)
        if llm_out and llm_out.get("text"):
            reply = llm_out["text"].strip()
            llm_meta = {"provider": llm_out.get("provider"), "model": llm_out.get("model")}
    return {
        "lang": lang,
        "reply": reply,
        "sources": sources,
        "calculations": calcs,
        "disclaimer": disclaimer,
        "llm": llm_meta,
    }
