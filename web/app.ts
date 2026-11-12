import { type SimulationInput, type SimulationResult } from "./src/core/simulation.js";
import { calculateEmi } from "./src/core/emi.js";
import { estimateSalary } from "./src/core/tax.js";
import { answerMitra } from "./src/assistant/mitra.js";
import pdfMake from "pdfmake/build/pdfmake.js";
type Kind = "general" | "education" | "medical" | "home";
interface Goal { name: string; at: number; cost: number; kind: Kind; flex: boolean }
interface Fan { p10: number; p50: number; p90: number }
interface ScenarioCard { label: string; score: number; depletion_odds: number; ending_median: number; goals: { name: string; odds: number }[] }
interface ShockCounterfactual { failures_prevented_if_removed: number; new_failures_in_counterfactual: number; net_failure_reduction: number; paired_trials: number }
interface NudgePayload { scenarios?: ScenarioCard[]; best?: { text: string; score: number } | null; text?: string; score?: number; target_sip?: { target_score:number; monthly_sip:number; additional_monthly_sip:number; reachable:boolean; achieved_score?:number; trials?:number }; shock_counterfactuals?: Record<string, ShockCounterfactual> }
interface SamplePath { ok:boolean; shocked:boolean; shock_events:{month:number;kind:string;amount?:number}[]; values:number[]; label:string; tags?:string[] }
interface Result { score:number; trials:number; seed:number; goals:{name:string;at:number;odds:number}[]; fan:Fan[]; sample_paths?:SamplePath[]; ending:Fan; depletion_odds:number; diagnostics?:{weakest_goal?:{name:string;odds:number};failed_lives_with_shock_share?:number;shock_cooccurrence_note?:string}; nudge:NudgePayload|null }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const compact = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n);
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const kinds: Kind[] = ["general", "education", "medical", "home"];
let activeWorker: Worker | null = null;
let cancelActiveSimulation: (() => void) | null = null;
let workerRunId = 0;
function runInWorker(input: SimulationInput): Promise<Result> {
  activeWorker?.terminate();
  const worker = new Worker(new URL("./src/workers/simulation.worker.bundle.js", import.meta.url), {type:"module"});
  activeWorker=worker; const id=++workerRunId;
  return new Promise((resolve,reject)=>{
    cancelActiveSimulation = () => { worker.terminate(); activeWorker=null; cancelActiveSimulation=null; reject(new DOMException("Simulation cancelled","AbortError")); };
    worker.onmessage=(event:MessageEvent<any>)=>{
      const msg=event.data;if(msg.id!==id)return;
      if(msg.type==="progress") $("run").textContent="Simulating "+msg.done.toLocaleString("en-IN")+" / "+msg.total.toLocaleString("en-IN")+"…";
      else if(msg.type==="result"){worker.terminate();activeWorker=null;cancelActiveSimulation=null;resolve(msg.result);}
      else if(msg.type==="error"){worker.terminate();activeWorker=null;cancelActiveSimulation=null;reject(new Error(msg.message));}
    };
    worker.onerror=()=>{worker.terminate();activeWorker=null;cancelActiveSimulation=null;reject(new Error("Simulation worker failed"));};
    worker.postMessage({type:"run",id,input});
  });
}


