# KubePilot — Technology Stack

**Version:** 1.0
**Companion to:** `01-PRD.md`, `02-Architecture.md` (v2.0), `03-Task-Breakdown.md` (v2.0)
**Guiding principles:** lightweight · easy to integrate · one language where sensible
(TypeScript) · managed services over self-hosted · best-fit tool per component.

> **⚠️ Decision update (2026-07) — RLS deferred.** Tenant isolation is now enforced by
> **application-layer scoping** (queries filter by `tenant_id`), not Postgres Row-Level Security.
> RLS is deferred as a recommended production-hardening step. Read RLS mentions below as the
> *future/production* design, not current behavior.

> **How to read this:** each component lists a **Pick** (what to build with), **Why**, and a
> **Lightweight alternative** for when you want to move even faster or cut a dependency. The
> default posture is *boring, managed, TypeScript-first* — reach for a different language only
> where it clearly pays off (noted explicitly).

---

## 0. Stack at a glance

| Component | Pick | Lightweight alternative |
|---|---|---|
| Language (all backend + agent) | **TypeScript (Node 20 LTS)** | — |
| In-cluster agent | **Node/TS + `@kubernetes/client-node` + Helm chart** | Go binary (only if footprint critical) |
| Ingestion API | **Fastify** | Hono |
| Queue + workers | **BullMQ on Redis** | pg-boss (Postgres-only, no Redis) |
| Recommendation engine | **Node/TS worker + custom rules** | — |
| Bin-packing simulator | **TS module (First-Fit-Decreasing)** | Reuse k8s scheduler-sim concepts |
| Cost engine | **Node/TS + pricing/billing importers** | — |
| Public API | **Fastify + tRPC (or REST + OpenAPI)** | GraphQL (only if client demands) |
| Dashboard | **React + Vite + TanStack Query + shadcn/ui + Recharts** | Next.js (if SSR/SEO needed) |
| Relational DB | **PostgreSQL 16** (managed); app-layer tenant scoping, RLS deferred | — |
| Time-series | **TimescaleDB (Postgres ext.)** | ClickHouse (only at high cardinality) |
| ORM / query | **Prisma** (app-layer tenant scoping) | Drizzle ORM |
| Cache / sessions | **Redis** (separate instance from queue) | — |
| Object storage | **S3-compatible** (AWS S3 / Cloudflare R2 / MinIO) | — |
| Auth (users) | **OIDC via Auth0 / WorkOS / Keycloak** | Ory / Clerk |
| Agent auth | **Rotatable token + mTLS + signed payloads** | — |
| Reports (PDF/CSV) | **Playwright (PDF) + fast-csv** | Puppeteer / node PDF libs |
| Scheduling | **BullMQ repeatable jobs** | node-cron (single-instance only) |
| Observability | **OpenTelemetry → Grafana stack (Prometheus/Loki/Tempo)** | Grafana Cloud / Datadog |
| Infra / deploy | **Kubernetes + Helm + Argo CD (GitOps)** | Kustomize + plain CI |
| CI/CD | **GitHub Actions** | — |
| Validation (shared) | **Zod** (contract + runtime validation) | — |
| Monorepo tooling | **pnpm workspaces + Turborepo** | npm workspaces |

---

## 1. Language & shared foundation

**Pick: TypeScript on Node 20 LTS, end to end (agent + backend + frontend).**
- **Why:** one language across agent, services, and UI → shared types, shared validation,
  smaller team, faster iteration. The ingestion contract can be a **single Zod schema**
  imported by both agent and backend, so the contract can never drift silently.
- **Shared packages (monorepo):** `packages/contract` (Zod schemas + types),
  `packages/pricing`, `packages/binpack`. Managed with **pnpm workspaces + Turborepo** for
  fast, cached builds.
- **When to deviate:** the in-cluster agent *could* be a Go binary for a smaller memory/CPU
  footprint and single static binary. Keep it TS for v1 (speed of development, shared
  contract); revisit Go only if agent footprint becomes a customer objection.

---

## 2. In-cluster Agent (must be genuinely lightweight)

**Pick: Node/TS Deployment, packaged as a Helm chart, using `@kubernetes/client-node`.**
- **K8s access:** `@kubernetes/client-node` (official client) with a **read-only RBAC
  ServiceAccount**.
- **Prometheus access:** plain HTTP PromQL client (`axios`/`undici`) with **self-throttling**
  (p-limit for query concurrency + range caps).
- **Local summarization:** compute workload-level rollups (CPU p95, memory MAX) in-process —
  small in-memory math, no heavy deps.
- **Egress:** `undici` for outbound HTTPS; mTLS via Node's native TLS.
- **Packaging:** distroless Node base image; set tight resource requests/limits so the agent
  itself is a good FinOps citizen.
