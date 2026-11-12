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

def simulate(raw, *, trials=None, seed=None, sip_boost=1.0, delay=0, glide_path=False):
    """Reproducible monthly household simulation with optional 36-month goal de-risking."""
    p=validate(raw); n=int(trials if trials is not None else p["trials"])
    if not 100<=n<=10000: raise InputError("trials must be between 100 and 10000")
    if not isinstance(glide_path,bool): raise InputError("glide_path must be true or false")
    rng=random.Random(p["seed"] if seed is None else seed); years=p["years"]; goals=p["goals"]
    adjusted=[dict(g,at=min(years,g["at"]+(delay if g["flex"] else 0))) for g in goals]
    events={}
    for ev in p["events"]: events.setdefault(ev["year"],[]).append(ev)
    yearly=[[] for _ in range(years+1)]; hits=[0]*len(goals); failures=[0]*len(goals)
    depleted=all_hits=shock_failures=0; samples=[]
    for trial in range(n):
        equity=p["savings"]; safe=0.0; reserves=[0.0]*len(goals)
        income=p["income"]; sip=p["sip"]*sip_boost; expense=p["expense"]
        infl={k:1.0 for k in KINDS}; monthly_infl={k:1.0 for k in KINDS}; expense_index=1.0
        success=[True]*len(goals); unemployed=0; had_shock=False; shock_events=[]
        path=[round(equity,2)]; yearly[0].append(equity)
        for month in range(1,years*12+1):
            if month%12==1:
                y=(month-1)//12+1
                for ev in events.get(y,[]):
                    if ev["kind"]=="income_change": income+=ev["amount"]
                    elif ev["kind"]=="expense_change": expense+=ev["amount"]
                    else: equity-=ev["amount"]*infl["general"]
                for k,(mean,sd) in INFLATION.items():
                    rate=max(-.02,rng.gauss(mean,sd))/100; infl[k]*=1+rate; monthly_infl[k]=(1+rate)**(1/12)
                if glide_path:
                    for i,g in enumerate(adjusted):
                        left=g["at"]-y
                        if not g["flex"] and 0<=left<=3:
                            target=g["cost"]*infl[g["kind"]]*((1+INFLATION[g["kind"]][0]/100)**left); pv=target/(1.065**left)
                            move=min(max(0.0,equity),max(0.0,pv-reserves[i]))
                            equity-=move; reserves[i]+=move
            log_mean=math.log1p(p["ret"]/100)-.5*(p["vol"]/100)**2
            equity*=1+math.expm1(rng.gauss(log_mean/12,p["vol"]/math.sqrt(12)/100))
            safe*=1.065**(1/12); reserves=[v*1.065**(1/12) for v in reserves]
            monthly_expense=expense*expense_index
            if p["shocks"] and unemployed==0 and rng.random()<1-(1-.07)**(1/12):
                unemployed=6; had_shock=True; shock_events.append({"month":month,"kind":"unemployment"})
            if unemployed: unemployed-=1; monthly_income=0.0; contribution=0.0
            else:
                monthly_income=income; contribution=min(sip,max(0.0,monthly_income-monthly_expense))
            equity+=contribution-max(0.0,monthly_expense-monthly_income)
            if p["shocks"] and p["medical_shock"] and rng.random()<1-(1-.05)**(1/12):
                cost=p["medical_shock"]*infl["medical"]; equity-=cost; had_shock=True
                shock_events.append({"month":month,"kind":"medical","amount":round(cost,2)})
            if equity<0: safe=max(0.0,safe+equity); equity=0.0
            expense_index*=monthly_infl["general"]
            if monthly_income>0:
                growth=(1+p["income_growth"]/100)**(1/12)-1; income*=1+growth; sip*=1+growth
            if month%12==0:
                y=month//12
                for i,g in enumerate(adjusted):
                    if g["at"]==y:
                        target=g["cost"]*infl[g["kind"]]; available=equity+safe+reserves[i]
                        if available+.01>=target:
                            rsv=min(reserves[i],target); reserves[i]-=rsv
                            rem=target-rsv; from_safe=min(safe,rem); safe-=from_safe
                            equity=max(0.0,equity-(rem-from_safe))
                        else:
                            success[i]=False
                            if not g["flex"]: equity=safe=0.0; reserves=[0.0]*len(reserves)
                real=(equity+safe+sum(reserves))/infl["general"]; yearly[y].append(real)
                path.append(round(real,2))
        for i,ok in enumerate(success): hits[i]+=int(ok); failures[i]+=int(not ok)
        ok=all(success); all_hits+=int(ok); shock_failures+=int(not ok and had_shock)
        depleted+=int(equity+safe+sum(reserves)<=.01)
        samples.append({"ok":ok,"shocked":had_shock,"shock_events":shock_events,"values":path,"ending":equity+safe+sum(reserves)})
    fan=[{"p10":round(percentile(v,.10),2),"p50":round(percentile(v,.50),2),"p90":round(percentile(v,.90),2)} for v in yearly]
    if samples:
        all_samples=samples
        ordered=sorted(range(len(all_samples)),key=lambda i:all_samples[i]["ending"])
        survivors=[i for i,x in enumerate(all_samples) if x["ok"]]
        worst_survivor=min(survivors,key=lambda i:all_samples[i]["ending"]) if survivors else None
        mid=ordered[len(ordered)//2]
        special={i for i in (worst_survivor,mid) if i is not None}
        stress=next((i for i,x in enumerate(all_samples) if (x["shocked"] or not x["ok"] or x["ending"]<=.01) and i not in special),None)
        if stress is None:
            stress=next((i for i,x in enumerate(all_samples) if x["shocked"] or not x["ok"] or x["ending"]<=.01),None)
        if stress is not None: special.add(stress)
        quantiles={ordered[round(k*(len(ordered)-1)/23)] for k in range(24)}
        chosen=special | quantiles
        while len(chosen)>24:
            removable=next((i for i in sorted(chosen,reverse=True) if i not in special),None)
            if removable is None: break
            chosen.remove(removable)
        if len(chosen)<24:
            for i in ordered:
                chosen.add(i)
                if len(chosen)==24: break
        samples=[all_samples[i] for i in sorted(chosen)]
        for x in samples:
            x["label"]="worst_surviving" if worst_survivor is not None and x is all_samples[worst_survivor] else "median" if x is all_samples[mid] else "depleted_or_shocked" if stress is not None and x is all_samples[stress] else "sample"
            del x["ending"]
    failed=max(1,n-all_hits)
    weakest=min(({"name":g["name"],"odds":hits[i]/n} for i,g in enumerate(goals)),key=lambda x:x["odds"])
    return {"score":all_hits/n,"trials":n,"seed":p["seed"] if seed is None else seed,
      "goals":[{"name":g["name"],"at":adjusted[i]["at"],"odds":hits[i]/n} for i,g in enumerate(goals)],
      "fan":fan,"sample_paths":samples,"ending":fan[-1],"depletion_odds":depleted/n,
      "diagnostics":{"shock_attributed_failure_share":round(shock_failures/failed,3) if all_hits<n else 0.0,
       "weakest_goal":weakest,"goal_failure_share":[{"name":g["name"],"failed_trials":failures[i],"failure_share":round(failures[i]/n,3)} for i,g in enumerate(goals)]},
      "assumptions":{"monthly_cashflow":True,"expense_inflation":"general","goal_inflation":"category-specific","job_loss_months":6,
       "job_loss_annual_probability":.07,"medical_event_annual_probability":.05,"glide_path_enabled":glide_path,"debt_bucket_return":.065,
       "life_events":p["events"],"return_model":"lognormal monthly returns calibrated to annual arithmetic mean and volatility"}}

def target_sip(p,base,target=.85):
    """Binary-search the smallest feasible monthly SIP for the target success odds."""
    p=validate(p)
    if not 0 < target <= 1:
        raise InputError("target must be greater than 0 and at most 1")
    if base["score"]>=target:
        return {"target_score":target,"monthly_sip":p["sip"],"additional_monthly_sip":0.0,"reachable":True}
    initial_surplus=max(0.0,p["income"]-p["expense"])
    if p["sip"]<=0 or initial_surplus<=p["sip"]:
        return {"target_score":target,"monthly_sip":p["sip"],"additional_monthly_sip":0.0,"reachable":False}
    low,high=1.0,min(16.0,initial_surplus/p["sip"])
    target_trials=min(p["trials"],500)
    if simulate(p,trials=target_trials,seed=p["seed"],sip_boost=high)["score"]<target:
        return {"target_score":target,"monthly_sip":round(p["sip"]*high,2),
                "additional_monthly_sip":round(p["sip"]*(high-1),2),"reachable":False}
    for _ in range(24):
        mid=(low+high)/2
        score=simulate(p,trials=target_trials,seed=p["seed"],sip_boost=mid)["score"]
        if score>=target: high=mid
        else: low=mid
    monthly=p["sip"]*high
    return {"target_score":target,"monthly_sip":round(monthly,2),
            "additional_monthly_sip":round(max(0,monthly-p["sip"]),2),"reachable":True}

def nudge(p,base):
    """Four scenario comparisons using common random numbers."""
    p=validate(p); seed=p["seed"]; trials=p["trials"]
    options=[("Baseline",{}),("3-Yr Debt Glide-Path",{"glide_path":True}),("SIP +15%",{"sip_boost":1.15}),("SIP +30% + Glide-Path",{"sip_boost":1.30,"glide_path":True})]
    scenarios=[]
    for label,change in options:
        r=simulate(p,trials=trials,seed=seed,**change)
        scenarios.append({"label":label,"score":r["score"],"depletion_odds":r["depletion_odds"],"ending_median":r["ending"]["p50"],
          "goals":[{"name":g["name"],"odds":g["odds"]} for g in r["goals"]]})
    best=max(scenarios[1:],key=lambda x:x["score"])
    return {"scenarios":scenarios,"best":{"text":best["label"],"score":best["score"]} if best["score"]>base["score"]+.005 else None,
      "target_sip":target_sip(p,base)}

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
