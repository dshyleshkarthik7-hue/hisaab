# Hisaab security review pack

## Controls implemented in this branch

- Security response headers: strict CSP (no inline script/style), HSTS, frame denial, nosniff, Referrer-Policy, Permissions-Policy, COOP and CORP.
- Bounded request bodies (64 KB), finite numeric validation, upstream request timeouts and exact-length body reads.
- Static file path normalization and real-path containment.
- Python engine bound to loopback only; public gateway uses a bounded worker pool and queue.
- Per-client in-memory rate limiting. On Render, the trusted Cloudflare `CF-Connecting-IP` header is used; X-Forwarded-For is deliberately not trusted.
- All operational ingestion endpoints require a constant-time bearer-token comparison. If `HISAAB_ADMIN_TOKEN` is absent, those routes return 404.
- Structured access logs escape untrusted request values and omit client IP addresses.
- Container build requires bundled Telugu fonts, uses an isolated Python virtual environment, and drops to the unprivileged `hisaab` process after preparing persistent storage.
- External LLM calls require explicit `HISAAB_LLM_ENABLED=true`; a provider key alone does not enable data egress.

## Deployment requirements

1. Terminate TLS at a trusted platform edge and verify HTTPS on the final custom domain.
2. Keep `HISAAB_ENGINE_PORT` private. Never expose port 8081.
3. Keep `HISAAB_ADMIN_TOKEN` in a secret manager. Generate at least 256 bits of entropy and rotate immediately if exposed.
4. Keep LLM integration disabled unless user notice/consent and the provider's current data-retention/training terms have been reviewed.
5. Keep `HISAAB_RATE_LIMIT` enabled. If running multiple instances, replace the process-local limiter with a shared distributed limiter before scaling.
6. Back up the Render persistent disk if retaining ingestion candidates; verify restoration and retention/deletion procedures.
7. Do not use application logs as an audit trail. They intentionally exclude request bodies, client IPs and financial inputs.
8. Run independent penetration testing, dependency scanning and privacy review before collecting sensitive or identifiable user information.

## Known residual risks

- The gateway and engine are a compact single-process-per-container design, not a hardened multi-tenant financial platform.
- In-memory rate limits do not coordinate across instances.
- The admin bearer token is a shared operator credential; there are no named operator accounts, granular roles, audit approvals or MFA.
- Ingestion candidates are untrusted external page snapshots. They do not automatically update tax rules; review the content and change the code/rule pack through a controlled release.
- Optional LLM integration sends question/context to a third party when explicitly enabled.
- No customer account, encryption-at-rest, consent-management, data export/deletion workflow or incident response tooling is implemented because the application is not designed to retain user financial profiles.
- Financial-model assumptions and tax estimates require independent domain review. CI is not a legal, tax, investment, privacy or security certification.

## Automated checks

- `python3 -m unittest discover -s tests -v`
- `python3 -m compileall -q python tests`
- TypeScript type check and browser JavaScript syntax check.
- `python3 tests/smoke.py` (health/readiness, EMI, tax, simulation, PDF, path traversal, admin auth, Mitra and data snapshot).
- Docker image build.

## Sign-off template

| Reviewer | Date | Result | Notes |
|---|---|---|---|
| Application security | | Pass / Fail | |
| Privacy | | Pass / Fail | |
| Financial methodology | | Pass / Fail | |
| Tax rules | | Pass / Fail | |
| Operations / recovery | | Pass / Fail | |
