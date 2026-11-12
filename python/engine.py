"""Hisaab Parallel Lives: monthly, reproducible household-finance simulations.

Standard-library only. Production household-finance digital twin engine. Not personalised investment advice.
"""
from __future__ import annotations
import json
import math
import os
import random
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import tax_engine
import data_service
import mitra
import pdf_report
import ingestion
import llm_provider

INFLATION = {
    "general": (6.0, 1.2),
    "education": (10.0, 2.0),
    "medical": (8.0, 2.0),
    "home": (5.5, 1.2),
}
KINDS = set(INFLATION)
MAX_BODY = 64 * 1024

class InputError(ValueError):
    pass

def _number(p, key, low, high, *, default=None):
    value = p.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InputError(f"{key} must be a finite number")
    if not low <= value <= high:
        raise InputError(f"{key} must be between {low} and {high}")
    return float(value)

def _integer(p, key, low, high, *, default=None):
    value = _number(p, key, low, high, default=default)
    if not value.is_integer():
        raise InputError(f"{key} must be a whole number")
    return int(value)

def validate(p):
    if not isinstance(p, dict):
        raise InputError("Request must be a JSON object")
    years = _integer(p, "years", 1, 40)
    savings = _number(p, "savings", 0, 1_000_000_000_000)
    sip = _number(p, "sip", 0, 100_000_000)
    expense = _number(p, "expense", 0, 100_000_000)
    income = _number(p, "income", 0, 100_000_000)
    ret = _number(p, "ret", -50, 40)
    vol = _number(p, "vol", 0, 80)
    income_growth = _number(p, "income_growth", -30, 50)
    medical_shock = _number(p, "medical_shock", 0, 100_000_000)
    shocks = p.get("shocks", True)
    if not isinstance(shocks, bool):
        raise InputError("shocks must be true or false")
    seed = p.get("seed", 20261112)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**32 - 1:
        raise InputError("seed must be an integer between 0 and 4294967295")
    trials = _integer(p, "trials", 100, 10000, default=2000)
    goals = p.get("goals")
    if not isinstance(goals, list) or not 1 <= len(goals) <= 12:
        raise InputError("Add between 1 and 12 goals")
    clean_goals = []
    for i, g in enumerate(goals):
        if not isinstance(g, dict):
            raise InputError(f"Goal {i+1} must be an object")
        name = g.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60:
            raise InputError(f"Goal {i+1} needs a name of 1–60 characters")
        at = _integer(g, "at", 1, years)
        cost = _number(g, "cost", 1, 100_000_000_000)
        kind = g.get("kind")
        if kind not in KINDS:
            raise InputError(f"Goal {i+1} has an unsupported inflation category")
        flex = g.get("flex", False)
        if not isinstance(flex, bool):
            raise InputError(f"Goal {i+1}: flex must be true or false")
        clean_goals.append({"name": name.strip(), "at": at, "cost": cost, "kind": kind, "flex": flex})
    events = p.get("events", [])
    if not isinstance(events, list) or len(events) > 20:
        raise InputError("Add no more than 20 life events")
    clean_events = []
    for i, event in enumerate(events):
        if not isinstance(event, dict):
            raise InputError(f"Life event {i+1} must be an object")
        kind = event.get("kind")
        if kind not in ("income_change", "expense_change", "one_time_cost"):
            raise InputError(f"Life event {i+1} has an unsupported type")
        year = event.get("year")
        if isinstance(year, bool) or not isinstance(year, int) or not 1 <= year <= years:
            raise InputError(f"Life event {i+1} year must be within the simulation")
        amount = _number(event, "amount", 1, 100_000_000)
        clean_events.append({"kind": kind, "year": year, "amount": amount,
                             "label": str(event.get("label", kind.replace("_", " ")))[:60]})
    return {"years": years, "savings": savings, "sip": sip, "expense": expense,
            "income": income, "ret": ret, "vol": vol, "income_growth": income_growth,
            "medical_shock": medical_shock, "shocks": shocks, "seed": seed,
            "trials": trials, "goals": clean_goals, "events": clean_events}

def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = int(pos); hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] * (hi - pos) + ordered[hi] * (pos - lo)

