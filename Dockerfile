FROM node:22-alpine AS deps

ARG APP_UID=1000
ARG APP_GID=1000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
RUN chown -R "${APP_UID}:${APP_GID}" /app

# Development keeps the host's UID/GID so bind-mounted files remain editable.
FROM deps AS development

ARG APP_UID=1000
ARG APP_GID=1000

ENV NODE_ENV=development

COPY --chown=${APP_UID}:${APP_GID} . .

USER ${APP_UID}:${APP_GID}

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

FROM deps AS builder

COPY . .
RUN npm run build

FROM node:22-alpine AS production

ARG APP_UID=1001
ARG APP_GID=1001

RUN addgroup --system --gid "${APP_GID}" app \
  && adduser --system --disabled-password --uid "${APP_UID}" --ingroup app app

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app database/migrations ./database/migrations

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
