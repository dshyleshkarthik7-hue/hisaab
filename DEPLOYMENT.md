# Deployment guide

## Docker
```bash
docker build -t hisaab .
docker run --rm -p 8080:8080 hisaab
```
Open http://localhost:8080.

## Render
1. Push the `hisaab/` directory contents to a Git repository.
2. Create a new Render Blueprint from that repository.
3. Render detects `render.yaml`, builds the Docker image and checks `/`.
4. Open the service URL and run the included smoke tests against the deployed site.

## Production operations
- Terminate TLS and attach a custom domain at the hosting layer (Render / Cloudflare / your load balancer).
- Add edge rate limiting and WAF for public exposure.
- Configure uptime monitoring and alerting on `/` and `/api/simulate`.
- No application-level backups are required today — the app stores no user financial data.
- Validate Telugu rendering and PDF print output on your target mobile and desktop browsers before go-live.
- Keep the Tax Year 2026–27 salary estimator in sync with official Income Tax Department tables.


## Health endpoints
- `GET /healthz` — process liveness (always 200 when gateway is up)
- `GET /readyz` — readiness (200 only when simulation engine responds)

## Runtime configuration
| Variable | Default | Purpose |
|---|---|---|
| `HISAAB_HTTP_PORT` | `8080` | Public gateway port |
| `HISAAB_ENGINE_PORT` | `8081` | Internal engine port (localhost only) |
| `HISAAB_BIND` | `0.0.0.0` | Gateway bind address |
| `HISAAB_RATE_LIMIT` | `60` | Max requests per IP per minute |


## Optional LLM (Hisaab Mitra fluency)
| Variable | Example | Purpose |
|---|---|---|
| `HISAAB_LLM_PROVIDER` | `gemini` or `groq` | Enable external model |
| `HISAAB_LLM_API_KEY` | secret | Server-side only |
| `HISAAB_LLM_MODEL` | provider default | Optional model override |

Without these, Mitra uses the grounded rule-based engine only (recommended default).

## Official source monitor
- `POST /api/ingestion/monitor` — fetch all configured sources into candidate queue
- `GET /api/ingestion/candidates` — list pending
- `POST /api/ingestion/approve` — promote a candidate (does **not** auto-change tax rules)
- `GET /api/ingestion/status` — counts

## PDF reports
- `POST /api/report/pdf` with `{lang, inputs, result}` returns `application/pdf` with embedded Telugu-capable font when available.