function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function field(labelText: string, key: string, value: string | number, type = "text", min?: number): HTMLLabelElement {
  const label = el("label"); label.append(document.createTextNode(labelText));
  const input = el("input"); input.dataset.f = key; input.type = type; input.value = String(value);
  if (min !== undefined) input.min = String(min);
  label.append(input); return label;
}
function goalRow(g: Goal): void {
  const row = el("div", "goal-row");
  row.append(field("Goal name", "name", g.name));
  row.append(field("Target year", "at", g.at, "number", 1));
  row.append(field("Cost today (₹)", "cost", g.cost, "number", 1));
  const kindLabel = el("label"); kindLabel.append(document.createTextNode("Inflation category"));
  const select = el("select"); select.dataset.f = "kind";
  for (const k of kinds) { const option = el("option", "", k[0].toUpperCase() + k.slice(1)); option.value = k; option.selected = k === g.kind; select.append(option); }
  kindLabel.append(select); row.append(kindLabel);
  const flexLabel = el("label", "goal-flex"); const flex = el("input"); flex.type = "checkbox"; flex.dataset.f = "flex"; flex.checked = g.flex;
  flexLabel.append(flex, document.createTextNode(" Flexible timing")); row.append(flexLabel);
  const remove = el("button", "remove-goal", "Remove"); remove.type = "button"; remove.setAttribute("aria-label", `Remove ${g.name}`);
  remove.addEventListener("click", () => row.remove()); row.append(remove);
  $("goals").append(row);
}
function readGoals(): Goal[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".goal-row")).map(row => {
    const get = (key: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-f="${key}"]`)!;
    return { name: get("name").value.trim(), at: Number(get("at").value), cost: Number(get("cost").value), kind: get("kind").value as Kind, flex: (get("flex") as HTMLInputElement).checked };
  });
}
function drawFan(fan: Fan[], samplePaths: SamplePath[] = []): void {
  const canvas = $("fan") as HTMLCanvasElement, ctx = canvas.getContext("2d"); if (!ctx || fan.length < 2) return;
  const W = canvas.width, H = canvas.height, left = 82, right = 18, topPad = 20, bottom = 42;
  const max = Math.max(1, ...fan.map(v => v.p90)) * 1.08, n = fan.length - 1;
  const px = (i: number) => left + i / n * (W - left - right), py = (v: number) => H - bottom - v / max * (H - topPad - bottom);
  ctx.clearRect(0, 0, W, H); ctx.font = "14px system-ui"; ctx.fillStyle = css("--muted"); ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; ctx.beginPath(); ctx.moveTo(left, py(v)); ctx.lineTo(W - right, py(v)); ctx.stroke(); ctx.fillText(compact(v), 6, py(v) + 5); }
  const step = Math.max(1, Math.ceil(n / 8));
  for (let i = 0; i <= n; i += step) ctx.fillText(`Y${i}`, px(i) - 10, H - 12);
  ctx.beginPath(); fan.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](px(i), py(v.p90)));
  for (let i = n; i >= 0; i--) ctx.lineTo(px(i), py(fan[i].p10));
  ctx.closePath(); ctx.fillStyle = css("--chart-band"); ctx.fill();
  for (const path of samplePaths) { if (!Array.isArray(path.values)) continue; ctx.beginPath(); path.values.forEach((v,i)=>ctx[i?"lineTo":"moveTo"](px(i),py(v))); ctx.strokeStyle=path.ok?"rgba(40,150,112,0.28)":"rgba(217,104,82,0.34)"; ctx.lineWidth=path.label==="worst_surviving"?2:1.15; ctx.stroke(); }
  ctx.beginPath(); fan.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](px(i), py(v.p50)));
  ctx.strokeStyle = css("--chart-line"); ctx.lineWidth = 3; ctx.stroke();
}
function show(r: Result): void {
  $("out").hidden = false;
  const score = Math.round(r.score * 100);
  $("score").textContent = `${score}%`;
  $("score").setAttribute("data-level", score >= 75 ? "good" : score >= 45 ? "mid" : "low");
  $("verdict").textContent = `${score} out of 100 simulated lives funded every goal on schedule.`;
  $("seedLabel").textContent = `Scenario seed · ${r.seed}`;
  $("trialLabel").textContent = `${r.trials.toLocaleString("en-IN")} lives simulated`;
  $("endingMedian").textContent = compact(r.ending.p50);
  $("endingLow").textContent = compact(r.ending.p10);
  $("endingHigh").textContent = compact(r.ending.p90);
  $("depletion").textContent = `${Math.round(r.depletion_odds * 100)}%`;
  drawFan(r.fan, r.sample_paths || []);
  const diagnostic=r.diagnostics||{}; const weakest=diagnostic.weakest_goal; const diagNode=$("diagnostics");
  if(diagNode) diagNode.textContent=weakest ? "Most fragile goal: "+weakest.name+" ("+Math.round(weakest.odds*100)+"% funded) · Failed lives that also experienced a shock: "+Math.round((diagnostic.failed_lives_with_shock_share||0)*100)+"%" : "";
  const shockedPath=(r.sample_paths||[]).find(path=>path.shock_events&&path.shock_events.length); const chartNote=$("chartNote");
  if(chartNote) chartNote.textContent="25 sampled household paths · Green: all goals funded · Coral: at least one goal missed"+(shockedPath?" · Example shock: "+shockedPath.shock_events.map(event=>event.kind+" at month "+event.month).join(", "):"");
  const odds = $("odds"); odds.replaceChildren();
  for (const g of r.goals) {
    const row = el("div", "odds-row"), title = el("div", "odds-title");
    title.append(el("strong", "", g.name), el("span", "", `Year ${g.at}`));
    const track = el("div", "odds-track"), fill = el("progress", "odds-progress") as HTMLProgressElement; fill.max = 100; fill.value = Math.round(g.odds * 100); fill.setAttribute("aria-label", `${g.name}: ${Math.round(g.odds * 100)} percent chance`); fill.dataset.level = g.odds >= .75 ? "good" : g.odds >= .45 ? "mid" : "low"; track.append(fill);
    row.append(title, track, el("strong", "odds-value", `${Math.round(g.odds * 100)}%`)); odds.append(row);
  }
  const card = $("nudgeCard");
  const compare = $("compareGrid");
  const n = r.nudge;
  const scenarios = n && Array.isArray(n.scenarios) ? n.scenarios : null;
  if (scenarios && scenarios.length >= 2) {
    card.hidden = false;
    $("nudgeTitle").textContent = language === "te" ? "నాలుగు సన్నివేశాల పోలిక" : "Four-way scenario comparison";
    $("nudgeText").textContent = language === "te"
      ? "అదే యాదృచ్ఛిక జీవితాలతో బేస్‌లైన్ మరియు మూడు ప్రత్యామ్నాయాలు."
      : "Baseline and three alternatives using the exact same random lives.";
    if (compare) {
      compare.innerHTML = "";
      scenarios.forEach((s, idx) => {
        const art = el("article", "compare-card" + (idx === 0 ? " is-baseline" : ""));
        const title = el("h4", "", s.label);
        const score = el("div", "compare-score", Math.round(s.score * 100) + "%");
        const meta = el("p", "compare-meta",
          (language === "te" ? "మధ్యస్థ నిధి " : "Median corpus ") + inr(s.ending_median)
          + " · " + (language === "te" ? "ఖాళీ " : "Depletion ") + Math.round(s.depletion_odds * 100) + "%");
        art.append(title, score, meta);
        compare.append(art);
      });
      const target=n?.target_sip, targetNode=document.getElementById("targetSip");
      if(targetNode){targetNode.textContent=target ? (language==="te" ? `85% లక్ష్యానికి అవసరమైన అంచనా SIP: ₹${Math.round(target.monthly_sip).toLocaleString("en-IN")} · అదనంగా ₹${Math.round(target.additional_monthly_sip).toLocaleString("en-IN")} / నెల · ${target.reachable?"సాధ్యం":"ఈ నమూనాలో సాధ్యం కాలేదు"}` : `Estimated SIP for ${Math.round(target.target_score*100)}% goal success: ${inr(target.monthly_sip)} / month · Additional ${inr(target.additional_monthly_sip)} / month · ${target.reachable?"Reachable in this model":"Not reachable within the modelled income ceiling"}`) : ""; }
      const shockNode=document.getElementById("shockComparison");
      if(shockNode){const entries=Object.entries(n?.shock_counterfactuals??{});shockNode.replaceChildren(el("strong","",language==="te"?"జత చేసిన షాక్ పోలిక":"Paired shock counterfactuals"));for(const [key,value] of entries){shockNode.append(el("p","",`${key}: ${value.failures_prevented_if_removed} failures avoided, ${value.new_failures_in_counterfactual} new failures, net ${value.net_failure_reduction} across ${value.paired_trials} paired trials`));}}
    } else {
      const targetNode=document.getElementById("targetSip");if(targetNode)targetNode.textContent="";const shockNode=document.getElementById("shockComparison");if(shockNode)shockNode.textContent="";
    }
  } else {
    const best = n && (n.best || (n.text ? { text: n.text, score: n.score! } : null));
    card.hidden = !best;
    if (best) {
      $("nudgeTitle").textContent = best.text || "";
      $("nudgeText").textContent = `The tested scenario raised the all-goals success rate to ${Math.round((best.score || 0) * 100)}%.`;
    }
    if (compare) compare.innerHTML = "";
  }
}

$("sim").addEventListener("submit", async event => {
  event.preventDefault();
  const form = $("sim") as HTMLFormElement, data = new FormData(form), num = (key: string) => Number(data.get(key));
  const goals = readGoals(), events = readEvents(), years = num("years");
  const error = $("err"), button = $("run") as HTMLButtonElement;
  const invalid = !Number.isInteger(num("trials")) || num("trials") < 100 || num("trials") > 10000 || goals.length < 1 || goals.length > 12 || goals.some(g => !g.name || !Number.isInteger(g.at) || g.at < 1 || g.at > years || !Number.isFinite(g.cost) || g.cost <= 0) || events.some(e => !e.label || !Number.isInteger(e.year) || e.year < 1 || e.year > years || !Number.isFinite(e.amount) || e.amount <= 0);
  if (invalid) { error.textContent = "Check the trial count, goal years/costs, and life-event years/amounts. All must be valid and within your simulation horizon."; error.hidden = false; return; }
  const body = { years, trials:num("trials"), savings: num("savings"), income: num("income"), sip: num("sip"), expense: num("expense"), ret: num("ret"), vol: num("vol"), income_growth: num("income_growth"), medical_shock: num("medical_shock"), seed: num("seed"), shocks: data.has("shocks"), goals, events };
  button.disabled = true; button.textContent = "Simulating possible lives…"; error.hidden = true; $("trialCount").textContent = num("trials").toLocaleString("en-IN")+" simulated lives";
  const cancel = el("button", "button button-quiet", "Cancel simulation"); cancel.type = "button"; cancel.id = "cancelSimulation"; button.parentElement?.append(cancel);
  cancel.addEventListener("click", () => { cancelActiveSimulation?.(); cancelActiveSimulation = null; workerRunId++; cancel.remove(); button.disabled = false; button.textContent = "Run the futures ↗"; error.textContent = "Simulation cancelled."; error.hidden = false; });
  try {
    const payload = await runInWorker(body as SimulationInput);
    show(payload as Result); $("out").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { error.textContent = `Could not run the simulation: ${(e as Error).message}`; error.hidden = false; }
  finally { document.getElementById("cancelSimulation")?.remove(); button.disabled = false; button.replaceChildren(document.createTextNode("Run the futures "), el("span", "", "↗")); }
});

$("add").addEventListener("click", () => {
  const years = Number(($('sim') as HTMLFormElement).elements.namedItem("years") instanceof HTMLInputElement ? (($('sim') as HTMLFormElement).elements.namedItem("years") as HTMLInputElement).value : 10);
  goalRow({ name: "New goal", at: Math.min(10, Math.max(1, years)), cost: 500000, kind: "general", flex: true });
});
goalRow({ name: "Child's education", at: 15, cost: 2500000, kind: "education", flex: false });
goalRow({ name: "Home down payment", at: 8, cost: 2000000, kind: "home", flex: true });
goalRow({ name: "Parents' medical fund", at: 10, cost: 1000000, kind: "medical", flex: false });

function updateQuickMath(): void {
  const value = (id: string) => Number(($<HTMLInputElement>(id)).value);
  try {
    const emi = calculateEmi(value("loan"), value("rate"), value("ly"));
    const tax = estimateSalary(value("ctc"), value("basic"), value("pt"));
    $("emiOut").textContent = "Monthly EMI " + inr(emi.emi) + " · Total interest " + inr(emi.interest);
    $("taxOut").textContent = "Estimated monthly take-home " + inr(tax.inhand / 12) + " · Estimated annual tax " + inr(tax.tax);
  } catch (e) { $("emiOut").textContent = (e as Error).message; $("taxOut").textContent = "Salary estimate unavailable."; }
}
["loan", "rate", "ly", "ctc", "basic", "pt"].forEach(id => $(id).addEventListener("input", updateQuickMath));
updateQuickMath();

// Hisaab Financial Digital Twin: timed life events, Telugu interface and printable PDF report.
type LifeEvent = { label: string; year: number; kind: "income_change" | "expense_change" | "one_time_cost"; amount: number };
let lastInput: any = null;
let lastResult: Result | null = null;
let language: "en" | "te" = "en";
const translations: Record<string,string> = {
  "PLAN FOR UNCERTAINTY, NOT JUST AVERAGES":"సగటులనే కాదు, అనిశ్చితినీ దృష్టిలో పెట్టుకుని ప్రణాళిక చేయండి",
  "Your future isn't":"మీ భవిష్యత్తు",
  "one number.":"ఒకే సంఖ్య కాదు.",
  "Run thousands of plausible financial lives. See which goals survive inflation, market swings, income gaps and unexpected costs — then test what could improve the odds.":"వేల సాధ్యమైన ఆర్థిక భవిష్యత్తులను పరిశీలించండి. ద్రవ్యోల్బణం, మార్కెట్ మార్పులు, ఆదాయ అంతరాలు, అనుకోని ఖర్చుల మధ్య మీ లక్ష్యాలు ఎంతవరకు సాధ్యమో తెలుసుకోండి.",
  "Household-finance scenario simulator · No account connection · No personal data stored":"కుటుంబ ఆర్థిక సన్నివేశ సిమ్యులేటర్ · ఖాతా అనుసంధానం లేదు · వ్యక్తిగత డేటా నిల్వ చేయబడదు",
  "01 / YOUR BASELINE":"01 / మీ ప్రస్తుత ఆర్థిక స్థితి",
  "Start with today":"ఈరోజు స్థితితో ప్రారంభించండి",
  "About 2 minutes":"సుమారు 2 నిమిషాలు",
  "Years to explore":"పరిశీలించాల్సిన సంవత్సరాలు",
  "Current savings":"ప్రస్తుత పొదుపు",
  "Monthly take-home income":"నెలవారీ చేతికి వచ్చే ఆదాయం",
  "Monthly household expenses":"నెలవారీ కుటుంబ ఖర్చులు",
  "Planned monthly SIP":"ప్రణాళిక చేసిన నెలవారీ SIP",
  "Expected annual return":"అంచనా వార్షిక రాబడి",
  "Annual return volatility":"వార్షిక రాబడి హెచ్చుతగ్గులు",
  "Annual income growth":"వార్షిక ఆదాయ వృద్ధి",
  "Unexpected medical cost today":"ప్రస్తుత అనుకోని వైద్య ఖర్చు",
  "Scenario seed":"సన్నివేశ సీడ్",
  "How far into the future?":"భవిష్యత్తులో ఎంత దూరం?",
  "Investable corpus today":"ఈరోజు పెట్టుబడికి అందుబాటులో ఉన్న మొత్తం",
  "Income available after tax":"పన్నుల తర్వాత అందుబాటులో ఉన్న ఆదాయం",
  "Living costs, before goal spending":"లక్ష్య ఖర్చులకు ముందు జీవన వ్యయాలు",
  "Investment target; capped by monthly surplus":"పెట్టుబడి లక్ష్యం; నెలవారీ మిగులుకు పరిమితం",
  "Nominal average assumption":"నామమాత్ర సగటు అంచనా",
  "How widely returns may vary":"రాబడులు ఎంత మారవచ్చో",
  "Also grows the planned SIP":"ప్రణాళిక SIP కూడా పెరుగుతుంది",
  "One-off event amount, if enabled":"ఎంచుకుంటే ఒకసారి జరిగే ఖర్చు",
  "Reuse a seed to compare like-for-like":"సమాన పరిస్థితులను పోల్చడానికి అదే సీడ్ వాడండి",
  "Include life disruptions":"జీవితంలోని అనుకోని మార్పులను చేర్చండి",
  "Model job gaps and medical emergencies":"ఉద్యోగ విరామాలు, వైద్య అత్యవసర పరిస్థితులను నమూనా చేయండి",
  "02 / WHAT MATTERS TO YOU":"02 / మీకు ముఖ్యమైన లక్ష్యాలు",
  "Your life goals":"మీ జీవిత లక్ష్యాలు",
  "＋ Add a goal":"＋ లక్ష్యాన్ని జోడించండి",
  "Enter each goal in today's rupees. Hisaab inflates its cost to the year you need it.":"ప్రతి లక్ష్యాన్ని నేటి రూపాయల్లో నమోదు చేయండి. అవసరమైన సంవత్సరానికి అనుగుణంగా హిసాబ్ ఖర్చును పెంచి లెక్కిస్తుంది.",
  "Run the futures":"భవిష్యత్తులను పరిశీలించండి",
  "03 / THE MANY-LIVES RESULT":"03 / అనేక భవిష్యత్తుల ఫలితం",
  "Your probability landscape":"మీ లక్ష్యాల సాధ్యత",
  "ALL GOALS FUNDED":"అన్ని లక్ష్యాలకు నిధులు",
  "ENDING WEALTH · TODAY'S RUPEE VALUE":"చివరి సంపద · నేటి రూపాయి విలువ",
  "Median ending corpus":"మధ్యస్థ చివరి నిధి",
  "CORPUS DEPLETION":"నిధి పూర్తిగా ఖಾಲీ అయ్యే అవకాశం",
  "How the corpus could evolve":"మీ నిధి ఎలా వృద్ధి చెందవచ్చు",
  "Goal survival map":"లక్ష్యాల సాధ్యత మ్యాప్",
  "04 / QUICK CHECKS":"04 / త్వరిత లెక్కలు",
  "Everyday money maths":"రోజువారీ ఆర్థిక లెక్కలు",
  "Loan EMI":"రుణ EMI",
  "Take-home salary":"చేతికి వచ్చే జీతం",
  "BORROWING":"రుణం",
  "SALARY ESTIMATE":"జీతం అంచనా",
  "Household-finance scenario simulator · Not personalised investment advice":"కుటుంబ ఆర్థిక సన్నివేశ సిమ్యులేటర్ · వ్యక్తిగతీకరించిన పెట్టుబడి సలహా కాదు"
};
const tr = (value: string) => language === "te" ? (translations[value] || value) : value;
function translateStatic(): void {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const raw = node.textContent || "", key = raw.trim();
    if (!key) continue;
    if (language === "en" && (node as any).__english) node.textContent = (node as any).__english;
    else if (language === "te") {
      const translated = tr(key);
      if (translated !== key) { (node as any).__english = raw; node.textContent = raw.replace(key, translated); }
    }
  }
  const toggle = $("langToggle") as HTMLButtonElement;
  toggle.textContent = language === "en" ? "తెలుగు" : "English";
  document.title = language === "te" ? "హిసాబ్ — మీ ఆర్థిక భవిష్యత్తు" : "Hisaab — Your future, in many possible lives";
}
function readEvents(): LifeEvent[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".event-row")).map(row => ({
    label: (row.querySelector<HTMLInputElement>('[data-ev="label"]')?.value || "Life event").trim(),
    year: Number(row.querySelector<HTMLInputElement>('[data-ev="year"]')?.value),
    kind: (row.querySelector<HTMLSelectElement>('[data-ev="kind"]')?.value || "one_time_cost") as LifeEvent["kind"],
    amount: Number(row.querySelector<HTMLInputElement>('[data-ev="amount"]')?.value)
  }));
}
function addEventRow(event: LifeEvent = { label: "Career change", year: 3, kind: "income_change", amount: 15000 }): void {
  const row = el("div", "event-row");
  const mk = (label: string, key: string, value: string | number, type = "text") => {
    const wrap = el("label", "", tr(label));
    const input = el("input"); input.dataset.ev = key; input.type = type; input.value = String(value);
    if (type === "number") { input.min = key === "year" ? "1" : "1"; input.step = "1"; }
    wrap.append(input); return wrap;
  };
  row.append(mk("Event name", "label", event.label), mk("Year", "year", event.year, "number"));
  const kindLabel = el("label", "", tr("Event type")), select = el("select"); select.dataset.ev = "kind";
  const choices: [LifeEvent["kind"], string][] = [["income_change","Recurring monthly income increase"],["expense_change","Recurring monthly expense increase"],["one_time_cost","One-time expense"]];
  choices.forEach(([v, label]) => { const o = el("option"); o.value = v; o.textContent = tr(label); o.selected = v === event.kind; select.append(o); });
  kindLabel.append(select); row.append(kindLabel, mk("Amount (₹ / month, or one-time)", "amount", event.amount, "number"));
  const remove = el("button", "remove-goal", language === "te" ? "తొలగించు" : "Remove"); remove.type = "button"; remove.addEventListener("click", () => row.remove()); row.append(remove);
  $("events").append(row);
}
function reportHtml(): string {
  if (!lastInput || !lastResult) return "";
  const input = lastInput;
  const result = lastResult;
  const fmt = (n:number) => "₹" + Math.round(n).toLocaleString(language === "te" ? "te-IN" : "en-IN");
  const pct = (n:number) => (n*100).toFixed(1) + "%";
  const labels = language === "te" ? {
    title:"హిసాబ్ ఆర్థిక భవిష్యత్ నివేదిక", sub:"వ్యక్తిగత ఆర్థిక సన్నివేశ విశ్లేషణ",
    summary:"సారాంశం", score:"అన్ని లక్ష్యాలు నెరవేరిన సన్నివేశాలు", corpus:"చివరి నిధి (మధ్యస్థం)",
    depletion:"నిధి ఖాళీ అయ్యే సన్నివేశాలు", inputs:"మీరు అందించిన వివరాలు", years:"పరిశీలన కాలం",
    savings:"ప్రస్తుత పొదుపు", income:"నెలవారీ ఆదాయం", expense:"నెలవారీ ఖర్చులు", sip:"నెలవారీ SIP",
    ret:"అంచనా వార్షిక రాబడి", vol:"వార్షిక రాబడి మార్పు", goals:"జీవిత లక్ష్యాలు",
    events:"జీవిత సంఘటనలు", year:"సంవత్సరం", cost:"నేటి ఖర్చు", odds:"లక్ష్య సాధ్యత",
    assumptions:"నమూనా అంచనాలు", disclaimer:"ముఖ్య గమనిక",
    note:"ఈ నివేదిక Hisaab ప్రొడక్షన్ ఆర్థిక డిజిటల్ ట్విన్ ద్వారా రూపొందించబడింది. ఫలితాలు మీరు ఇచ్చిన వివరాలు మరియు ఉత్పత్తిలో డాక్యుమెంట్ చేయబడిన నమూనా అంచనాలపై ఆధారపడతాయి. వాస్తవ మార్కెట్ రాబడులు, పన్నులు, ఫీజులు, బీమా, అప్పులు, ఆస్తుల కేటాయింపు, వ్యక్తిగత పరిస్థితులు భిన్నంగా ఉండవచ్చు. Hisaab వ్యక్తిగతీకరించిన పెట్టుబడి సలహా ఇవ్వదు. ముఖ్య నిర్ణయాలకు అర్హత కలిగిన స్వతంత్ర ఆర్థిక నిపుణుడిని సంప్రదించండి.",
    generated:"రూపొందించిన తేదీ"
  } : {
    title:"Hisaab Financial Future Report", sub:"Personal financial scenario analysis",
    summary:"Executive summary", score:"Scenarios funding every goal", corpus:"Ending corpus (median)",
    depletion:"Scenarios with depleted corpus", inputs:"Your inputs", years:"Projection horizon",
    savings:"Current savings", income:"Monthly take-home income", expense:"Monthly household expenses", sip:"Planned monthly SIP",
    ret:"Expected annual return", vol:"Annual return volatility", goals:"Life goals",
    events:"Life events", year:"Year", cost:"Cost in today's rupees", odds:"Goal success odds",
    assumptions:"Model assumptions", disclaimer:"Important disclaimer",
    note:"This report is generated by the Hisaab household-finance scenario simulator. Results depend on the inputs you provide and the model assumptions documented in the product. Actual market returns, taxes, fees, insurance, debt, asset allocation and personal circumstances can differ. Hisaab does not provide personalised investment advice. For material decisions, consult a qualified independent financial professional.",
    generated:"Generated"
  };
  const rows = Object.entries({[labels.years]:input.years+" years",[labels.savings]:fmt(input.savings),[labels.income]:fmt(input.income),[labels.expense]:fmt(input.expense),[labels.sip]:fmt(input.sip),[labels.ret]:input.ret+"%",[labels.vol]:input.vol+"%"}).map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join("");
  const goals = input.goals.map((g:any,i:number)=>`<tr><td>${escapeHtml(g.name)}</td><td>${result.goals[i]?.at ?? g.at}</td><td>${fmt(g.cost)}</td><td>${pct(result.goals[i]?.odds ?? 0)}</td></tr>`).join("");
  const events = (input.events || []).map((e:LifeEvent)=>`<tr><td>${escapeHtml(e.label)}</td><td>${e.year}</td><td>${e.kind==="income_change"?(language==="te"?"ఆదాయం పెరుగుదల":"Income increase"):e.kind==="expense_change"?(language==="te"?"ఖర్చు పెరుగుదల":"Expense increase"):(language==="te"?"ఒకసారి ఖర్చు":"One-time cost")}</td><td>${fmt(e.amount)}</td></tr>`).join("");
  const fan = result.fan.map((v:any,i:number)=>`<tr><td>${i}</td><td>${fmt(v.p10)}</td><td>${fmt(v.p50)}</td><td>${fmt(v.p90)}</td></tr>`).join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${labels.title}</title><style>
  @page{size:A4;margin:16mm}@font-face{font-family:"Hind Guntur";src:url("${location.origin}/fonts/HindGuntur-Regular.ttf") format("truetype");font-weight:400}@font-face{font-family:"Hind Guntur";src:url("${location.origin}/fonts/HindGuntur-Bold.ttf") format("truetype");font-weight:700}body{font:12px/1.55 "Hind Guntur","Nirmala UI",Arial,sans-serif;color:#1c2d36}h1{font-size:26px;color:#174f40;margin:0}h2{font-size:17px;color:#174f40;margin:24px 0 8px;border-bottom:1px solid #d8e0dc;padding-bottom:6px}.sub{color:#687780;margin:3px 0 20px}.hero{background:#f0f4ef;padding:18px;border-radius:10px}.stats{display:flex;gap:12px;margin-top:12px}.stat{flex:1;background:white;border:1px solid #dfe5df;padding:12px;border-radius:8px}.stat b{display:block;font-size:21px;color:#174f40}table{width:100%;border-collapse:collapse;margin:8px 0 16px}td,th{text-align:left;padding:7px;border-bottom:1px solid #e4e9e5}th{width:45%;color:#52636b}thead th{background:#f1f4f0;color:#174f40}.small{font-size:10px;color:#66757c}.pagebreak{break-before:page}footer{margin-top:30px;padding-top:8px;border-top:1px solid #ddd;font-size:9px;color:#69777b}@media print{button{display:none}}</style></head><body>
  <div class="hero"><h1>${labels.title}</h1><p class="sub">${labels.sub}</p><div class="stats"><div class="stat"><span>${labels.score}</span><b>${pct(result.score)}</b></div><div class="stat"><span>${labels.corpus}</span><b>${fmt(result.ending.p50)}</b></div><div class="stat"><span>${labels.depletion}</span><b>${pct(result.depletion_odds)}</b></div></div></div>
  <h2>${labels.inputs}</h2><table>${rows}</table>
  <h2>${labels.goals}</h2><table><thead><tr><th>${language==="te"?"లక్ష్యం":"Goal"}</th><th>${labels.year}</th><th>${labels.cost}</th><th>${labels.odds}</th></tr></thead><tbody>${goals}</tbody></table>
  ${events?`<h2>${labels.events}</h2><table><thead><tr><th>${language==="te"?"పేరు":"Name"}</th><th>${labels.year}</th><th>${language==="te"?"రకం":"Type"}</th><th>${language==="te"?"మొత్తం":"Amount"}</th></tr></thead><tbody>${events}</tbody></table>`:""}
  <h2>${labels.assumptions}</h2><p>${language==="te"?"నెలవారీ నగదు ప్రవాహం, లక్ష్యాల వర్గాల వారీ ద్రవ్యోల్బణం, లాగ్‌నార్మల్ నెలవారీ రాబడి నమూనా, ఉద్యోగ విరామం మరియు వైద్య అత్యవసర సంఘటనల సంభావ్యతలను ఉపయోగిస్తుంది. ఫలితాలు మీరు ఎంచుకున్న సీడ్ మరియు సిమ్యులేషన్ ట్రయల్స్‌పై ఆధారపడతాయి.":"Monthly cash-flow simulation, category-specific goal inflation, lognormal monthly return approximation, and configurable job-loss and medical-event assumptions. Results depend on the selected random seed and simulation trials."}</p>
  <h2>${language==="te"?"వార్షిక నిధి పరిధి":"Annual corpus range"}</h2><table><thead><tr><th>${labels.year}</th><th>10th percentile</th><th>Median</th><th>90th percentile</th></tr></thead><tbody>${fan}</tbody></table>
  <h2>${labels.disclaimer}</h2><p>${labels.note}</p><footer>${labels.generated}: ${new Date().toLocaleString(language==="te"?"te-IN":"en-IN")} · HISAAB · Household-finance scenario simulator</footer>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);</script></body></html>`;
}
function escapeHtml(value:string):string { return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
$("addEvent").addEventListener("click",()=>addEventRow({label:language==="te"?"కొత్త సంఘటన":"New life event",year:3,kind:"income_change",amount:15000}));
$("langToggle").addEventListener("click",()=>{ language=language==="en"?"te":"en"; translateStatic(); });
$("pdfReport").addEventListener("click", async (ev) => {
  ev.preventDefault();
  if (!lastInput || !lastResult) { alert(language==="te"?"ముందుగా సిమ్యులేషన్‌ను అమలు చేయండి.":"Run a simulation before creating your report."); return; }
  const input=lastInput, result=lastResult, te=language==="te";
  const fmt=(n:number)=>"₹"+Math.round(n).toLocaleString(te?"te-IN":"en-IN");
  const pct=(n:number)=>(n*100).toFixed(1)+"%";
  const labels=te?{
    title:"హిసాబ్ ఆర్థిక భవిష్యత్ నివేదిక",sub:"కుటుంబ ఆర్థిక సన్నివేశ విశ్లేషణ",
    summary:"సారాంశం",score:"అన్ని లక్ష్యాలు నెరవేరిన మార్గాలు",corpus:"చివరి నిధి (మధ్యస్థం)",depletion:"నిధి ఖాళీ అయిన మార్గాలు",
    inputs:"మీరు అందించిన వివరాలు",years:"పరిశీలన కాలం",savings:"ప్రస్తుత పొదుపు",income:"నెలవారీ ఆదాయం",expense:"నెలవారీ ఖర్చులు",sip:"నెలవారీ SIP",
    ret:"అంచనా వార్షిక రాబడి",vol:"వార్షిక రాబడి మార్పు",growth:"ఆదాయ వృద్ధి",trials:"సిమ్యులేషన్ మార్గాలు",
    goals:"జీవిత లక్ష్యాలు",goal:"లక్ష్యం",year:"సంవత్సరం",cost:"నేటి ఖర్చు",odds:"లక్ష్య సాధ్యత",events:"జీవిత సంఘటనలు",
    assumptions:"నమూనా అంచనాలు",notice:"ముఖ్య గమనిక",generated:"రూపొందించిన UTC సమయం"
  }:{
    title:"Hisaab Financial Future Report",sub:"Household-finance scenario analysis",
    summary:"Executive summary",score:"Paths funding every goal",corpus:"Ending corpus (median)",depletion:"Paths with depleted corpus",
    inputs:"Your inputs",years:"Projection horizon",savings:"Current savings",income:"Monthly take-home income",expense:"Monthly household expenses",sip:"Planned monthly SIP",
    ret:"Expected annual return",vol:"Annual return volatility",growth:"Annual income growth",trials:"Simulation trials",
    goals:"Life goals",goal:"Goal",year:"Year",cost:"Cost in today's rupees",odds:"Goal success odds",events:"Life events",
    assumptions:"Model assumptions",notice:"Important disclaimer",generated:"Generated (UTC)"
  };
  const table=(body:any[][],widths:any[]=["*","*"])=>({table:{headerRows:1,widths,body},layout:"lightHorizontalLines",fontSize:8,margin:[0,2,0,8]});
  const content:any[]=[
    {text:labels.title,style:"title"},{text:labels.sub,style:"sub"},
    {text:labels.summary,style:"section"},
    table([[labels.score,pct(result.score)],[labels.corpus,fmt(result.ending.p50)],[labels.depletion,pct(result.depletion_odds)]],["*","auto"]),
    {text:labels.inputs,style:"section"},
    table([[labels.years,String(input.years)],[labels.trials,String(result.trials)],[labels.savings,fmt(input.savings)],[labels.income,fmt(input.income)],[labels.expense,fmt(input.expense)],[labels.sip,fmt(input.sip)],[labels.ret,input.ret+"%"],[labels.vol,input.vol+"%"],[labels.growth,input.income_growth+"%"]],["*","auto"])
  ];
  const goalsBody:any[][]=[[labels.goal,labels.year,labels.cost,labels.odds]];
  input.goals.forEach((g:any,i:number)=>goalsBody.push([g.name,String(result.goals[i]?.at??g.at),fmt(g.cost),pct(result.goals[i]?.odds??0)]));
  content.push({text:labels.goals,style:"section"},table(goalsBody,["*","auto","auto","auto"]));
  if(result.nudge?.scenarios?.length){
    content.push({text:te?"సన్నివేశాల ప్రయోగశాల":"Scenario Lab",style:"section"});
    content.push(table([[te?"సన్నివేశం":"Scenario",te?"విజయం":"Success",te?"మధ్యస్థ నిధి":"Median corpus",te?"ఖాళీ":"Depletion"],...result.nudge.scenarios.map((x:any)=>[x.label,pct(x.score),fmt(x.ending_median),pct(x.depletion_odds)])],["*","auto","auto","auto"]));
  }
  if(result.nudge?.target_sip){
    const target=result.nudge.target_sip;
    content.push({text:te?"85% లక్ష్య SIP విశ్లేషణ":"85% target-SIP analysis",style:"section"});
    content.push({text:(te?"అంచనా నెలవారీ SIP: ":"Estimated monthly SIP: ")+fmt(target.monthly_sip)+" · "+(te?"అదనపు మొత్తం: ":"Additional amount: ")+fmt(target.additional_monthly_sip)+" · "+(target.reachable?(te?"సాధ్యం":"Reachable"):(te?"పరిమితిలో సాధ్యం కాలేదు":"Not reached within modelled income ceiling"))});
  }
  if(result.nudge?.shock_counterfactuals){
    const rows:any[][]=[[te?"షాక్ రకం":"Shock",te?"నివారించిన వైఫల్యాలు":"Failures prevented",te?"కొత్త వైఫల్యాలు":"New failures",te?"నికర మార్పు":"Net change"]];
    Object.entries(result.nudge.shock_counterfactuals).forEach(([name,value]:[string,any])=>rows.push([name,String(value.failures_prevented_if_removed),String(value.new_failures_in_counterfactual),String(value.net_failure_reduction)]));
    content.push({text:te?"జత చేసిన షాక్ ప్రతికల్పనలు":"Paired shock counterfactuals",style:"section"},table(rows,["*","auto","auto","auto"]));
  }
  if(input.events?.length){
    const rows:any[][]=[[labels.events,labels.year,te?"రకం":"Type",labels.cost]];
    input.events.forEach((e:any)=>rows.push([e.label,String(e.year),e.kind,fmt(e.amount)]));
    content.push({text:labels.events,style:"section"},table(rows,["*","auto","*","auto"]));
  }
  content.push({text:te?"వార్షిక నిధి పరిధి":"Annual corpus range",style:"section"});
  content.push(table([[labels.year,"10th",te?"మధ్యస్థం":"Median","90th"],...result.fan.map((f:Fan,i:number)=>[String(i),fmt(f.p10),fmt(f.p50),fmt(f.p90)])],["auto","*","*","*"]));
  content.push({text:labels.assumptions,style:"section"});
  content.push({text:te?"నెలవారీ నగదు ప్రవాహం · వర్గాల వారీ లక్ష్య ద్రవ్యోల్బణం · లాగ్‌నార్మల్ నెలవారీ రాబడి · ఉద్యోగ విరామం మరియు వైద్య సంఘటనల నమూనా అవకాశాలు · SIP ఖర్చుల తర్వాత మిగులుకు పరిమితం.":"Monthly cash-flow simulation · category-specific goal inflation · lognormal monthly returns · modelled job-loss and medical-event probabilities · SIP capped by surplus after expenses.",fontSize:9});
  content.push({text:labels.notice,style:"section"});
  content.push({text:te?"ఈ నివేదిక మీ ఇన్‌పుట్‌లు మరియు నమూనా అంచనాలపై ఆధారపడుతుంది. వాస్తవ మార్కెట్ రాబడులు, పన్నులు, ఫీజులు, బీమా, అప్పులు మరియు వ్యక్తిగత పరిస్థితులు భిన్నంగా ఉండవచ్చు. Hisaab వ్యక్తిగత పెట్టుబడి లేదా పన్ను సలహా కాదు. ముఖ్య నిర్ణయాలకు అర్హత కలిగిన స్వతంత్ర నిపుణుడిని సంప్రదించండి.":"This report depends on your inputs and documented model assumptions. Actual market returns, taxes, fees, insurance, debt and personal circumstances can differ. Hisaab does not provide personalised investment or tax advice. Consult a qualified independent professional for material decisions.",fontSize:8});
  content.push({text:labels.generated+": "+new Date().toISOString(),fontSize:7,color:"#687780",margin:[0,14,0,0]});
  const fontBase=location.origin+"/fonts/";
  pdfMake.addFonts({HindGuntur:{normal:fontBase+"HindGuntur-Regular.ttf",bold:fontBase+"HindGuntur-Bold.ttf",italics:fontBase+"HindGuntur-Regular.ttf",bolditalics:fontBase+"HindGuntur-Bold.ttf"}});
  const doc={pageSize:"A4",pageMargins:[38,42,38,48],info:{title:labels.title,author:"Hisaab"},defaultStyle:{font:"HindGuntur",fontSize:9,lineHeight:1.25,color:"#1c2d36"},styles:{title:{fontSize:21,bold:true,color:"#174f40",margin:[0,0,0,4]},sub:{fontSize:10,color:"#687780",margin:[0,0,0,12]},section:{fontSize:13,bold:true,color:"#174f40",margin:[0,12,0,5]}},content,footer:(page:number,count:number)=>({text:"HISAAB  ·  "+page+" / "+count,alignment:"right",fontSize:7,color:"#687780",margin:[0,0,38,0]})};
  try{
    await pdfMake.createPdf(doc).download(te?"hisaab-nivadika.pdf":"hisaab-report.pdf");
  }catch(error){
    console.error(error);alert(te?"PDF రూపొందించలేకపోయాం. మళ్లీ ప్రయత్నించండి.":"Could not generate the PDF. Please retry.");
  }
});
const originalShow = show;
(show as any) = (result:Result) => { originalShow(result); lastResult=result; };
const originalSubmit = $("sim").onsubmit;
$("sim").addEventListener("submit",()=>{ const f=$("sim") as HTMLFormElement; const d=new FormData(f); const n=(k:string)=>Number(d.get(k)); lastInput={years:n("years"),trials:n("trials"),savings:n("savings"),income:n("income"),expense:n("expense"),sip:n("sip"),ret:n("ret"),vol:n("vol"),income_growth:n("income_growth"),medical_shock:n("medical_shock"),seed:n("seed"),shocks:d.has("shocks"),goals:readGoals(),events:readEvents()}; });
addEventRow({label:"Career change / salary increase",year:3,kind:"income_change",amount:15000});
translateStatic();



// ——— Production: official data, Mitra, Why This Number, complete i18n ———
const i18nExtra: Record<string, string> = {
  "05 / OFFICIAL CONTEXT": "05 / అధికారిక సందర్భం",
  "Reference links — not live data": "సూచన లింకులు — ప్రత్యక్ష డేటా కాదు",
  "Official links": "అధికారిక లింకులు",
  "No live rate feed is connected. Values are deliberately not shown as current; verify directly with the linked official source.":
    "ప్రత్యక్ష రేట్ల ఫీడ్ లేదు. ప్రస్తుత రేట్లుగా విలువలు చూపబడవు; అధికారిక మూలంలో నేరుగా నిర్ధారించండి.",
  "06 / HISAAB MITRA": "06 / హిసాబ్ మిత్ర",
  "Your bilingual financial guide": "మీ ద్విభాషా ఆర్థిక మార్గదర్శి",
  "Mitra explains Hisaab's illustrative calculations and links to official rules. It does not invent rates or give personalised investment advice.":
    "మిత్ర Hisaab ఉదాహరణాత్మక లెక్కలు మరియు అధికారిక నియమాల లింకులను వివరిస్తుంది. రేట్లు కల్పించదు; వ్యక్తిగతీకరించిన పెట్టుబడి సలహా ఇవ్వదు.",
  "Ask Mitra": "మిత్రను అడగండి",
  "07 / WHY THIS NUMBER?": "07 / ఈ సంఖ్య ఎందుకు?",
  "Transparent calculation breakdown": "పారదర్శక లెక్క వివరణ",
  "Run a simulation or tax estimate to see formulas, inputs, assumptions and sources here.":
    "ఫార్ములాలు, ఇన్‌పుట్‌లు, అంచనాలు, మూలాలు చూడటానికి సిమ్యులేషన్ లేదా పన్ను అంచనా అమలు చేయండి.",
  "Effective": "అమలు",
  "Verified": "ధృవీకరణ",
  "Source": "మూలం",
  "Household-finance scenario simulator · No account connection · No personal data stored":
    "కుటుంబ ఆర్థిక సన్నివేశ సిమ్యులేటర్ · ఖాతా అనుసంధానం లేదు · వ్యక్తిగత డేటా నిల్వ చేయబడదు",
};

Object.assign(translations, i18nExtra);

const mitraSuggestionsEn = [
  "Explain the latest income tax rules",
  "Old tax regime vs new tax regime",
  "What is an SIP?",
  "Why am I not reaching my goal?",
  "What is the RBI repo rate?",
];
const mitraSuggestionsTe = [
  "తాజా ఆదాయపు పన్ను నియమాలు వివరించండి",
  "పాత పాలన vs కొత్త పాలన",
  "SIP అంటే ఏమిటి?",
  "నా లక్ష్యం ఎందుకు చేరడం లేదు?",
  "RBI రెపో రేటు ఎంత?",
];

function renderMitraSuggestions(): void {
  const box = document.getElementById("mitraSuggestions");
  if (!box) return;
  box.innerHTML = "";
  const list = language === "te" ? mitraSuggestionsTe : mitraSuggestionsEn;
  list.forEach((text) => {
    const b = el("button", "chip", text);
    b.type = "button";
    b.addEventListener("click", () => {
      const input = document.getElementById("mitraInput") as HTMLInputElement;
      input.value = text;
      void askMitra(text);
    });
    box.append(b);
  });
}

function appendMitraBubble(role: "user" | "mitra", text: string, sources?: {name:string;url:string}[]): void {
  const chat = document.getElementById("mitraChat");
  if (!chat) return;
  const bubble = el("div", "mitra-bubble " + role);
  bubble.textContent = text;
  chat.append(bubble);
  if (sources && sources.length) {
    const src = el("div", "mitra-sources");
    src.textContent = (language === "te" ? "మూలాలు: " : "Sources: ") + sources.map(s => s.name).join(" · ");
    chat.append(src);
  }
  chat.scrollTop = chat.scrollHeight;
}

async function askMitra(question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;
  appendMitraBubble("user", q);
  try {
    const data = { reply: answerMitra(q, language, lastResult ? {score:lastResult.score,depletion_odds:lastResult.depletion_odds,goals:lastResult.goals,diagnostics:lastResult.diagnostics,nudge:lastResult.nudge??undefined} : undefined), sources: [], calculations: null };
    appendMitraBubble("mitra", data.reply, data.sources);
  } catch (e) {
    appendMitraBubble("mitra", language === "te"
      ? "క్షమించండి, ప్రస్తుతం సమాధానం ఇవ్వలేకపోయాను. మళ్లీ ప్రయత్నించండి."
      : "Sorry — I could not answer right now. Please try again.");
  }
}

function showWhy(payload: {
  title: string;
  formula: string;
  inputs: Record<string, unknown>;
  assumptions: string;
  sources: string[];
  breakdown?: unknown;
}): void {
  const body = document.getElementById("whyBody");
  if (!body) return;
  body.innerHTML = "";
  body.append(el("h3", "", payload.title));
  body.append(el("p", "", (language === "te" ? "ఫార్ములా: " : "Formula: ") + payload.formula));
  const pre = el("pre", "why-pre", JSON.stringify(payload.inputs, null, 2));
  body.append(pre);
  body.append(el("p", "", payload.assumptions));
  if (payload.sources.length) {
    body.append(el("p", "tiny-note", payload.sources.join(" · ")));
  }
  if (payload.breakdown) {
    body.append(el("pre", "why-pre", JSON.stringify(payload.breakdown, null, 2)));
  }
}

function loadOfficialData(): void {
  const box = document.getElementById("dataCards");
  if (!box) return;
  const items = [
    {title:"Income Tax Department",value:language==="te"?"పన్ను నియమాలు మరియు అధికారిక కాలిక్యులేటర్":"Tax rules and official calculator",source:"incometax.gov.in",url:"https://www.incometax.gov.in/"},
    {title:"Reserve Bank of India",value:language==="te"?"ద్రవ్య విధానం మరియు ఆర్థిక విద్య":"Monetary policy and financial education",source:"rbi.org.in",url:"https://www.rbi.org.in/"},
    {title:"Ministry of Statistics and Programme Implementation",value:language==="te"?"CPI మరియు అధికారిక గణాంకాలు":"CPI and official statistics",source:"mospi.gov.in",url:"https://www.mospi.gov.in/"},
    {title:"CBIC — GST",value:language==="te"?"GST రేట్లు మరియు వర్గీకరణ":"GST rates and classifications",source:"cbic-gst.gov.in",url:"https://cbic-gst.gov.in/"},
    {title:"SEBI Investor",value:language==="te"?"పెట్టుబడిదారుల విద్య మరియు రక్షణ":"Investor education and protection",source:"investor.sebi.gov.in",url:"https://investor.sebi.gov.in/"},
    {title:"India Post Savings",value:language==="te"?"చిన్న పొదుపు పథకాల తాజా రేట్లు":"Current small-savings scheme rates",source:"indiapost.gov.in",url:"https://www.indiapost.gov.in/"}
  ];
  box.replaceChildren();
  items.forEach(item => {
    const card=el("article","data-card"); card.append(el("h4","",item.title),el("div","data-value",item.value),el("p","tiny-note",(language==="te"?"అధికారిక మూలం: ":"Official source: ")+item.source));
    const link=el("a","",language==="te"?"మూలాన్ని తెరవండి":"Open source"); link.href=item.url; link.target="_blank"; link.rel="noopener noreferrer"; card.append(link); box.append(card);
  });
}

// Mitra form
const mitraForm = document.getElementById("mitraForm");
if (mitraForm) {
  mitraForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = document.getElementById("mitraInput") as HTMLInputElement;
    void askMitra(input.value);
    input.value = "";
  });
}

