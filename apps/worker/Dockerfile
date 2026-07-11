# syntax=docker/dockerfile:1
# Built from the REPO ROOT (pnpm monorepo):
#   docker build -f apps/worker/Dockerfile -t kubepilot-worker:dev .
#
# One image, two entrypoints (chosen by the Deployment's command):
#   node dist/index.js   → ingestion worker (default)
#   node dist/engine.js  → analysis + digest schedulers

FROM node:20-slim AS builder
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kubepilot/contract build \
 && pnpm --filter @kubepilot/db build \
 && pnpm --filter @kubepilot/worker build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=builder /repo /repo
WORKDIR /repo/apps/worker
USER node
CMD ["node", "dist/index.js"]
