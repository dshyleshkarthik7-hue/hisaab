"use strict";
const $ = (id) => document.getElementById(id);
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const compact = (n) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const kinds = ["general", "education", "medical", "home"];
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function field(labelText, key, value, type = "text", min) {
    const label = el("label");
    label.append(document.createTextNode(labelText));
    const input = el("input");
    input.dataset.f = key;
    input.type = type;
    input.value = String(value);
    if (min !== undefined)
        input.min = String(min);
    label.append(input);
    return label;
}
function goalRow(g) {
    const row = el("div", "goal-row");
    row.append(field("Goal name", "name", g.name));
    row.append(field("Target year", "at", g.at, "number", 1));
    row.append(field("Cost today (₹)", "cost", g.cost, "number", 1));
    const kindLabel = el("label");
    kindLabel.append(document.createTextNode("Inflation category"));
    const select = el("select");
    select.dataset.f = "kind";
    for (const k of kinds) {
        const option = el("option", "", k[0].toUpperCase() + k.slice(1));
        option.value = k;
        option.selected = k === g.kind;
        select.append(option);
    }
    kindLabel.append(select);
    row.append(kindLabel);
    const flexLabel = el("label", "goal-flex");
    const flex = el("input");
    flex.type = "checkbox";
    flex.dataset.f = "flex";
    flex.checked = g.flex;
    flexLabel.append(flex, document.createTextNode(" Flexible timing"));
    row.append(flexLabel);
    const remove = el("button", "remove-goal", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${g.name}`);
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    $("goals").append(row);
}
function readGoals() {
    return Array.from(document.querySelectorAll(".goal-row")).map(row => {
        const get = (key) => row.querySelector(`[data-f="${key}"]`);
        return { name: get("name").value.trim(), at: Number(get("at").value), cost: Number(get("cost").value), kind: get("kind").value, flex: get("flex").checked };
    });
}
function drawFan(fan, samplePaths = []) {
    const canvas = $("fan"), ctx = canvas.getContext("2d");
    if (!ctx || fan.length < 2)
        return;
    const W = canvas.width, H = canvas.height, left = 82, right = 18, topPad = 20, bottom = 42;
    const max = Math.max(1, ...fan.map(v => v.p90)) * 1.08, n = fan.length - 1;
    const px = (i) => left + i / n * (W - left - right), py = (v) => H - bottom - v / max * (H - topPad - bottom);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "14px system-ui";
    ctx.fillStyle = css("--muted");
    ctx.strokeStyle = css("--line");
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
        const v = max * k / 4;
        ctx.beginPath();
        ctx.moveTo(left, py(v));
        ctx.lineTo(W - right, py(v));
        ctx.stroke();
        ctx.fillText(compact(v), 6, py(v) + 5);
    }
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i <= n; i += step)
        ctx.fillText(`Y${i}`, px(i) - 10, H - 12);
    ctx.beginPath();
    fan.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](px(i), py(v.p90)));
    for (let i = n; i >= 0; i--)
        ctx.lineTo(px(i), py(fan[i].p10));
    ctx.closePath();
    ctx.fillStyle = css("--chart-band");
    ctx.fill();
    // Sampled household trajectories are drawn beneath the median.
    for (const path of samplePaths) {
        if (!Array.isArray(path.values)) continue;
        ctx.beginPath();
        path.values.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](px(i), py(v)));
        ctx.strokeStyle = path.ok ? "rgba(40, 150, 112, 0.28)" : "rgba(217, 104, 82, 0.34)";
        ctx.lineWidth = path.label === "worst_surviving" ? 2 : 1.15;
        ctx.stroke();
    }
    ctx.beginPath();
    fan.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](px(i), py(v.p50)));
    ctx.strokeStyle = css("--chart-line");
    ctx.lineWidth = 3;
    ctx.stroke();
}
function show(r) {
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
    const diagnostic = r.diagnostics || {};
    const weakest = diagnostic.weakest_goal;
    const diagNode = $("diagnostics");
    if (diagNode) diagNode.textContent = weakest ? `Most fragile goal: ${weakest.name} (${Math.round(weakest.odds * 100)}% funded) · Failed lives that also experienced a shock: ${Math.round((diagnostic.failed_lives_with_shock_share || 0) * 100)}%` : "";
    const shockedPath = (r.sample_paths || []).find(path => path.shock_events && path.shock_events.length);
    const chartNote = $("chartNote");
    if (chartNote) chartNote.textContent = `25 sampled household paths · Green: all goals funded · Coral: at least one goal missed${shockedPath ? " · Example shock: " + shockedPath.shock_events.map(event => event.kind + " at month " + event.month).join(", ") : ""}`;
    const odds = $("odds");
    odds.replaceChildren();
    for (const g of r.goals) {
        const row = el("div", "odds-row"), title = el("div", "odds-title");
        title.append(el("strong", "", g.name), el("span", "", `Year ${g.at}`));
        const track = el("div", "odds-track"), fill = el("progress", "odds-progress");
        fill.max = 100;
        fill.value = Math.round(g.odds * 100);
        fill.setAttribute("aria-label", `${g.name}: ${Math.round(g.odds * 100)} percent chance`);
        fill.dataset.level = g.odds >= .75 ? "good" : g.odds >= .45 ? "mid" : "low";
        track.append(fill);
        row.append(title, track, el("strong", "odds-value", `${Math.round(g.odds * 100)}%`));
        odds.append(row);
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
                const meta = el("p", "compare-meta", (language === "te" ? "మధ్యస్థ నిధి " : "Median corpus ") + inr(s.ending_median)
                    + " · " + (language === "te" ? "ఖాళీ " : "Depletion ") + Math.round(s.depletion_odds * 100) + "%");
                art.append(title, score, meta);
                compare.append(art);
            });
        }
    }
    else {
        const best = n && (n.best || (n.text ? { text: n.text, score: n.score } : null));
        card.hidden = !best;
        if (best) {
            $("nudgeTitle").textContent = best.text || "";
            $("nudgeText").textContent = `The tested scenario raised the all-goals success rate to ${Math.round((best.score || 0) * 100)}%.`;
        }
        if (compare)
            compare.innerHTML = "";
    }
}
$("sim").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = $("sim"), data = new FormData(form), num = (key) => Number(data.get(key));
    const goals = readGoals(), years = num("years");
    const error = $("err"), button = $("run");
    const invalid = goals.length < 1 || goals.length > 12 || goals.some(g => !g.name || !Number.isInteger(g.at) || g.at < 1 || g.at > years || !Number.isFinite(g.cost) || g.cost <= 0);
    if (invalid) {
        error.textContent = "Add 1–12 valid goals. Each needs a name, positive cost and target year within your simulation.";
        error.hidden = false;
        return;
    }
    const body = { years, savings: num("savings"), income: num("income"), sip: num("sip"), expense: num("expense"), ret: num("ret"), vol: num("vol"), income_growth: num("income_growth"), medical_shock: num("medical_shock"), seed: num("seed"), shocks: data.has("shocks"), goals, events: readEvents() };
    button.disabled = true;
    button.textContent = "Simulating possible lives…";
    error.hidden = true;
    try {
        const response = await fetch("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || "Simulation request failed");
        show(payload);
        $("out").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    catch (e) {
        error.textContent = `Could not run the simulation: ${e.message}`;
        error.hidden = false;
    }
    finally {
        button.disabled = false;
        button.replaceChildren(document.createTextNode("Run the futures "), el("span", "", "↗"));
    }
});
$("add").addEventListener("click", () => {
    const years = Number($('sim').elements.namedItem("years") instanceof HTMLInputElement ? $('sim').elements.namedItem("years").value : 10);
    goalRow({ name: "New goal", at: Math.min(10, Math.max(1, years)), cost: 500000, kind: "general", flex: true });
});
goalRow({ name: "Child's education", at: 15, cost: 2500000, kind: "education", flex: false });
goalRow({ name: "Home down payment", at: 8, cost: 2000000, kind: "home", flex: true });
goalRow({ name: "Parents' medical fund", at: 10, cost: 1000000, kind: "medical", flex: false });
async function updateQuickMath() {
    const value = (id) => Number(($(id)).value);
    try {
        const [emiResponse, taxResponse] = await Promise.all([
            fetch(`/api/emi?loan=${value("loan")}&rate=${value("rate")}&years=${value("ly")}`),
            fetch(`/api/tax?ctc=${value("ctc")}&basic=${value("basic")}&pt=${value("pt")}`)
        ]);
        const [emi, tax] = await Promise.all([emiResponse.json(), taxResponse.json()]);
        if (!emiResponse.ok || !taxResponse.ok)
            throw new Error("Check the values entered.");
        $("emiOut").textContent = `Monthly EMI ${inr(emi.emi)} · Total interest ${inr(emi.interest)}`;
        $("taxOut").textContent = `Estimated monthly take-home ${inr(tax.inhand / 12)} · Estimated annual tax ${inr(tax.tax)}`;
    }
    catch (e) {
        $("emiOut").textContent = e.message;
        $("taxOut").textContent = "Salary estimate unavailable.";
    }
}
["loan", "rate", "ly", "ctc", "basic", "pt"].forEach(id => $(id).addEventListener("input", updateQuickMath));
updateQuickMath();
let lastInput = null;
let lastResult = null;
let language = "en";
const translations = {
    "PLAN FOR UNCERTAINTY, NOT JUST AVERAGES": "సగటులనే కాదు, అనిశ్చితినీ దృష్టిలో పెట్టుకుని ప్రణాళిక చేయండి",
    "Your future isn't": "మీ భవిష్యత్తు",
    "one number.": "ఒకే సంఖ్య కాదు.",
    "Run thousands of plausible financial lives. See which goals survive inflation, market swings, income gaps and unexpected costs — then test what could improve the odds.": "వేల సాధ్యమైన ఆర్థిక భవిష్యత్తులను పరిశీలించండి. ద్రవ్యోల్బణం, మార్కెట్ మార్పులు, ఆదాయ అంతరాలు, అనుకోని ఖర్చుల మధ్య మీ లక్ష్యాలు ఎంతవరకు సాధ్యమో తెలుసుకోండి.",
    "Household-finance scenario simulator · No account connection · No personal data stored": "కుటుంబ ఆర్థిక సన్నివేశ సిమ్యులేటర్ · ఖాతా అనుసంధానం లేదు · వ్యక్తిగత డేటా నిల్వ చేయబడదు",
    "01 / YOUR BASELINE": "01 / మీ ప్రస్తుత ఆర్థిక స్థితి",
    "Start with today": "ఈరోజు స్థితితో ప్రారంభించండి",
    "About 2 minutes": "సుమారు 2 నిమిషాలు",
    "Years to explore": "పరిశీలించాల్సిన సంవత్సరాలు",
    "Current savings": "ప్రస్తుత పొదుపు",
    "Monthly take-home income": "నెలవారీ చేతికి వచ్చే ఆదాయం",
    "Monthly household expenses": "నెలవారీ కుటుంబ ఖర్చులు",
    "Planned monthly SIP": "ప్రణాళిక చేసిన నెలవారీ SIP",
    "Expected annual return": "అంచనా వార్షిక రాబడి",
    "Annual return volatility": "వార్షిక రాబడి హెచ్చుతగ్గులు",
    "Annual income growth": "వార్షిక ఆదాయ వృద్ధి",
    "Unexpected medical cost today": "ప్రస్తుత అనుకోని వైద్య ఖర్చు",
    "Scenario seed": "సన్నివేశ సీడ్",
    "How far into the future?": "భవిష్యత్తులో ఎంత దూరం?",
    "Investable corpus today": "ఈరోజు పెట్టుబడికి అందుబాటులో ఉన్న మొత్తం",
    "Income available after tax": "పన్నుల తర్వాత అందుబాటులో ఉన్న ఆదాయం",
    "Living costs, before goal spending": "లక్ష్య ఖర్చులకు ముందు జీవన వ్యయాలు",
    "Investment target; capped by monthly surplus": "పెట్టుబడి లక్ష్యం; నెలవారీ మిగులుకు పరిమితం",
    "Nominal average assumption": "నామమాత్ర సగటు అంచనా",
    "How widely returns may vary": "రాబడులు ఎంత మారవచ్చో",
    "Also grows the planned SIP": "ప్రణాళిక SIP కూడా పెరుగుతుంది",
    "One-off event amount, if enabled": "ఎంచుకుంటే ఒకసారి జరిగే ఖర్చు",
    "Reuse a seed to compare like-for-like": "సమాన పరిస్థితులను పోల్చడానికి అదే సీడ్ వాడండి",
    "Include life disruptions": "జీవితంలోని అనుకోని మార్పులను చేర్చండి",
    "Model job gaps and medical emergencies": "ఉద్యోగ విరామాలు, వైద్య అత్యవసర పరిస్థితులను నమూనా చేయండి",
    "02 / WHAT MATTERS TO YOU": "02 / మీకు ముఖ్యమైన లక్ష్యాలు",
    "Your life goals": "మీ జీవిత లక్ష్యాలు",
    "＋ Add a goal": "＋ లక్ష్యాన్ని జోడించండి",
    "Enter each goal in today's rupees. Hisaab inflates its cost to the year you need it.": "ప్రతి లక్ష్యాన్ని నేటి రూపాయల్లో నమోదు చేయండి. అవసరమైన సంవత్సరానికి అనుగుణంగా హిసాబ్ ఖర్చును పెంచి లెక్కిస్తుంది.",
    "Run the futures": "భవిష్యత్తులను పరిశీలించండి",
    "03 / THE MANY-LIVES RESULT": "03 / అనేక భవిష్యత్తుల ఫలితం",
    "Your probability landscape": "మీ లక్ష్యాల సాధ్యత",
    "ALL GOALS FUNDED": "అన్ని లక్ష్యాలకు నిధులు",
    "ENDING WEALTH · TODAY'S RUPEE VALUE": "చివరి సంపద · నేటి రూపాయి విలువ",
    "Median ending corpus": "మధ్యస్థ చివరి నిధి",
    "CORPUS DEPLETION": "నిధి పూర్తిగా ఖಾಲీ అయ్యే అవకాశం",
    "How the corpus could evolve": "మీ నిధి ఎలా వృద్ధి చెందవచ్చు",
    "Goal survival map": "లక్ష్యాల సాధ్యత మ్యాప్",
    "04 / QUICK CHECKS": "04 / త్వరిత లెక్కలు",
    "Everyday money maths": "రోజువారీ ఆర్థిక లెక్కలు",
    "Loan EMI": "రుణ EMI",
    "Take-home salary": "చేతికి వచ్చే జీతం",
    "BORROWING": "రుణం",
    "SALARY ESTIMATE": "జీతం అంచనా",
    "Household-finance scenario simulator · Not personalised investment advice": "ప్రొడక్షన్ ఆర్థిక డిజిటల్ ట్విన్ · వ్యక్తిగతీకరించిన పెట్టుబడి సలహా కాదు"
};
const tr = (value) => language === "te" ? (translations[value] || value) : value;
function translateStatic() {
    document.documentElement.lang = language;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode())
        nodes.push(walker.currentNode);
    for (const node of nodes) {
        const raw = node.textContent || "", key = raw.trim();
        if (!key)
            continue;
        if (language === "en" && node.__english)
            node.textContent = node.__english;
        else if (language === "te") {
            const translated = tr(key);
            if (translated !== key) {
                node.__english = raw;
                node.textContent = raw.replace(key, translated);
            }
        }
    }
    const toggle = $("langToggle");
    toggle.textContent = language === "en" ? "తెలుగు" : "English";
    document.title = language === "te" ? "హిసాబ్ — మీ ఆర్థిక భవిష్యత్తు" : "Hisaab — Your future, in many possible lives";
}
function readEvents() {
    return Array.from(document.querySelectorAll(".event-row")).map(row => ({
        label: (row.querySelector('[data-ev="label"]')?.value || "Life event").trim(),
        year: Number(row.querySelector('[data-ev="year"]')?.value),
        kind: (row.querySelector('[data-ev="kind"]')?.value || "one_time_cost"),
        amount: Number(row.querySelector('[data-ev="amount"]')?.value)
    }));
}
function addEventRow(event = { label: "Career change", year: 3, kind: "income_change", amount: 15000 }) {
    const row = el("div", "event-row");
    const mk = (label, key, value, type = "text") => {
        const wrap = el("label", "", tr(label));
        const input = el("input");
        input.dataset.ev = key;
        input.type = type;
        input.value = String(value);
        if (type === "number") {
            input.min = key === "year" ? "1" : "1";
            input.step = "1";
        }
        wrap.append(input);
        return wrap;
    };
    row.append(mk("Event name", "label", event.label), mk("Year", "year", event.year, "number"));
    const kindLabel = el("label", "", tr("Event type")), select = el("select");
    select.dataset.ev = "kind";
    const choices = [["income_change", "Recurring monthly income increase"], ["expense_change", "Recurring monthly expense increase"], ["one_time_cost", "One-time expense"]];
    choices.forEach(([v, label]) => { const o = el("option"); o.value = v; o.textContent = tr(label); o.selected = v === event.kind; select.append(o); });
    kindLabel.append(select);
    row.append(kindLabel, mk("Amount (₹ / month, or one-time)", "amount", event.amount, "number"));
    const remove = el("button", "remove-goal", language === "te" ? "తొలగించు" : "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    $("events").append(row);
}
function reportHtml() {
    if (!lastInput || !lastResult)
        return "";
    const input = lastInput;
    const result = lastResult;
    const fmt = (n) => "₹" + Math.round(n).toLocaleString(language === "te" ? "te-IN" : "en-IN");
    const pct = (n) => (n * 100).toFixed(1) + "%";
    const labels = language === "te" ? {
        title: "హిసాబ్ ఆర్థిక భవిష్యత్ నివేదిక", sub: "వ్యక్తిగత ఆర్థిక సన్నివేశ విశ్లేషణ",
        summary: "సారాంశం", score: "అన్ని లక్ష్యాలు నెరవేరిన సన్నివేశాలు", corpus: "చివరి నిధి (మధ్యస్థం)",
        depletion: "నిధి ఖాళీ అయ్యే సన్నివేశాలు", inputs: "మీరు అందించిన వివరాలు", years: "పరిశీలన కాలం",
        savings: "ప్రస్తుత పొదుపు", income: "నెలవారీ ఆదాయం", expense: "నెలవారీ ఖర్చులు", sip: "నెలవారీ SIP",
        ret: "అంచనా వార్షిక రాబడి", vol: "వార్షిక రాబడి మార్పు", goals: "జీవిత లక్ష్యాలు",
        events: "జీవిత సంఘటనలు", year: "సంవత్సరం", cost: "నేటి ఖర్చు", odds: "లక్ష్య సాధ్యత",
        assumptions: "నమూనా అంచనాలు", disclaimer: "ముఖ్య గమనిక",
        note: "ఈ నివేదిక Hisaab ప్రొడక్షన్ ఆర్థిక డిజిటల్ ట్విన్ ద్వారా రూపొందించబడింది. ఫలితాలు మీరు ఇచ్చిన వివరాలు మరియు ఉత్పత్తిలో డాక్యుమెంట్ చేయబడిన నమూనా అంచనాలపై ఆధారపడతాయి. వాస్తవ మార్కెట్ రాబడులు, పన్నులు, ఫీజులు, బీమా, అప్పులు, ఆస్తుల కేటాయింపు, వ్యక్తిగత పరిస్థితులు భిన్నంగా ఉండవచ్చు. Hisaab వ్యక్తిగతీకరించిన పెట్టుబడి సలహా ఇవ్వదు. ముఖ్య నిర్ణయాలకు అర్హత కలిగిన స్వతంత్ర ఆర్థిక నిపుణుడిని సంప్రదించండి.",
        generated: "రూపొందించిన తేదీ"
    } : {
        title: "Hisaab Financial Future Report", sub: "Personal financial scenario analysis",
        summary: "Executive summary", score: "Scenarios funding every goal", corpus: "Ending corpus (median)",
        depletion: "Scenarios with depleted corpus", inputs: "Your inputs", years: "Projection horizon",
        savings: "Current savings", income: "Monthly take-home income", expense: "Monthly household expenses", sip: "Planned monthly SIP",
        ret: "Expected annual return", vol: "Annual return volatility", goals: "Life goals",
        events: "Life events", year: "Year", cost: "Cost in today's rupees", odds: "Goal success odds",
        assumptions: "Model assumptions", disclaimer: "Important disclaimer",
        note: "This report is generated by the Hisaab production financial digital twin. Results depend on the inputs you provide and the model assumptions documented in the product. Actual market returns, taxes, fees, insurance, debt, asset allocation and personal circumstances can differ. Hisaab does not provide personalised investment advice. For material decisions, consult a qualified independent financial professional.",
        generated: "Generated"
    };
    const rows = Object.entries({ [labels.years]: input.years + " years", [labels.savings]: fmt(input.savings), [labels.income]: fmt(input.income), [labels.expense]: fmt(input.expense), [labels.sip]: fmt(input.sip), [labels.ret]: input.ret + "%", [labels.vol]: input.vol + "%" }).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
    const goals = input.goals.map((g, i) => `<tr><td>${escapeHtml(g.name)}</td><td>${result.goals[i]?.at ?? g.at}</td><td>${fmt(g.cost)}</td><td>${pct(result.goals[i]?.odds ?? 0)}</td></tr>`).join("");
    const events = (input.events || []).map((e) => `<tr><td>${escapeHtml(e.label)}</td><td>${e.year}</td><td>${e.kind === "income_change" ? (language === "te" ? "ఆదాయం పెరుగుదల" : "Income increase") : e.kind === "expense_change" ? (language === "te" ? "ఖర్చు పెరుగుదల" : "Expense increase") : (language === "te" ? "ఒకసారి ఖర్చు" : "One-time cost")}</td><td>${fmt(e.amount)}</td></tr>`).join("");
    const fan = result.fan.map((v, i) => `<tr><td>${i}</td><td>${fmt(v.p10)}</td><td>${fmt(v.p50)}</td><td>${fmt(v.p90)}</td></tr>`).join("");
    return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${labels.title}</title><style>
  @page{size:A4;margin:16mm}body{font:12px/1.55 "Noto Sans Telugu","Nirmala UI",Arial,sans-serif;color:#1c2d36}h1{font-size:26px;color:#174f40;margin:0}h2{font-size:17px;color:#174f40;margin:24px 0 8px;border-bottom:1px solid #d8e0dc;padding-bottom:6px}.sub{color:#687780;margin:3px 0 20px}.hero{background:#f0f4ef;padding:18px;border-radius:10px}.stats{display:flex;gap:12px;margin-top:12px}.stat{flex:1;background:white;border:1px solid #dfe5df;padding:12px;border-radius:8px}.stat b{display:block;font-size:21px;color:#174f40}table{width:100%;border-collapse:collapse;margin:8px 0 16px}td,th{text-align:left;padding:7px;border-bottom:1px solid #e4e9e5}th{width:45%;color:#52636b}thead th{background:#f1f4f0;color:#174f40}.small{font-size:10px;color:#66757c}.pagebreak{break-before:page}footer{margin-top:30px;padding-top:8px;border-top:1px solid #ddd;font-size:9px;color:#69777b}@media print{button{display:none}}</style></head><body>
  <div class="hero"><h1>${labels.title}</h1><p class="sub">${labels.sub}</p><div class="stats"><div class="stat"><span>${labels.score}</span><b>${pct(result.score)}</b></div><div class="stat"><span>${labels.corpus}</span><b>${fmt(result.ending.p50)}</b></div><div class="stat"><span>${labels.depletion}</span><b>${pct(result.depletion_odds)}</b></div></div></div>
  <h2>${labels.inputs}</h2><table>${rows}</table>
  <h2>${labels.goals}</h2><table><thead><tr><th>${language === "te" ? "లక్ష్యం" : "Goal"}</th><th>${labels.year}</th><th>${labels.cost}</th><th>${labels.odds}</th></tr></thead><tbody>${goals}</tbody></table>
  ${events ? `<h2>${labels.events}</h2><table><thead><tr><th>${language === "te" ? "పేరు" : "Name"}</th><th>${labels.year}</th><th>${language === "te" ? "రకం" : "Type"}</th><th>${language === "te" ? "మొత్తం" : "Amount"}</th></tr></thead><tbody>${events}</tbody></table>` : ""}
  <h2>${labels.assumptions}</h2><p>${language === "te" ? "నెలవారీ నగదు ప్రవాహం, లక్ష్యాల వర్గాల వారీ ద్రవ్యోల్బణం, లాగ్‌నార్మల్ నెలవారీ రాబడి నమూనా, ఉద్యోగ విరామం మరియు వైద్య అత్యవసర సంఘటనల సంభావ్యతలను ఉపయోగిస్తుంది. ఫలితాలు మీరు ఎంచుకున్న సీడ్ మరియు సిమ్యులేషన్ ట్రయల్స్‌పై ఆధారపడతాయి." : "Monthly cash-flow simulation, category-specific goal inflation, lognormal monthly return approximation, and configurable job-loss and medical-event assumptions. Results depend on the selected random seed and simulation trials."}</p>
  <h2>${language === "te" ? "వార్షిక నిధి పరిధి" : "Annual corpus range"}</h2><table><thead><tr><th>${labels.year}</th><th>10th percentile</th><th>Median</th><th>90th percentile</th></tr></thead><tbody>${fan}</tbody></table>
  <h2>${labels.disclaimer}</h2><p>${labels.note}</p><footer>${labels.generated}: ${new Date().toLocaleString(language === "te" ? "te-IN" : "en-IN")} · HISAAB · Household-finance scenario simulator</footer>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);</script></body></html>`;
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
$("addEvent").addEventListener("click", () => addEventRow({ label: language === "te" ? "కొత్త సంఘటన" : "New life event", year: 3, kind: "income_change", amount: 15000 }));
$("langToggle").addEventListener("click", () => { language = language === "en" ? "te" : "en"; translateStatic(); });
$("pdfReport").addEventListener("click", () => {
    if (!lastInput || !lastResult) {
        alert(language === "te" ? "ముందుగా సిమ్యులేషన్‌ను అమలు చేయండి." : "Run a simulation before creating your report.");
        return;
    }
    const w = window.open("", "_blank");
    if (!w) {
        alert(language === "te" ? "పాప్-అప్‌ను అనుమతించి మళ్లీ ప్రయత్నించండి." : "Allow the report pop-up and try again.");
        return;
    }
    w.document.open();
    w.document.write(reportHtml());
    w.document.close();
});
const originalShow = show;
show = (result) => { originalShow(result); lastResult = result; };
const originalSubmit = $("sim").onsubmit;
$("sim").addEventListener("submit", () => { const f = $("sim"); const d = new FormData(f); const n = (k) => Number(d.get(k)); lastInput = { years: n("years"), savings: n("savings"), income: n("income"), expense: n("expense"), sip: n("sip"), ret: n("ret"), vol: n("vol"), income_growth: n("income_growth"), medical_shock: n("medical_shock"), seed: n("seed"), shocks: d.has("shocks"), goals: readGoals(), events: readEvents() }; });
addEventRow({ label: "Career change / salary increase", year: 3, kind: "income_change", amount: 15000 });
translateStatic();

/* Production modules: official data, Mitra, Why This Number */
const i18nExtra = {
  "05 / OFFICIAL CONTEXT": "05 / అధికారిక సందర్భం",
  "Verified financial context": "ధృవీకరించిన ఆర్థిక సందర్భం",
  "Source-dated": "మూలం + తేదీ",
  "Snapshots show source, effective date and last verified date. Confirm on official sites before decisions.": "స్నాప్‌షాట్‌లు మూలం, అమలు తేదీ, ధృవీకరణ తేదీని చూపుతాయి. నిర్ణయాలకు ముందు అధికారిక సైట్‌లలో నిర్ధారించండి.",
  "06 / HISAAB MITRA": "06 / హిసాబ్ మిత్ర",
  "Your bilingual financial guide": "మీ ద్విభాషా ఆర్థిక మార్గదర్శి",
  "Mitra explains verified tax rules and your Hisaab calculations. It does not invent rates or give personalised investment advice.": "మిత్ర ధృవీకరించిన పన్ను నియమాలు మరియు Hisaab లెక్కలను వివరిస్తుంది. రేట్లు కల్పించదు; వ్యక్తిగతీకరించిన పెట్టుబడి సలహా ఇవ్వదు.",
  "Ask Mitra": "మిత్రను అడగండి",
  "07 / WHY THIS NUMBER?": "07 / ఈ సంఖ్య ఎందుకు?",
  "Transparent calculation breakdown": "పారదర్శక లెక్క వివరణ",
  "Run a simulation or tax estimate to see formulas, inputs, assumptions and sources here.": "ఫార్ములాలు, ఇన్‌పుట్‌లు, అంచనాలు, మూలాలు చూడటానికి సిమ్యులేషన్ లేదా పన్ను అంచనా అమలు చేయండి.",
  "Household-finance scenario simulator · No account connection · No personal data stored": "ప్రొడక్షన్ ఆర్థిక డిజిటల్ ట్విన్ · ఖాతా అనుసంధానం లేదు · వ్యక్తిగత డేటా నిల్వ చేయబడదు"
};
if (typeof translations !== "undefined") Object.assign(translations, i18nExtra);

const mitraSuggestionsEn = ["Explain the latest income tax rules","Old tax regime vs new tax regime","What is an SIP?","Why am I not reaching my goal?","What is the RBI repo rate?"];
const mitraSuggestionsTe = ["తాజా ఆదాయపు పన్ను నియమాలు వివరించండి","పాత పాలన vs కొత్త పాలన","SIP అంటే ఏమిటి?","నా లక్ష్యం ఎందుకు చేరడం లేదు?","RBI రెపో రేటు ఎంత?"];

function renderMitraSuggestions() {
  const box = document.getElementById("mitraSuggestions");
  if (!box) return;
  box.innerHTML = "";
  (language === "te" ? mitraSuggestionsTe : mitraSuggestionsEn).forEach((text) => {
    const b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = text;
    b.addEventListener("click", () => {
      const input = document.getElementById("mitraInput");
      if (input) input.value = text;
      askMitra(text);
    });
    box.append(b);
  });
}

function appendMitraBubble(role, text, sources) {
  const chat = document.getElementById("mitraChat");
  if (!chat) return;
  const bubble = document.createElement("div");
  bubble.className = "mitra-bubble " + role;
  bubble.textContent = text;
  chat.append(bubble);
  if (sources && sources.length) {
    const src = document.createElement("div");
    src.className = "mitra-sources";
    src.textContent = (language === "te" ? "మూలాలు: " : "Sources: ") + sources.map(s => s.name).join(" · ");
    chat.append(src);
  }
  chat.scrollTop = chat.scrollHeight;
}

async function askMitra(question) {
  const q = (question || "").trim();
  if (!q) return;
  appendMitraBubble("user", q);
  try {
    const ctx = {};
    if (typeof lastResult !== "undefined" && lastResult) {
      ctx.inputs = lastInput;
      ctx.simulation = { score: lastResult.score, depletion_odds: lastResult.depletion_odds, diagnostics: lastResult.diagnostics, shock_counterfactuals: lastResult.nudge && lastResult.nudge.shock_counterfactuals, target_sip: lastResult.nudge && lastResult.nudge.target_sip };
    }
    const res = await fetch("/api/mitra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, context: ctx })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Mitra unavailable");
    appendMitraBubble("mitra", data.reply, data.sources);
    if (data.calculations) showWhyPanel({
      title: language === "te" ? "మిత్ర లెక్క / నియమాలు" : "Mitra calculation / rules",
      formula: "Hisaab Tax Intelligence + verified rule packs",
      inputs: { question: q },
      assumptions: data.disclaimer || "",
      sources: (data.sources || []).map(s => s.name + " — " + s.url),
      breakdown: data.calculations
    });
  } catch (e) {
    appendMitraBubble("mitra", language === "te"
      ? "క్షమించండి, ప్రస్తుతం సమాధానం ఇవ్వలేకపోయాను."
      : "Sorry — I could not answer right now.");
  }
}

function showWhyPanel(payload) {
  const body = document.getElementById("whyBody");
  if (!body) return;
  body.innerHTML = "";
  const h = document.createElement("h3"); h.textContent = payload.title; body.append(h);
  const f = document.createElement("p"); f.textContent = (language === "te" ? "ఫార్ములా: " : "Formula: ") + payload.formula; body.append(f);
  const pre = document.createElement("pre"); pre.className = "why-pre"; pre.textContent = JSON.stringify(payload.inputs, null, 2); body.append(pre);
  const a = document.createElement("p"); a.textContent = payload.assumptions || ""; body.append(a);
  if (payload.sources && payload.sources.length) {
    const s = document.createElement("p"); s.className = "tiny-note"; s.textContent = payload.sources.join(" · "); body.append(s);
  }
  if (payload.breakdown) {
    const b = document.createElement("pre"); b.className = "why-pre"; b.textContent = JSON.stringify(payload.breakdown, null, 2); body.append(b);
  }
}

async function loadOfficialData() {
  const box = document.getElementById("dataCards");
  if (!box) return;
  try {
    const res = await fetch("/api/data/snapshot");
    const data = await res.json();
    if (!res.ok) throw new Error("data");
    box.innerHTML = "";
    (data.items || []).forEach((item) => {
      const card = document.createElement("article");
      card.className = "data-card";
      const h = document.createElement("h4"); h.textContent = item.title; card.append(h);
      const v = document.createElement("div"); v.className = "data-value"; v.textContent = item.value; card.append(v);
      const p = document.createElement("p"); p.className = "tiny-note";
      p.textContent = (language === "te" ? "మూలం" : "Source") + ": " + item.source + " · " +
        (language === "te" ? "అమలు" : "Effective") + ": " + item.effective_from + " · " +
        (language === "te" ? "ధృవీకరణ" : "Verified") + ": " + item.verified_on;
      card.append(p);
      box.append(card);
    });
  } catch {
    box.textContent = language === "te" ? "డేటా అందుబాటులో లేదు." : "Official data unavailable.";
  }
}

const mitraFormEl = document.getElementById("mitraForm");
if (mitraFormEl) {
  mitraFormEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = document.getElementById("mitraInput");
    askMitra(input ? input.value : "");
    if (input) input.value = "";
  });
}

