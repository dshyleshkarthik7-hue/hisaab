# Deployment guide

Hisaab is a stateless household-finance simulator for user inputs. The operational ingestion queue is the only writable application data; it is stored under `HISAAB_DATA_DIR`. Do not use this application as a system of record for customer financial documents or identity data.

## Recommended deployment: Render Blueprint

1. Merge the deployment-readiness pull request into `main` after CI passes.
2. In Render, create a **New → Blueprint** and connect `dshyleshkarthik7-hue/hisaab`.
3. Review the Blueprint before applying it. It creates one paid 1 CPU / 2 GB web service in Singapore, a 1 GB persistent disk, a generated `HISAAB_ADMIN_TOKEN`, and a readiness probe at `/readyz`.
4. Keep the generated administrator token secret. Use it only for the operational endpoints listed below. Rotate it from the Render Environment page if exposed.
5. Wait for the first deploy to become Live, then verify the checks below before sharing the URL.
6. Add a custom domain only after the smoke checks pass. Render terminates HTTPS for web services; verify the custom-domain certificate before advertising the site.

The disk preserves the operational ingestion queue across restarts and deploys. Render persistent disks are single-instance and prevent zero-downtime deploys and horizontal scaling. This Blueprint is therefore a **single-instance small deployment**, not a horizontally scalable high-availability architecture. If you need multiple instances or uninterrupted deploys, move the candidate queue to a managed shared store before scaling.

Render's proxy supplies `CF-Connecting-IP`; the Blueprint enables trusting that header for per-client rate limiting. Do not set `HISAAB_TRUST_PROXY_HEADERS=true` on a deployment that does not sit behind a trusted Cloudflare proxy that overwrites that header.

## Docker (local or self-hosted)

```bash
docker build -t hisaab:local .
docker volume create hisaab-data
docker run --rm \
  -p 8080:8080 \
  -v hisaab-data:/var/data \
  -e HISAAB_ADMIN_TOKEN="$(openssl rand -hex 32)" \
  hisaab:local
```

Open `http://localhost:8080`. For self-hosting, terminate TLS at a trusted reverse proxy, configure a WAF/rate limit, and leave `HISAAB_TRUST_PROXY_HEADERS=false` unless the trusted proxy contract has been verified.

The image compiles `web/app.ts` during its build, installs Python dependencies in an isolated virtual environment, requires both bundled Hind Guntur font files, and runs the gateway and simulation engine as the unprivileged `hisaab` user. The entrypoint only runs as root long enough to prepare the mounted data directory and then drops privileges.

## Post-deploy verification

Run these checks against the deployed HTTPS URL:

```bash
BASE="https://YOUR-SERVICE.onrender.com"
curl -fsS "$BASE/healthz"
curl -fsS "$BASE/readyz"
curl -fsS "$BASE/" | grep -q "HISAAB"
curl -fsS "$BASE/api/data/snapshot"
curl -i "$BASE/api/ingestion/status"  # must be 401 without bearer token
```

Then, using the secret shown in Render Environment (do not paste it into tickets or logs):

```bash
curl -fsS -H "Authorization: Bearer $HISAAB_ADMIN_TOKEN" \
  "$BASE/api/ingestion/status"
```

Also run the full browser flow manually: create a scenario, run simulations, compare alternatives, ask Mitra a rule-based question, and generate English and Telugu PDFs. Confirm the PDF has readable Telugu glyphs on the target devices. Automated CI validates the engine, gateway, static assets, PDFs, admin-route authentication, and Docker image build; it does not replace live-browser and operational acceptance testing.

## Health endpoints

- `GET /healthz` — gateway liveness.
- `GET /readyz` — readiness; returns 200 only when the Python engine responds.

## Runtime configuration

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | Platform-provided, otherwise 8080 | Public gateway port. `HISAAB_HTTP_PORT` overrides it. |
| `HISAAB_ENGINE_PORT` | 8081 | Internal engine port, bound to loopback only. Never expose it publicly. |
| `HISAAB_BIND` | 0.0.0.0 | Public gateway bind address. |
| `HISAAB_RATE_LIMIT` | 60 | Requests per client IP per minute; set to 0 only when a trusted edge enforces equivalent limits. |
| `HISAAB_TRUST_PROXY_HEADERS` | false | Trust Render's overwritten `CF-Connecting-IP` header. Do not enable for arbitrary/self-hosted proxies. |
| `HISAAB_HTTP_THREADS` | 8 | Bounded gateway worker count (4–32). |
| `HISAAB_DATA_DIR` | `python/data` | Candidate/approved ingestion storage; mount persistent storage here for operational use. |
| `HISAAB_ADMIN_TOKEN` | unset | Required bearer secret for all ingestion endpoints. If unset, those routes return 404. |
| `HISAAB_LLM_ENABLED` | false | Explicit opt-in for external LLM calls. |
| `HISAAB_LLM_PROVIDER` | unset | `gemini` or `groq`, only used when enabled. |
| `HISAAB_LLM_API_KEY` | unset | Server-side provider secret. Never commit it. |
| `HISAAB_LLM_MODEL` | provider default | Optional model override. |

## Administrator-only ingestion endpoints

All `/api/ingestion/*` routes require `Authorization: Bearer <HISAAB_ADMIN_TOKEN>`. They are disabled when the secret is not configured. Candidate pages fetched by the monitor do not change live tax rules; human review and an explicit code/rule-pack update are still required. Treat the candidate queue as operational metadata, not an audited compliance archive.

## External language model

External LLM calls are disabled by default, even if a provider key is present. Enabling `HISAAB_LLM_ENABLED=true` sends the user's Mitra question and the grounded answer/calculation context to the configured third-party provider. Obtain appropriate user notice/consent and review the provider's current retention and training terms before enabling it. Do not send PAN, account numbers, identity documents, or other directly identifying data.

## Data and tax accuracy boundaries

The reference-data panel contains official source links, not live values. It deliberately does not publish current RBI, CPI, GST or savings-scheme rates without a verified data feed. Users must check the primary source.

The tax and CTC tools are simplified educational estimates, not a tax-return computation or payroll determination. The tax engine omits surcharge above its ₹50 lakh scope, special-rate income, full taxpayer-category/residential-status/age handling and many deductions/payroll components. It must receive independent review by a qualified Indian tax professional before being used as a public tax product.

## Production acceptance still required

- Independent security review / penetration test and privacy review.
- Financial-model validation by a qualified professional; document accepted assumptions and model risk.
- Tax-rule and payroll review against the applicable Income Tax Act / tax year and official calculator.
- Browser and PDF QA on supported mobile/desktop devices, including Telugu fonts.
- Uptime/error monitoring, alert routing, incident response and secret-rotation procedure.
- Restore test for the persistent disk and documented retention/deletion policy.
- Load test at expected concurrency and a capacity decision before adding more instances.
