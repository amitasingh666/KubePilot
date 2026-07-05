# syntax=docker/dockerfile:1
# Built from the REPO ROOT as context (it's a pnpm monorepo):
#   docker build -f apps/agent/Dockerfile -t kubepilot-agent:dev .

# ---- builder: install deps, build the agent + its workspace deps ----
FROM node:20-slim AS builder
RUN corepack enable
WORKDIR /repo

# Copy the whole workspace and install. (node_modules/dist are excluded via
# .dockerignore so we always build fresh from the lockfile.)
COPY . .
RUN pnpm install --frozen-lockfile

# The agent only depends on @kubepilot/contract — build that, then the agent.
RUN pnpm --filter @kubepilot/contract build \
 && pnpm --filter @kubepilot/agent build

# Produce a self-contained /app: the agent + ONLY its production deps, with a
# real (symlink-free) node_modules — ideal for copying into a slim runtime image.
RUN pnpm --filter=@kubepilot/agent deploy --prod --legacy /app

# ---- runtime: minimal image that just runs the built agent ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
# Run as the non-root `node` user baked into the base image.
USER node
CMD ["node", "dist/index.js"]
