# Hisaab — The Many-Lives Money Lab

Hisaab is a household-finance scenario simulator. Instead of a single deterministic forecast, it runs thousands of plausible financial lives and reports the probability of funding each goal under transparent assumptions.

## Run locally

Requirements: Python 3.9+, Java 17+, Node.js/npm (for the TypeScript build), and the Python packages listed in `requirements.txt` (`reportlab` for PDF generation).

```bash
chmod +x run.sh
./run.sh
```

Open <http://localhost:8080>. Stop with `Ctrl+C`.

Install Python dependencies with `python3 -m pip install -r requirements.txt` and build the browser bundle with `npx --yes --package typescript@5.7.3 tsc -p web` before starting. The launcher also compiles automatically when `tsc` is on PATH; otherwise it uses the committed `web/app.js` fallback. It starts the Python simulation service on `127.0.0.1:8081`, then starts the Java gateway on `127.0.0.1:8080`.

## Platform systems

1. **Financial Digital Twin** — monthly Monte Carlo scenario engine  
2. **Tax Intelligence** — versioned Indian tax rules (new/old regime)  
3. **Financial reference directory** — official source links; no live rate feed or current rate claims  
4. **Hisaab Mitra** — bilingual grounded explainer (EN / తెలుగు)  
5. **Why This Number?** — transparent calculation breakdowns  
6. **Report generator** — bilingual print/PDF financial reports  

## What is included

- Monthly cash-flow-aware Monte Carlo engine (Python standard-library simulation core); ReportLab is used by the PDF-report service.
- Annual category-specific inflation assumptions for general, education, medical and home goals.
- Monthly return variation, job-loss periods and medical-event scenarios.
- Goal-level success odds, all-goals success rate, depletion odds, goal failure rates and paired shock-removal counterfactuals (model-conditional, not proof of real-world causation) and 10th/50th/90th percentile corpus bands.
- Shareable URL-hash scenarios and one-click household personas; no account or database required.
- Reproducible scenario seeds, 25 sampled household paths, common-random-number four-way comparisons and a 36-month mandatory-goal debt glide path using 6.5% annual expected return and 0.5% annual volatility.
- Java gateway with input bounds, request-size limits, timeouts, safer static-file path handling and basic security headers.
- EMI calculator and an explicitly labelled illustrative Tax Year 2026–27 salary/tax estimate for CTC up to ₹50 lakh.
- Accessible, responsive interface with safe DOM construction (no user text inserted as HTML).

## Model assumptions and limitations

Hisaab is an educational household-finance scenario simulator. It is not a regulated SEBI-registered advisory product and does not constitute personalised investment advice. The return model is a simplified lognormal monthly return approximation calibrated to the annual arithmetic mean and volatility and does not represent fat tails, volatility clustering, asset allocation, taxes on investments, fees or sequence-of-return effects accurately. Inflation is sampled annually by category. A job-loss event has a 7% annual probability and lasts six months; a medical event has a 5% annual probability. Expenses are inflated using the general category. The planned SIP is capped by the monthly surplus; if expenses exceed income, the deficit is withdrawn from the corpus. Surplus above the planned SIP is not separately accumulated. Debt repayments, insurance reimbursements, government benefits, changing household composition and detailed tax/payroll rules are not modelled.

The salary estimator is a simplified Tax Year 2026–27 new-regime illustration for CTC up to ₹50 lakh. It assumes a resident individual eligible for Section 87A, employer and employee PF at 12% of basic, a ₹75,000 standard deduction, and user-entered professional tax withheld from take-home pay. It does not model surcharge, special-rate income, every CTC component or every payroll rule. Verify current rules and payroll details independently.

Detailed equations, assumptions and limitations are documented in [`docs/MODEL.md`](docs/MODEL.md).

## Tests

```bash
python3 -m unittest discover -s tests -v
python3 tests/smoke.py  # starts the complete stack; requires Java (uses tsc when installed)
```

The tests cover input validation, deterministic reproducibility, expense/income effects, goal inflation, cash depletion and basic engine invariants.


## Financial Digital Twin additions

- Timed life events: recurring monthly income increases, recurring expense increases and one-time costs, applied at the start of the selected simulation year.
- Telugu language switch for key navigation, headings, form labels and report headings. Financial values remain unchanged when switching languages.
- Print-ready financial report: after running a simulation, select **Download financial report · PDF** and choose **Save as PDF** in the browser print dialog. The report includes inputs, goals, life events, annual corpus percentiles, assumptions and a prominent disclaimer. Telugu glyph quality depends on the operating system/browser Telugu fonts; install Noto Sans Telugu or use a Telugu-enabled browser for best results.

## Deployment

A Docker image and Render Blueprint are included. The image compiles the TypeScript frontend, installs ReportLab in a Python virtual environment, bundles the required Telugu fonts, and runs application services as an unprivileged user. Render's Blueprint uses a persistent disk and one instance; see the deployment guide for its scaling and deploy-downtime trade-offs.

This package is not independently security-reviewed, tax-certified or approved for regulated financial advice. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Render Blueprint, secret handling, persistent storage, health checks and go-live acceptance gates. The app does not store simulation inputs in a customer database; optional ingestion candidates are stored on the configured data volume. External LLM processing is disabled unless explicitly enabled.
