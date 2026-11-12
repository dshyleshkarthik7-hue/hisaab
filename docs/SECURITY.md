# Hisaab security review pack

## Scope
Production gateway (Java) + simulation/tax/data/mitra engine (Python) + static web UI.

## Controls implemented
- Security headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP
- Per-IP rate limiting (default 60/min, `HISAAB_RATE_LIMIT`)
- Request body limit 64 KB; Content-Length required
- Static file allowlist; path traversal rejection
- Engine bound to 127.0.0.1 only
- Non-root Docker user
- Structured JSON access logs
- Optional LLM keys server-side only (`HISAAB_LLM_API_KEY`)

## Residual risks / operator actions
1. Place TLS terminator and WAF (Cloudflare/Render) in front of the service.
2. Run an independent penetration test before handling sensitive traffic.
3. Set production rate limits appropriate to expected traffic.
4. Do not expose `HISAAB_ENGINE_PORT` publicly.
5. Prefer paid LLM tiers so prompts are not used for model training; never send identifiable KYC/documents to free tiers.
6. Rotate API keys; store only in environment / secret manager.

## Automated checks
- Unit tests: `python3 -m unittest tests.test_engine`
- Smoke: `python3 tests/smoke.py` (health, EMI, tax, simulate, path traversal, mitra, data)

## Sign-off template
| Reviewer | Date | Result | Notes |
|---|---|---|---|
| Security | | Pass / Fail | |
| Privacy | | Pass / Fail | |
| Ops | | Pass / Fail | |