document.getElementById("langToggle")?.addEventListener("click", () => {
  setTimeout(() => { renderMitraSuggestions(); loadOfficialData(); }, 0);
});

const _origShow = typeof show === "function" ? show : null;
if (_origShow) {
  show = function(result) {
    _origShow(result);
    lastResult = result;
    showWhyPanel({
      title: language === "te" ? "అన్ని లక్ష్యాల విజయ సంభావ్యత" : "All-goals success probability",
      formula: "success_trials / total_trials (monthly cash-flow Monte Carlo)",
      inputs: lastInput || {},
      assumptions: language === "te"
        ? "నెలవారీ రాబడి లాగ్‌నార్మల్; వర్గాల వారీ ద్రవ్యోల్బణం; SIP మిగులుకు పరిమితం."
        : "Lognormal monthly returns; category inflation; SIP capped by surplus.",
      sources: ["Hisaab financial engine", "docs/MODEL.md"],
      breakdown: { score: result.score, depletion_odds: result.depletion_odds, trials: result.trials, seed: result.seed, goals: result.goals }
    });
  };
}

renderMitraSuggestions();
loadOfficialData();


/* Server-side PDF download with embedded Telugu font */
(function() {
  const btn = document.getElementById("pdfReport");
  if (!btn) return;
  btn.addEventListener("click", async (ev) => {
    if (typeof lastInput === "undefined" || !lastInput || typeof lastResult === "undefined" || !lastResult) {
      return; // existing alert handler may also fire
    }
    ev.stopImmediatePropagation();
    ev.preventDefault();
    try {
      const res = await fetch("/api/report/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: language, inputs: lastInput, result: lastResult })
      });
      if (!res.ok) throw new Error("PDF failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = language === "te" ? "hisaab-nivadika.pdf" : "hisaab-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // fall through to existing print dialog behavior
    }
  }, true); // capture so we run early
})();


