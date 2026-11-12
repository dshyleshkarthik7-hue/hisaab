# Compile the maintained TypeScript source into the browser artifact.
FROM node:22-alpine AS frontend
WORKDIR /src
COPY web/app.ts web/tsconfig.json ./web/
RUN npm install --global typescript@5.7.3 && tsc -p web

# Java gateway + Python simulation service.
FROM eclipse-temurin:21-jdk-jammy
COPY requirements.txt /tmp/requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates util-linux \
    && python3 -m venv /opt/hisaab-venv \
    && /opt/hisaab-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/hisaab-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system hisaab \
    && useradd --system --gid hisaab --home /app --shell /usr/sbin/nologin hisaab

WORKDIR /app
COPY --chown=hisaab:hisaab . .
COPY --from=frontend --chown=hisaab:hisaab /src/web/app.js /app/web/app.js
RUN test -s /app/fonts/HindGuntur-Regular.ttf \
    && test -s /app/fonts/HindGuntur-Bold.ttf \
    && chmod +x /app/run.sh /app/entrypoint.sh \
    && test -f /app/web/app.js \
    && test -f /app/web/index.html \
    && test -f /app/java/Hisaab.java \
    && test -f /app/python/engine.py

ENV PATH="/opt/hisaab-venv/bin:$PATH" \
    HISAAB_ENGINE_PORT=8081 \
    HISAAB_BIND=0.0.0.0 \
    HISAAB_RATE_LIMIT=60 \
    HISAAB_HTTP_THREADS=8 \
    HISAAB_DATA_DIR=/var/data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', os.environ.get('HISAAB_HTTP_PORT','8080')) + '/readyz', timeout=3)" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["./run.sh"]
