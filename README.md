# KubePilot

Multi-tenant SaaS for Kubernetes cost optimization (FinOps). See [`docs/`](./docs) for the
PRD, architecture, schema, and phased plan.

This repo is a **pnpm + Turborepo monorepo** (TypeScript end to end).

## Layout

```
apps/
  agent/      # in-cluster agent (Phase 0 stub → real collection in Phase 1)
  backend/    # Fastify service: health/ready now; ingestion + API later
  frontend/   # React + Vite dashboard (placeholder → Phase 4)
packages/
  contract/   # shared Zod ingestion contract v2 (imported by agent + backend)
  db/         # Prisma schema + migrations + RLS-aware client
helm/         # agent Helm chart (Phase 1)
infra/        # cloud IaC (later); local dev uses docker-compose.yml
docs/         # product & engineering docs
```

## Prerequisites
- Node 20 (`.nvmrc`), pnpm 10, Docker (with `docker-compose`).

## Quick start (Phase 0)

```bash
cp .env.example .env
pnpm install
pnpm infra:up          # Postgres+Timescale, 2x Redis, MinIO (docker-compose)
pnpm db:generate       # generate Prisma client
pnpm db:migrate        # apply migrations (base tables + extensions + RLS + app role)
pnpm db:seed           # seed two demo tenants
pnpm db:verify-rls     # prove tenant isolation is enforced by Postgres RLS
pnpm build             # build all packages/apps
pnpm typecheck         # typecheck everything
```

Run the backend and check it:

```bash
pnpm --filter @kubepilot/backend dev
curl localhost:3001/health
curl localhost:3001/ready     # 200 when DB + both Redis are reachable
```

## Multi-tenancy & RLS
Tenant isolation is enforced by **Postgres Row-Level Security**. Runtime services connect as
the non-superuser `kubepilot_app` role (`APP_DATABASE_URL`); migrations/seed use the superuser
(`DATABASE_URL`). Always access tenant data via `forTenant(tenantId)` from `@kubepilot/db`,
which sets `app.tenant_id` per transaction so RLS filters every query. `pnpm db:verify-rls`
proves cross-tenant reads are blocked.

## Environments / secrets
Config is per-environment via `.env` (validated at startup with Zod). `.env` is gitignored;
`.env.example` documents every variable. In cloud environments these come from a secrets
manager (later phase).
