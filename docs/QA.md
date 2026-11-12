# Hisaab QA and release acceptance pack

## Automated CI

The GitHub Actions pipeline checks:
- Python unit and security/tax tests.
- Python syntax compilation.
- TypeScript source type-checking and browser JavaScript syntax.
- Java source compilation.
- Full-stack smoke tests: health/readiness, EMI, tax, simulation, PDF generation, Telugu font embedding, admin bearer-token enforcement, path traversal, Mitra and reference data.
- Docker image build.

## Manual acceptance before public launch

1. **First deploy:** confirm Render reports Live and `/readyz` returns 200.
2. **Browser flows:** run a scenario, add a goal and event, compare alternatives, refresh and verify no unexpected persisted profile data.
3. **Privacy:** confirm no simulation inputs or request bodies appear in application logs; verify LLM is disabled by default.
4. **Admin:** verify ingestion routes return 401 without the bearer token and accept the secret only from an authorized operator.
5. **PDF:** download English and Telugu PDFs; verify glyph coverage, page breaks and numeric formatting on Android Chrome and desktop Chrome/Firefox.
6. **Responsive UI:** validate 375px, 768px and desktop widths with keyboard navigation and screen-reader labels.
7. **Abuse controls:** confirm rate-limit behavior, request-size limits, method rejection, path traversal rejection and overload behavior.
8. **Persistence:** create a test ingestion candidate, redeploy, verify it persists, then exercise backup and restore.
9. **Proxy:** verify rate-limit buckets distinguish real clients using Render's `CF-Connecting-IP` header; do not rely on caller-controlled X-Forwarded-For.
10. **Operations:** configure uptime checks, error alerts, secret rotation, incident response and rollback ownership.

## Domain sign-off required

- Financial model assumptions and outputs reviewed by a qualified financial-model reviewer.
- Tax calculator reviewed against the official Income Tax Department calculator and applicable TY/AY legislation by a qualified Indian tax professional.
- Security and privacy review, including the threat model for shared administrator credentials and any optional external LLM processing.
- Product/legal review of user disclosures and data-retention statements.

## Sign-off

| Reviewer | Date | Result | Notes |
|---|---|---|---|
| Product QA | | Pass / Fail | |
| Application security | | Pass / Fail | |
| Privacy | | Pass / Fail | |
| Financial methodology | | Pass / Fail | |
| Tax rules | | Pass / Fail | |
| Operations / recovery | | Pass / Fail | |