def simulate(raw, *, trials=None, seed=None, sip_boost=1.0, delay=0):
    p = validate(raw)
    n = int(trials if trials is not None else p["trials"])
    if not 100 <= n <= 10000:
        raise InputError("trials must be between 100 and 10000")
    rng = random.Random(p["seed"] if seed is None else seed)
    years, goals = p["years"], p["goals"]
    adjusted_goals = [dict(g, at=min(years, g["at"] + (delay if g["flex"] else 0))) for g in goals]
    events_by_year = {}
    for event in p["events"]:
        events_by_year.setdefault(event["year"], []).append(event)
    yearly_corpus = [[] for _ in range(years + 1)]
    goal_hits = [0] * len(goals)
    depleted = 0
    all_hits = 0

    # Annual inflation is sampled once per year, then compounded monthly.
    for _ in range(n):
        corpus = p["savings"]
        income, planned_sip = p["income"], p["sip"] * sip_boost
        base_expense = p["expense"]
        annual_inflation = {k: 1.0 for k in KINDS}
        monthly_inflation_factor = {k: 1.0 for k in KINDS}
        expense_price_index = 1.0
        success = [True] * len(goals)
        unemployed_months = 0
        yearly_corpus[0].append(corpus)
        for month in range(1, years * 12 + 1):
            if month % 12 == 1:
                year_now = (month - 1) // 12 + 1
                for event in events_by_year.get(year_now, []):
                    if event["kind"] == "income_change":
                        income += event["amount"]
                    elif event["kind"] == "expense_change":
                        base_expense += event["amount"]
                    elif event["kind"] == "one_time_cost":
                        corpus = max(0.0, corpus - event["amount"] * annual_inflation["general"])
                for category, (mean, sd) in INFLATION.items():
                    annual_rate = max(-0.02, rng.gauss(mean, sd)) / 100
                    annual_inflation[category] *= 1 + annual_rate
                    monthly_inflation_factor[category] = (1 + annual_rate) ** (1 / 12)
            annual_log_return = math.log1p(p["ret"] / 100) - 0.5 * (p["vol"] / 100) ** 2
            monthly_log_return = rng.gauss(annual_log_return / 12,
                                           p["vol"] / math.sqrt(12) / 100)
            monthly_return = math.expm1(monthly_log_return)
            corpus *= 1 + monthly_return

            monthly_expense = base_expense * expense_price_index
            # Job loss lasts six months; during it, income and SIP stop.
            if p["shocks"] and unemployed_months == 0 and rng.random() < 1 - (1 - 0.07) ** (1 / 12):
                unemployed_months = 6
            if unemployed_months:
                unemployed_months -= 1
                monthly_income = 0.0
                contribution = 0.0
            else:
                monthly_income = income
                contribution = min(planned_sip, max(0.0, monthly_income - monthly_expense))
            deficit = max(0.0, monthly_expense - monthly_income)
            corpus += contribution - deficit

            if p["shocks"] and p["medical_shock"] and rng.random() < 1 - (1 - 0.05) ** (1 / 12):
                corpus -= p["medical_shock"] * annual_inflation["medical"]
            corpus = max(0.0, corpus)
            expense_price_index *= monthly_inflation_factor["general"]
            if monthly_income > 0:
                monthly_income_growth = (1 + p["income_growth"] / 100) ** (1 / 12) - 1
                income *= 1 + monthly_income_growth
                planned_sip *= 1 + monthly_income_growth

            if month % 12 == 0:
                year = month // 12
                for i, goal in enumerate(adjusted_goals):
                    if goal["at"] == year:
                        target = goal["cost"] * annual_inflation[goal["kind"]]
                        if corpus >= target:
                            corpus -= target
                        else:
                            success[i] = False
                            corpus = 0.0
                yearly_corpus[year].append(corpus / annual_inflation["general"])
        for i, ok in enumerate(success):
            goal_hits[i] += int(ok)
        all_hits += int(all(success))
        depleted += int(corpus <= 0.01)

    fan = [{"p10": round(percentile(v, .10), 2), "p50": round(percentile(v, .50), 2),
            "p90": round(percentile(v, .90), 2)} for v in yearly_corpus]
    return {
        "score": all_hits / n,
        "trials": n,
        "seed": p["seed"] if seed is None else seed,
        "goals": [{"name": g["name"], "at": adjusted_goals[i]["at"], "odds": goal_hits[i] / n}
                  for i, g in enumerate(goals)],
        "fan": fan,
        "ending": fan[-1],
        "depletion_odds": depleted / n,
        "assumptions": {"monthly_cashflow": True, "expense_inflation": "general",
                        "goal_inflation": "category-specific", "job_loss_months": 6,
                        "job_loss_annual_probability": 0.07,
                        "medical_event_annual_probability": 0.05,
                        "life_events": p["events"],
                        "return_model": "lognormal monthly returns calibrated to annual arithmetic mean and volatility"}
    }

