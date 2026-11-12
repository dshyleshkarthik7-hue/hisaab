# Hisaab production image — Java 21 gateway + Python 3 engine
FROM eclipse-temurin:21-jdk-jammy

COPY requirements.txt /tmp/requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip nodejs npm ca-certificates \
       fonts-dejavu-core \
    && pip3 install --no-cache-dir -r /tmp/requirements.txt \
    && npm install --global typescript@5.7.3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system hisaab \
    && useradd --system --gid hisaab --home /app --shell /usr/sbin/nologin hisaab

WORKDIR /app
COPY --chown=hisaab:hisaab . .
RUN tsc -p web

# Bundle Telugu-capable font into image for PDF embedding
RUN mkdir -p /app/fonts \
    && (cp "/usr/share/fonts/SlidesCarnival/google/Hind Guntur/HindGuntur-Regular.ttf" /app/fonts/ 2>/dev/null || true) \
    && (cp "/usr/share/fonts/SlidesCarnival/google/Hind Guntur/HindGuntur-Bold.ttf" /app/fonts/ 2>/dev/null || true) \
    && chmod +x run.sh \
    && test -f web/app.js \
    && test -f web/index.html \
    && test -f java/Hisaab.java \
    && test -f python/engine.py

ENV HISAAB_HTTP_PORT=8080 \
    HISAAB_ENGINE_PORT=8081 \
    HISAAB_BIND=0.0.0.0 \
    HISAAB_RATE_LIMIT=60 \
    HISAAB_DATA_DIR=/app/python/data

USER hisaab
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)" || exit 1

CMD ["./run.sh"]
