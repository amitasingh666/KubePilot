# syntax=docker/dockerfile:1
# Built from the REPO ROOT (pnpm monorepo):
#   docker build -f apps/frontend/Dockerfile -t kubepilot-frontend:dev .
#
# Builds the SPA and serves it with nginx. API routing (/trpc, /ingest → backend)
# is handled by the Kubernetes Ingress, so nginx only serves static + SPA fallback.

FROM node:20-slim AS builder
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# The frontend's typecheck imports the backend AppRouter type, which references
# Prisma types — so the db client must be generated first.
RUN pnpm --filter @kubepilot/contract build \
 && pnpm --filter @kubepilot/db build \
 && pnpm --filter @kubepilot/frontend build

FROM nginx:alpine AS runtime
COPY --from=builder /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