def nudge(p, base):
    """Return a three-way comparison using common random numbers.

    Always returns Baseline + two alternative scenarios so the UI can show
    a fair side-by-side comparison. Also surfaces the single best improvement
    as the legacy "nudge" for older clients.
    """
    p = validate(p)
    seed = p["seed"]
    trials = p["trials"]

    alternatives = [
        ("Baseline", {}),
        ("SIP +15%", {"sip_boost": 1.15}),
        ("SIP +30%", {"sip_boost": 1.30}),
    ]
    can_delay = any(g["flex"] for g in p["goals"]) and all(
        g["at"] + 2 <= p["years"] for g in p["goals"] if g["flex"]
    )
    if can_delay:
        alternatives[2] = ("Delay flexible goals by 2 years", {"delay": 2})

    scenarios = []
    for label, change in alternatives:
        result = simulate(p, trials=trials, seed=seed, **change)
        scenarios.append({
            "label": label,
            "score": result["score"],
            "depletion_odds": result["depletion_odds"],
            "ending_median": result["ending"]["p50"],
            "goals": [{"name": g["name"], "odds": g["odds"]} for g in result["goals"]],
        })

    # Keep legacy single-best nudge for older front-ends
    best = max(scenarios[1:], key=lambda x: x["score"])
    legacy = None
    if best["score"] > base["score"] + 0.005:
        legacy = {"text": best["label"], "score": best["score"]}

    return {
        "scenarios": scenarios,
        "best": legacy,
    }

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _reply(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 1 <= length <= MAX_BODY:
            raise InputError("Request body must be between 1 byte and 64 KB")
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        try:
            if self.path == "/simulate":
                raw = self._read_json()
                result = simulate(raw)
                result["nudge"] = nudge(raw, result)
                self._reply(200, result)
                return
            if self.path == "/tax/compute":
                raw = self._read_json()
                taxable = float(raw.get("taxable_income", 0))
                regime = str(raw.get("regime", "new"))
                year = str(raw.get("tax_year", "2026-27"))
                via = float(raw.get("chapter_via_deductions", 0))
                self._reply(200, tax_engine.compute_tax(taxable, tax_year=year, regime=regime, chapter_via_deductions=via))
                return
            if self.path == "/tax/compare":
                raw = self._read_json()
                income = float(raw.get("income", 0))
                via = float(raw.get("chapter_via_deductions", 0))
                self._reply(200, tax_engine.compare_regimes(income, via))
                return
            if self.path == "/mitra":
                raw = self._read_json()
                q = str(raw.get("question", ""))
                ctx = raw.get("context") if isinstance(raw.get("context"), dict) else {}
                self._reply(200, mitra.answer(q, ctx))
                return
            if self.path == "/report/pdf":
                raw = self._read_json()
                lang = str(raw.get("lang", "en"))
                if lang not in ("en", "te"):
                    lang = "en"
                pdf_bytes = pdf_report.build_pdf(raw, lang=lang)
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Disposition", f'attachment; filename="hisaab-report-{lang}.pdf"')
                self.send_header("Content-Length", str(len(pdf_bytes)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(pdf_bytes)
                return
            if self.path == "/ingestion/fetch":
                raw = self._read_json()
                source_id = str(raw.get("source_id", ""))
                self._reply(200, ingestion.fetch_source(source_id))
                return
            if self.path == "/ingestion/monitor":
                self._reply(200, {"results": ingestion.monitor_all()})
                return
            if self.path == "/ingestion/approve":
                raw = self._read_json()
                self._reply(200, ingestion.approve_candidate(str(raw.get("filename", "")), str(raw.get("reviewer", "operator"))))
                return
            self._reply(404, {"error": "Not found"})
        except (InputError, json.JSONDecodeError, TypeError, KeyError, ValueError) as exc:
            self._reply(400, {"error": str(exc)})
        except Exception:
            self._reply(500, {"error": "Request failed; check inputs and try again"})

    def do_GET(self):
        if self.path in ("/healthz", "/readyz"):
            self._reply(200, {"status": "ok"})
            return
        if self.path == "/data/snapshot":
            self._reply(200, data_service.snapshot())
            return
        if self.path == "/tax/rules":
            self._reply(200, {"packs": tax_engine.list_rule_packs()})
            return
        if self.path == "/ingestion/status":
            self._reply(200, ingestion.status_summary())
            return
        if self.path == "/ingestion/candidates":
            self._reply(200, {"candidates": ingestion.list_candidates()})
            return
        if self.path == "/llm/status":
            self._reply(200, {"available": llm_provider.available(), "provider": __import__("os").environ.get("HISAAB_LLM_PROVIDER", "") or None})
            return
        self._reply(404, {"error": "Not found"})

    def log_message(self, fmt, *args):
        # Structured one-liner; keep quiet for health probes
        if args and "/healthz" in str(args[0]):
            return
        print(f'{{"ts":"{__import__("datetime").datetime.utcnow().isoformat()}Z","level":"INFO","component":"engine","msg":"{fmt % args}"}}', flush=True)

if __name__ == "__main__":
    port = int(os.environ.get("HISAAB_ENGINE_PORT", "8081"))
    # Engine intentionally bound to localhost only — never expose publicly.
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f'{{"ts":"{__import__("datetime").datetime.utcnow().isoformat()}Z","level":"INFO","component":"engine","msg":"ready","port":{port}}}', flush=True)
    server.serve_forever()
