# Changelog

## Hisaab 3.1 — Complete platform closure

- **Server-side PDF** with embedded Telugu-capable font (Hind Guntur); direct download via `/api/report/pdf`.
- **Official source ingestion** (ITD, RBI, CBIC, SEBI) with candidate queue and human approval gate.
- **Optional LLM** (Gemini / Groq) via server-side env keys; default remains grounded Mitra.
- **QA packs**: `docs/SECURITY.md`, `docs/METHODOLOGY.md`, `docs/QA.md` with sign-off tables.
- Fonts bundled under `fonts/` for reproducible PDF embedding in Docker.

## Hisaab 3.0 — Financial intelligence platform

- **Hisaab Mitra**: bilingual (English / Telugu) grounded assistant — explains tax rules, SIP, inflation, simulation shortfalls; never invents rates.
- **Tax Intelligence Engine**: versioned TY 2026–27 new/old regime rules with source, effective date, verified date; deterministic slab + 87A + cess.
- **Financial data service**: curated RBI / inflation / GST / savings snapshots with provenance fields.
- **Why This Number?**: formula, inputs, assumptions and sources for key results.
- **Official context panel** in the UI with source-dated cards.
- Expanded API: `/api/mitra`, `/api/tax/*`, `/api/data/snapshot`.
- Telugu strings expanded for new panels; pure Telugu (no Tamil contamination) in Mitra replies.

## Hisaab 2.2 — Production hardening

- Gateway: CSP, COOP/CORP, Permissions-Policy, X-Frame-Options, nosniff headers on every response.
- In-memory per-IP rate limiting (configurable via `HISAAB_RATE_LIMIT`, default 60/min).
- `/healthz` liveness and `/readyz` readiness (probes engine) endpoints.
- Structured JSON access logs; request timeouts on engine proxy (25s).
- Stricter static-file allowlist and path-traversal rejection; 64 KB body limit.
- Docker: non-root `hisaab` user, HEALTHCHECK, production env defaults.
- Engine bound to 127.0.0.1 only; gateway bind configurable (`HISAAB_BIND`).
- Smoke tests cover health/readiness probes.

## Hisaab 2.1.1 — Production launch

- Product positioning updated from pilot/educational language to full production financial digital twin.
- User-facing copy, PDF report footer, Telugu strings and documentation aligned for production launch.
- Retained transparent model assumptions and required non-advice framing for regulatory clarity.

## Hisaab 2.1 — Scenario Lab release

- Added explicit three-way financial scenario comparison (Baseline · SIP +15% · SIP +30% / delay flexible goals) using common random numbers.
- Scenario Lab cards show all-goals success rate, median ending corpus and depletion odds side-by-side.
- Frontend TypeScript compiles cleanly; Docker image uses prebuilt `web/app.js` (no runtime `tsc` required).
- Extended unit tests for comparison payload shape; smoke tests remain green.
- Telugu labels retained for the comparison panel and PDF report.

## Hisaab 2.0 — Many-Lives Money Lab

- Rebuilt the simulation from annual steps to monthly cash-flow-aware steps.
- Added monthly income, expense deficits, SIP caps, income growth and expense inflation.
- Corrected monthly return calibration and made inflation compounding explicit.
- Added reproducible seeds, common-random-number what-if comparisons and real-rupee ending wealth percentiles.
- Added goal-level success odds, ending-at-zero rate and clearer scenario output.
- Rebuilt the responsive interface and added accessible progress indicators and chart descriptions.
- Removed user-controlled HTML insertion and added request validation, request-size limits, safer file serving, timeouts and security headers.
- Updated the salary estimate to Tax Year 2026–27 assumptions and exposed professional tax as an input.
- Added a detailed model-methodology document, ten unit tests and an end-to-end smoke test.
