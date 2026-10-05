# Build context is the REPO ROOT (Render: Root Directory empty, Docker Build
# Context ".", Dockerfile Path "./apps/api/Dockerfile") so the build can see
# packages/shared and the root lockfile.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer caches across source-only changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@docflow/api..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter "@docflow/api..." run build \
 && pnpm --filter @docflow/api deploy --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 10000
# Free tier has no pre-deploy command, so migrate on start (advisory-locked)
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]
