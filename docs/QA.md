# Hisaab QA and real-user validation pack

## Automated
- 12+ unit tests on engine validation and reproducibility
- End-to-end smoke: health, readiness, EMI, tax, simulate, path traversal, Mitra, data snapshot

## Manual checklist before go-live
1. Telugu UI: toggle language; verify form labels, Mitra, data cards, Why panel, PDF filename.
2. PDF: download EN and TE reports; confirm embedded font glyphs for Telugu headings.
3. Scenario Lab: run baseline; confirm three comparison cards.
4. Mitra: ask tax slabs, old vs new regime, SIP, goal shortfall (after a simulation).
5. Mobile: 375px and 768px widths; no horizontal overflow on primary flows.
6. Rate limit: confirm HTTP 429 after exceeding `HISAAB_RATE_LIMIT`.
7. LLM off by default: `/api/llm/status` shows available=false without keys.

## Real-user validation (suggested)
- 5–10 households in Andhra Pradesh / Telangana: complete one goal plan in Telugu.
- Capture confusion points on inflation assumptions and SIP cap behaviour.
- Confirm PDF opens on Android Chrome and desktop Chrome/Firefox.

## Sign-off
| Reviewer | Date | Result | Notes |
|---|---|---|---|
| Product QA | | Pass / Fail | |
| Real-user sample | | Pass / Fail | |