// Enhance language toggle to refresh dynamic panels
const prevLangClick = ($("langToggle") as HTMLButtonElement).onclick;
$("langToggle").addEventListener("click", () => {
  renderMitraSuggestions();
  loadOfficialData();
  // re-apply static translations for new keys
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n") || "";
    // handled via text content mapping in translateStatic for known strings
  });
});

// After simulation, populate Why This Number for score
const prevShowRef = show;
(show as any) = (result: Result) => {
  (prevShowRef as any)(result);
  lastResult = result;
  showWhy({
    title: language === "te" ? "అన్ని లక్ష్యాల విజయ సంభావ్యత" : "All-goals success probability",
    formula: "success_trials / total_trials (monthly cash-flow Monte Carlo)",
    inputs: lastInput || {},
    assumptions: language === "te"
      ? "నెలవారీ రాబడి లాగ్‌నార్మల్; వర్గాల వారీ ద్రవ్యోల్బణం; SIP మిగులుకు పరిమితం."
      : "Lognormal monthly returns; category inflation; SIP capped by surplus.",
    sources: ["Hisaab financial engine", "docs/MODEL.md"],
    breakdown: {
      score: result.score,
      depletion_odds: result.depletion_odds,
      trials: result.trials,
      seed: result.seed,
      goals: result.goals,
    },
  });
};