- **Why not Go for v1:** shared Zod contract + team velocity outweigh the footprint win at this
  stage. Keep the option open.

---

## 3. Ingestion API (high-throughput, thin)

**Pick: Fastify.**
- **Why:** one of the fastest Node HTTP frameworks, first-class schema-based validation
  (pairs with Zod via `fastify-type-provider-zod`), low overhead — ideal for a hot ingest path
  that just authenticates, validates, and enqueues.
- **Auth/security:** verify per-cluster token + **mTLS** (terminate mTLS at the app or at an
  ingress that forwards the client cert) + **HMAC payload signature**; per-cluster rate limit
  via `@fastify/rate-limit`.
- **Alternative: Hono** — even lighter, edge-friendly; choose if you want the smallest possible
  runtime. Fastify wins on ecosystem/plugins for v1.

---

## 4. Queue + Ingestion Workers

**Pick: BullMQ on a dedicated, AOF-persisted Redis.**
- **Why:** mature, TS-native, supports retries/backoff, rate limiting, repeatable (cron) jobs,
  and idempotency-friendly job IDs — a clean fit for at-least-once ingestion and for scheduling
  the recommendation engine. Keep the **queue Redis separate** from the cache/session Redis to
  bound blast radius.
- **Workers:** plain Node/TS processes scaled horizontally; dedupe by the ingestion
  **idempotency key**.
- **Lightweight alternative: pg-boss** — a Postgres-backed queue. Pick this if you want to
  **avoid running Redis entirely** early on (one less moving part); trade-off is lower
  throughput ceiling than Redis/BullMQ.

---

## 5. Recommendation Engine + Bin-packing Simulator

**Pick: Node/TS worker (triggered by BullMQ repeatable jobs), with a custom rules module and an
in-repo bin-packing simulator.**
- **Rules:** deterministic TS functions (CPU p95+headroom, memory MAX+headroom, replica, idle
  node, cleanup) — pluggable so ML can augment later.
- **Bin-packing simulator (`packages/binpack`):** implement **First-Fit-Decreasing** with
  constraint checks (affinity/anti-affinity, taints/tolerations, topology spread, PVC affinity,
  DaemonSet overhead, PDBs, GPU). This is pure computation — no external service needed.
- **Why TS here too:** the simulator operates on the same typed inventory objects the workers
  produce; keeping it in TS avoids a cross-language boundary. If profiling later shows the
  simulator is a bottleneck at scale, extract it to a **Go/Rust** microservice behind a simple
  RPC — but only if measured.
- **Scheduling:** per-tenant **sharded** BullMQ jobs (fairness), not a single global cron.

---

## 6. Cost Engine

**Pick: Node/TS module + billing/pricing importers.**
- **Effective pricing (not list):** importers for **AWS CUR**, **GCP billing export**, and
  **Azure cost export** (start with one cloud). Store effective rates + per-tenant negotiated
  overrides in Postgres.
- **List-price fallback:** cloud pricing APIs / static catalogs when billing import isn't
  connected — clearly labeled as estimate.
- **Compute:** node-level savings from the optimization plan (`baseline − simulated`), plus a
  **storage (per-GB-month) catalog** for PVC cleanup. Pure TS; no special framework.

---

## 7. Public API (dashboard backend)

**Pick: Fastify + tRPC.**
- **Why tRPC:** end-to-end type safety between the React dashboard and the API with **zero
  codegen and zero schema drift** — the fastest way to ship a typed internal API for a
  single first-party frontend. Enforce **tenant scoping + Postgres RLS** on every procedure.
- **If you need a public/partner API or non-TS clients:** expose **REST + OpenAPI** (Fastify
  has native schema→OpenAPI). Add **GraphQL only** if a consumer genuinely needs flexible
  querying — it's heavier and not warranted for v1's own dashboard.

---

## 8. Dashboard (Frontend)

**Pick: React + Vite + TypeScript, with:**
- **Data fetching:** **TanStack Query** (caching, background refetch) over the **tRPC** client.
- **UI kit:** **shadcn/ui + Tailwind CSS** — lightweight, copy-in components, no heavy design-
  system runtime; fast to build a clean FinOps dashboard.
- **Charts:** **Recharts** (simple, React-native) for cost/utilization; **ECharts** if you need
  denser, high-performance visualizations later.
- **Auth:** OIDC login (see §11) with role-based routing.
- **Why Vite over Next.js:** the dashboard is an authenticated SPA behind login — no SEO/SSR
  need — so Vite gives a simpler, lighter build. **Choose Next.js only** if you later want SSR,
  marketing pages, or edge rendering in the same app.

---

## 9. Databases

**Relational — Pick: PostgreSQL 16 (managed: RDS / Cloud SQL / Neon).**
- One engine to run. Holds tenants, users, clusters, inventory, constraints, autoscalers,
  recommendations, plans, cost configs, audit.
