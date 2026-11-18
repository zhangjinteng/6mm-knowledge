FROM node:22-bookworm-slim AS node
FROM golang:1.25-bookworm AS minio
ARG MINIO_COMMIT=0d7408fc9969caf07de6a8c3a84f9fbb10a6739e
RUN git clone --depth 1 --branch RELEASE.2025-04-22T22-12-26Z https://github.com/minio/minio.git /src \
    && test "$(git -C /src rev-parse HEAD)" = "$MINIO_COMMIT"
WORKDIR /src
RUN CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o /minio . \
    && tar --exclude=.git -czf /minio-source.tar.gz .
FROM pgvector/pgvector:0.8.1-pg17-bookworm

ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production PORT=8080 HOST=0.0.0.0 KNOWLEDGE_DATA_DIR=/data \
    PARSE_FILE_WORKERS=1 HTML_TO_MARKDOWN_WORKERS=1 TEXT_TO_CHUNKS_WORKERS=1 \
    PARSE_FILE_TIMEOUT_SECONDS=300 LOG_CONSOLE_LEVEL=warning LOG_ENABLE_OTEL=false \
    STORAGE_S3_FORCE_PATH_STYLE=true CHECK_INTERNAL_IP=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor redis-server ca-certificates curl tini libcurl4 libssl3 libgssapi-krb5-2 \
    poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    libldap-2.5-0 libsasl2-2 libsnappy1v5 liblzma5 libbrotli1 libwrap0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home knowledge
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable && corepack prepare pnpm@10.28.2 --activate
RUN curl --fail --location --retry 3 https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-8.0.14.tgz -o /tmp/mongo.tgz \
    && echo 'de1f62df4710cf6094c75f7ab160a1818f0cc41bbde763b428582069b9dcfda7  /tmp/mongo.tgz' | sha256sum -c - \
    && tar -xzf /tmp/mongo.tgz -C /tmp \
    && install /tmp/mongodb-linux-x86_64-ubuntu2204-8.0.14/bin/mongod /usr/local/bin/mongod \
    && mkdir -p /opt/licenses/mongodb \
    && cp /tmp/mongodb-linux-x86_64-ubuntu2204-8.0.14/LICENSE* /opt/licenses/mongodb/ \
    && rm -rf /tmp/mongo.tgz /tmp/mongodb-linux-x86_64-ubuntu2204-8.0.14
COPY --from=minio /minio /usr/local/bin/minio
COPY --from=minio /src/LICENSE /opt/licenses/minio/LICENSE
COPY --from=minio /minio-source.tar.gz /opt/licenses/minio/source.tar.gz
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
COPY app ./app
COPY scripts ./scripts
COPY upstream ./upstream
COPY tsconfig.json LICENSE ./
COPY docker/supervisord.conf /etc/supervisor/conf.d/knowledge.conf
COPY docker/entrypoint.sh /usr/local/bin/knowledge-entrypoint
RUN node scripts/build.mjs && chmod +x /usr/local/bin/knowledge-entrypoint \
    && ldd /usr/local/bin/mongod | tee /tmp/mongo-libs && ! grep -q 'not found' /tmp/mongo-libs
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=120s --retries=3 CMD curl --fail --silent http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/knowledge-entrypoint"]