renderMitraSuggestions();
void loadOfficialData();


// Shareable reproducible scenarios and editable illustrative quick-start examples.
(function () {
  const form = document.getElementById("sim") as HTMLFormElement | null;
  const getField = (name: string): HTMLInputElement | HTMLSelectElement | null => {
    const item = form?.elements.namedItem(name);
    return item instanceof HTMLInputElement || item instanceof HTMLSelectElement ? item : null;
  };
  const personas: Record<string, any> = {
    grad: {years:20,savings:100000,income:55000,expense:28000,sip:12000,ret:10,vol:18,income_growth:8,medical_shock:250000,goals:[{name:"Higher education",at:6,cost:800000,kind:"education",flex:true}]},
    family: {years:20,savings:1200000,income:160000,expense:85000,sip:40000,ret:10,vol:16,income_growth:8,medical_shock:600000,goals:[{name:"Child education",at:12,cost:3000000,kind:"education",flex:false},{name:"Home upgrade",at:8,cost:1800000,kind:"home",flex:true}]},
    single: {years:18,savings:700000,income:90000,expense:65000,sip:18000,ret:9,vol:20,income_growth:6,medical_shock:800000,goals:[{name:"Family safety reserve",at:5,cost:1200000,kind:"medical",flex:false},{name:"Retirement bridge",at:18,cost:4500000,kind:"general",flex:false}]}
  };
  const applyState = (state: any): void => {
    if(!form || !state || typeof state!=="object") return;
    ["years","savings","income","expense","sip","ret","vol","income_growth","medical_shock","seed"].forEach(k=>{
      const input=getField(k); if(state[k]!==undefined && input) input.value=String(state[k]);
    });
    const shocks=getField("shocks"); if(shocks instanceof HTMLInputElement && state.shocks!==undefined) shocks.checked=!!state.shocks;
    if(Array.isArray(state.goals) && state.goals.length){$("goals").replaceChildren();state.goals.slice(0,12).forEach((g:Goal)=>goalRow(g));}
    if(Array.isArray(state.events)){$("events").replaceChildren();state.events.slice(0,20).forEach((e:LifeEvent)=>addEventRow(e));}
  };
  document.querySelectorAll<HTMLButtonElement>("[data-persona]").forEach(button=>{
    button.addEventListener("click",()=>{
      const sample=personas[button.dataset.persona||""]; if(!sample) return;
      applyState({...sample,seed:20261112,shocks:true,events:[]});
      form?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
  const share=document.getElementById("shareScenario");
  if(share) share.addEventListener("click",async()=>{
    if(!lastInput){alert("Run a simulation before sharing.");return;}
    const payload={...lastInput,seed:lastInput.seed??Number(getField("seed")?.value),shocks:lastInput.shocks??(getField("shocks") as HTMLInputElement|null)?.checked};
    const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const url=location.origin+location.pathname+"#s="+encoded; history.replaceState(null,"",url);
    try{await navigator.clipboard.writeText(url);share.textContent="Link copied";}
    catch{share.textContent="Link ready in address bar";}
  });
  if(location.hash.startsWith("#s=")){
    try{
      let encoded=location.hash.slice(3).replace(/-/g,"+").replace(/_/g,"/");
      encoded+="=".repeat((4-encoded.length%4)%4);
      applyState(JSON.parse(decodeURIComponent(escape(atob(encoded)))));
      form?.requestSubmit();
    }catch{/* Ignore malformed or manually edited share links. */}
  }
})();