// Shareable, reproducible scenario links and one-click household presets.
(function () {
  const form = document.getElementById("sim");
  const field = (name) => form && form.elements.namedItem(name);
  const personas = {
    grad: {years:20,savings:100000,income:55000,expense:28000,sip:12000,ret:10,vol:18,income_growth:8,medical_shock:250000,goals:[{name:"Higher education",at:6,cost:800000,kind:"education",flex:true}]},
    family: {years:20,savings:1200000,income:160000,expense:85000,sip:40000,ret:10,vol:16,income_growth:8,medical_shock:600000,goals:[{name:"Child education",at:12,cost:3000000,kind:"education",flex:false},{name:"Home upgrade",at:8,cost:1800000,kind:"home",flex:true}]},
    single: {years:18,savings:700000,income:90000,expense:65000,sip:18000,ret:9,vol:20,income_growth:6,medical_shock:800000,goals:[{name:"Family safety reserve",at:5,cost:1200000,kind:"medical",flex:false},{name:"Retirement bridge",at:18,cost:4500000,kind:"general",flex:false}]}
  };
  function applyState(state) {
    if (!form || !state || typeof state !== "object") return;
    ["years","savings","income","expense","sip","ret","vol","income_growth","medical_shock","seed"].forEach(k => {
      if (state[k] !== undefined && field(k)) field(k).value = state[k];
    });
    if (field("shocks") && state.shocks !== undefined) field("shocks").checked = !!state.shocks;
    if (Array.isArray(state.goals) && state.goals.length) {
      document.getElementById("goals").replaceChildren();
      state.goals.slice(0,12).forEach(goal => goalRow(goal));
    }
    if (Array.isArray(state.events)) {
      document.getElementById("events").replaceChildren();
      state.events.slice(0,20).forEach(event => addEventRow(event));
    }
  }
  document.querySelectorAll("[data-persona]").forEach(button => {
    button.addEventListener("click", () => {
      applyState({...personas[button.dataset.persona],seed:20261112,shocks:true,events:[]});
      form.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
  const share = document.getElementById("shareScenario");
  if (share) share.addEventListener("click", async () => {
    if (!lastInput) { alert("Run a simulation before sharing."); return; }
    const payload = {...lastInput, seed:lastInput.seed ?? Number(field("seed").value), shocks:lastInput.shocks ?? field("shocks").checked};
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const url = location.origin + location.pathname + "#s=" + encoded;
    history.replaceState(null,"",url);
    try { await navigator.clipboard.writeText(url); share.textContent = "Link copied"; }
    catch (_) { share.textContent = "Link ready in address bar"; }
  });
  if (location.hash.startsWith("#s=")) {
    try {
      let encoded=location.hash.slice(3).replace(/-/g,"+").replace(/_/g,"/");
      encoded += "=".repeat((4-encoded.length%4)%4);
      const state=JSON.parse(decodeURIComponent(escape(atob(encoded))));
      applyState(state);
      if (form) form.requestSubmit();
    } catch (_) { /* Ignore malformed or manually edited shared links. */ }
  }
})();
