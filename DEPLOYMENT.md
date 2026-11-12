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
| `HISAAB_GLOBAL_RATE_LIMIT` | 120 | Total requests per minute per instance, limiting distributed bursts. |
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


## Cloudflare Pages (static browser build)

The static migration is developed on `migration/cloudflare-full-static` and tracked in [PR #13](https://github.com/dshyleshkarthik7-hue/hisaab/pull/13). It keeps simulation, calculators and Mitra in the browser; the Pages build output is `web`.

### Build and preview locally

```bash
cd web
npm install
npm run build
python -m http.server 8788
```

Open `http://localhost:8788`. The CI pipeline runs the Python reference suite, cross-language simulation and tax fixtures, TypeScript build, a 10,000-trial × 40-year baseline benchmark, a 4× CPU-throttled Chromium core benchmark, and a mobile-viewport PDF download/text-extraction test. Latest observed results: 3.56 s for the 10k × 40-year Worker run and 12.27 s for the same core simulation at 4× CPU throttling; browser viewport 390×844. This is a throttled browser proxy, not a physical-device test. The Scenario Lab and target-SIP bisection are on-demand actions so a 10k-trial baseline does not automatically trigger dozens of additional simulations.

### Deploy after the migration is approved and merged

1. Create a Cloudflare Pages project named `hisaab` and connect the repository, or use the manual workflow below.
2. In GitHub repository settings, configure the `preview` and `production` environments with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use a scoped token with Cloudflare Pages deployment permissions.
3. From the migration branch, run **Actions → Deploy Hisaab preview to Cloudflare Pages → Run workflow**. This creates a branch preview at `migration-cloudflare-full-static.hisaab.pages.dev` if the Pages project exists.
4. Review the preview, including simulation, PDF download and mobile layout. Merge the migration only after financial-model, tax and browser/PDF acceptance reviews are complete.
5. On the `main` branch, run **Actions → Deploy Hisaab to Cloudflare Pages → Run workflow**. The workflow is intentionally manual and refuses to deploy from a non-main branch.
6. Verify the generated `https://hisaab.pages.dev` URL, then attach the intended custom domain in Cloudflare Pages → Custom domains. Confirm the zone is active in the same Cloudflare account and follow Cloudflare's DNS instructions; do not guess or overwrite existing DNS records.

No Cloudflare credentials are stored in this repository. No production deployment or DNS modification has been performed from this migration branch.

### PDF behavior

The browser-only build generates and downloads an A4 PDF directly with pdfnative. It bundles Noto Telugu and Noto Sans font data, uses the Telugu OpenType shaper, and includes simulation summary, inputs, goals, scenario comparisons, target-SIP analysis, paired shock counterfactuals and annual corpus bands. The Chromium smoke test generates a Telugu-language report and verifies its extracted Unicode text. Check page breaks and visual shaping on supported physical devices before production sign-off.

### Static-build scope

The browser build does not run the old server-side ingestion queue, admin endpoints or external LLM integration. It deliberately displays primary-source links instead of fabricating live rates, and Mitra uses local grounded explanations. Those operational features require separately designed Cloudflare Functions/storage/secrets and are not silently emulated by static assets.
