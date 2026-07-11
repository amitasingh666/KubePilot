# syntax=docker/dockerfile:1
# Built from the REPO ROOT (pnpm monorepo):
#   docker build -f apps/backend/Dockerfile -t kubepilot-backend:dev .
#
# Serves BOTH the agent-facing /ingest and the dashboard /trpc APIs.

# ---- builder: install + build backend and its workspace deps (incl. Prisma client) ----
FROM node:20-slim AS builder
RUN corepack enable
# openssl is needed by Prisma's engine at generate/runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Order matters: contract → db (runs `prisma generate`) → backend.
RUN pnpm --filter @kubepilot/contract build \
 && pnpm --filter @kubepilot/db build \
 && pnpm --filter @kubepilot/backend build

# ---- runtime: carry the built repo (keeps node_modules/.prisma intact) ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=builder /repo /repo
WORKDIR /repo/apps/backend
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
