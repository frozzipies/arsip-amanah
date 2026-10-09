FROM node:22-alpine

WORKDIR /app

COPY app/backend/package.json ./app/backend/
COPY app/gateway/package.json ./app/gateway/

RUN npm --prefix app/backend install --omit=dev --no-audit --no-fund \
 && npm --prefix app/gateway install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --chown=node:node . .

ENV PORT=8080
EXPOSE 8080

USER node

CMD ["sh", "run.sh"]