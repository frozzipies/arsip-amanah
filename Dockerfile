FROM node:22-alpine

RUN apk add --no-cache tini

RUN addgroup -S arsip && adduser -S -G arsip arsip

WORKDIR /app

COPY app/backend/package.json ./app/backend/
COPY app/gateway/package.json ./app/gateway/

RUN npm --prefix app/backend install --omit=dev --no-audit --no-fund \
 && npm --prefix app/gateway install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY app/backend/ ./app/backend/
COPY app/gateway/ ./app/gateway/
COPY run.sh ./run.sh

RUN chmod +x ./run.sh

USER arsip

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./run.sh"]