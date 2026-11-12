# Deployment guide

Hisaab is a stateless household-finance simulator for user inputs. It does not require a customer database. The optional operational ingestion queue is local application data and is **not persistent on the free deployment**. Do not use this application as a system of record for customer financial documents or identity data.

## Zero-cost demo deployment (no payment method)

The included Render Blueprint is intentionally configured for the **Free** web-service tier. It is suitable for a hobby/demo deployment, not a production financial service.

1. Sign in to Render and choose **New → Blueprint**.
2. Connect `dshyleshkarthik7-hue/hisaab` and select the `main` branch.
3. Review the detected Blueprint. It should show one **Free** web service, no disk, and no paid database or add-ons.
4. Apply the Blueprint. Do not upgrade the service or add a paid disk/database.
5. Wait for the deploy to become Live, then run the checks below against the generated `onrender.com` URL.

No credit card is intended for this Free-only configuration. If Render asks you to add a payment method or select a paid plan, stop and do not proceed.

### Free-tier limitations (important)

- Render Free web services have 512 MB RAM and spin down after 15 minutes without inbound traffic; the next request can take about a minute while the service wakes up.
- The filesystem is ephemeral. Local files are lost when the service restarts, spins down, or redeploys. The Blueprint therefore has no persistent disk and uses `/tmp/hisaab-data`.
- The admin ingestion endpoints remain disabled because `HISAAB_ADMIN_TOKEN` is deliberately not configured. Do not add an admin token to this free deployment unless you understand that any ingestion queue data can disappear.
- Free services can be restarted by the platform and have monthly usage/bandwidth/build limits. If limits are exceeded without a payment method, Render may suspend the service or pause new builds.
- The container runs both a Java gateway and a Python engine in a 512 MB instance. JVM memory is capped to reduce memory pressure, but a free instance may still be too small or slow for some workloads. If health checks fail or the service is repeatedly restarted for memory use, do not upgrade automatically; use the local run instructions or reassess the hosting option.

Render explicitly says Free instances are for testing, hobby projects, and previews, and not to use them for production applications. This setup is the best no-card path for trying the app online, not a promise of production-grade uptime, data retention, or capacity.

Render's proxy supplies `CF-Connecting-IP`; the Blueprint enables trusting that header for per-client rate limiting. Do not set `HISAAB_TRUST_PROXY_HEADERS=true` on a deployment that does not sit behind a trusted proxy that overwrites that header.

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

The image compiles `web/app.ts` during its build, installs Python dependencies in an isolated virtual environment, requires both bundled Hind Guntur font files, and runs the gateway and simulation engine as the unprivileged `hisaab` user. The entrypoint only runs as root long enough to prepare the data directory and then drops privileges.

## Post-deploy verification

Run these checks against the deployed HTTPS URL:

```bash
BASE="https://YOUR-SERVICE.onrender.com"
curl -fsS "$BASE/healthz"
curl -fsS "$BASE/readyz"
curl -fsS "$BASE/" | grep -q "HISAAB"
curl -fsS "$BASE/api/data/snapshot"
curl -i "$BASE/api/ingestion/status"  # expected 404: ingestion is disabled
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
| `HISAAB_GLOBAL_RATE_LIMIT` | 120 | Total requests per minute per instance, limiting distributed bursts. |
| `HISAAB_TRUST_PROXY_HEADERS` | false | Trust Render's overwritten `CF-Connecting-IP` header. Do not enable for arbitrary/self-hosted proxies. |
| `HISAAB_HTTP_THREADS` | 8 | Bounded gateway worker count (4–32). |
| `HISAAB_DATA_DIR` | `python/data` | Candidate/approved ingestion storage; local filesystem only unless persistent storage is configured. |
| `HISAAB_ADMIN_TOKEN` | unset | Required bearer secret for all ingestion endpoints. If unset, those routes return 404. |
| `HISAAB_LLM_ENABLED` | false | Explicit opt-in for external LLM calls. |
| `HISAAB_LLM_PROVIDER` | unset | `gemini` or `groq`, only used when enabled. |
| `HISAAB_LLM_API_KEY` | unset | Server-side provider secret. Never commit it. |
| `HISAAB_LLM_MODEL` | provider default | Optional model override. |

## Administrator-only ingestion endpoints

All `/api/ingestion/*` routes require `Authorization: Bearer <HISAAB_ADMIN_TOKEN>`. They are disabled when the secret is not configured. Candidate pages fetched by the monitor do not change live tax rules; human review and an explicit code/rule-pack update are still required. Treat the candidate queue as operational metadata, not an audited compliance archive. The free Blueprint intentionally leaves the token unset and does not promise persistence.

## External language model

External LLM calls are disabled by default, even if a provider key is present. Enabling `HISAAB_LLM_ENABLED=true` sends the user's Mitra question and the grounded answer/calculation context to the configured third-party provider. Obtain appropriate user notice/consent and review the provider's current retention and training terms before enabling it. Do not send PAN, account numbers, identity documents, or other directly identifying data.

## Data and tax accuracy boundaries

The reference-data panel contains official source links, not live values. It deliberately does not publish current RBI, CPI, GST or savings-scheme rates without a verified data feed. Users must check the primary source.

The tax and CTC tools are simplified educational estimates, not a tax-return computation or payroll determination. The tax engine omits surcharge above its ₹50 lakh scope, special-rate income, full taxpayer-category/residential-status/age handling and many deductions/payroll components. It must receive independent review by a qualified Indian tax professional before being used as a public tax product.

## Production acceptance still required

The Free Blueprint is a demo configuration only. Before any real production use, move to hosting with adequate guaranteed memory, persistent/shared storage if needed, backups, monitoring and an incident-response plan. Also complete:
- Independent security review / penetration test and privacy review.
- Financial-model validation by a qualified professional; document accepted assumptions and model risk.
- Tax-rule and payroll review against the applicable Income Tax Act / tax year and official calculator.
- Browser and PDF QA on supported mobile/desktop devices, including Telugu fonts.
- Uptime/error monitoring, alert routing, incident response and secret-rotation procedure.
- Load test at expected concurrency and a capacity decision before adding more instances.
