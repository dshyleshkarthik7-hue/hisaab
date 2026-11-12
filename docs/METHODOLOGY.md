# Hisaab financial methodology pack

## Model
See `docs/MODEL.md` for the monthly cash-flow Monte Carlo process, inflation categories,
job-loss and medical-event assumptions, and SIP surplus cap.

## Tax Intelligence
- Rules are versioned by tax year and regime (`python/tax_engine.py`).
- Each pack records source, effective date, verification metadata and status. The current calculator status is `illustrative`, not certified for filing.
- Ingestion candidates from official sites **never** alter live rules until approved
  and explicitly mapped by a human operator.

## Data provenance
`data_service` contains source links only; it does not assert current rates or populate a `verified_on` date until a live source is independently checked.
- update cadence

## Limitations (must remain visible to users)
- Simplified return model (lognormal monthly); no fees, taxes on gains, or fat tails.
- Fixed job-loss / medical probabilities.
- Illustrative salary estimator for TY 2026–27 — confirm against official tables.
- Not SEBI-registered advice; not a filing computation.

## Methodology sign-off
| Reviewer | Date | Result | Notes |
|---|---|---|---|
| Financial methodology | | Pass / Fail | |
| Tax rules verification | | Pass / Fail | |