- **Tenant isolation:** application-layer scoping (every query filters by `tenant_id`).
  **Row-Level Security is deferred** as a production-hardening step (see the banner at the top).

**Time-series — Pick: TimescaleDB (Postgres extension).**
- **Why:** keeps v1 on **one database engine** (Postgres skills, backups, tooling). Aggregate
  usage at **workload level** to keep cardinality bounded.
- **Migrate to ClickHouse only** if per-tenant series counts outgrow Timescale — it's a
  deliberate later decision, not a day-1 dependency.

**ORM — Pick: Prisma** (chosen for its schema/migration DX and team familiarity).
- **Tenant scoping:** every query filters by `tenant_id` in the data-access layer (a shared
  scoped-client / repository helper), so no query forgets it. Runtime services connect as the
  non-superuser `kubepilot_app` role; migrations/seed use the superuser.
- **Timescale:** hypertables / continuous aggregates aren't expressible in `schema.prisma`,
  so they live in **raw-SQL migrations** alongside Prisma Migrate (same as they would with any ORM).
- **Deferred — RLS:** if/when we harden for production, Prisma can enforce Postgres RLS via a
  **Client Extension** that runs `SELECT set_config('app.tenant_id', <uuid>, true)` per
  transaction (this makes the DB enforce isolation even if app code forgets a filter). Not
  implemented in v1.
- **Alternative: Drizzle ORM** — lighter runtime and more first-class RLS ergonomics.

**Cache / sessions — Redis** (separate instance from the BullMQ queue).

**Object storage — S3-compatible:** AWS S3, or **Cloudflare R2** (no egress fees) for reports.
MinIO for local/dev.

---

## 10. Reporting (PDF / CSV)

**Pick: Playwright for PDF, fast-csv for CSV.**
- Render report HTML (reuse dashboard components) → **Playwright** `page.pdf()` for pixel-good
  PDFs; **fast-csv** for streaming CSV exports. Store outputs in object storage.
- **Scheduling & email digests:** BullMQ repeatable jobs + a transactional email provider
  (**Resend** or AWS SES).

---

## 11. Authentication

**Users — Pick: OIDC via a managed IdP.**
- **WorkOS** (best for enterprise SSO/SAML + SCIM, easy integration) or **Auth0**; **Keycloak**
  or **Ory** if you must self-host. This offloads SSO/OIDC, MFA, and org management — big
  lightweight win for a B2B SaaS.
- Map IdP identities to RBAC roles (Owner, Admin, Viewer, FinOps).

**Agents — rotatable per-cluster token + mTLS + HMAC-signed payloads** (custom, in the
ingestion path). Store `token_hash` + mTLS fingerprint per cluster.

---

## 12. Observability (self-monitoring)

**Pick: OpenTelemetry SDK (Node) → Grafana stack.**
- **Traces:** OTel → **Tempo**; **Metrics:** Prometheus; **Logs:** **Loki**; dashboards +
  alerting in **Grafana**. Instrument the ingest path, workers, and engine.
- **Lightweight/managed alternative:** **Grafana Cloud** (or Datadog) so you don't run the
  observability stack yourself early on.

---

## 13. Infrastructure, Deployment & CI/CD

- **Runtime:** KubePilot's own **Kubernetes** cluster (EKS/GKE/AKS managed).
- **Packaging & deploy:** **Helm** for services + the customer agent chart; **Argo CD** for
  GitOps deployment of the platform (and it makes the team dogfood the GitOps-aware patch
  story). Kustomize + plain CI is the lighter alternative.
- **CI/CD:** **GitHub Actions** — build, test, lint, publish images + the agent Helm chart to a
  versioned Helm repo (OCI registry). Environment promotion dev → staging → prod.
- **IaC:** **Terraform** (or Pulumi in TS if you want IaC in the same language) for managed
  Postgres/Timescale, Redis, object storage, DNS.
- **Secrets:** cloud secrets manager (AWS Secrets Manager / GCP Secret Manager) + External
  Secrets Operator in-cluster.

---

## 14. Summary: why this stack stays lightweight & easy to integrate
- **One language (TS) + one shared Zod contract** → no cross-language glue, no contract drift.
- **One primary database engine (Postgres/Timescale)** for v1 → fewer things to operate.
- **Managed everything possible** (DB, Redis, object store, IdP, observability) → minimal ops.
- **Fastify + tRPC + Vite/React** → typed end-to-end with near-zero boilerplate.
- **Clear "escape hatches"** (Go agent, ClickHouse, Go/Rust binpack, GraphQL, Next.js) that are
  *deferred, measured decisions* — you adopt them only when a real limit is hit, not upfront.
</content>
