# KubePilot — Phase 6 Hardening & Launch Checklist

**Status legend:** ✅ done (code + verified) · 🟡 partial (core done, scale/ops remains) · ⚙️ operational (environment/config, not application code)

This tracks the Phase 6 items. Some are application code (built + tested in this repo);
others are deployment/operational concerns that can only be *done* in a real
environment. Each is marked honestly.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Multi-tenant isolation | ✅ | `packages/db/scoped.ts` + `apps/backend/src/hardening.test.ts` |
| 2 | Token rotation / revocation | ✅ | `apps/backend/src/clusters.ts` + hardening tests |
| 2b | mTLS drills at scale | ⚙️ | infra (ingress mTLS termination) |
| 3 | Audit logging | ✅ | `AuditLog` table + `auth/audit.ts` |
| 3b | Encryption at rest | ⚙️ | managed DB / S3 config |
| 4 | Load / scale testing | ⚙️ | needs a load environment |
| 5 | Ingestion idempotency / replay | ✅ (idempotency) · 🟡 (scale replay) | unique `ingestion_snapshot` key + hardening test |
| 6 | Platform observability | 🟡 | `/metrics` + request logging; full OTel is ⚙️ |
| 7 | Beta validation vs manual review | ⚙️ (process) | feedback loop makes accuracy *measurable* (Phase 5) |

---

## ✅ Done in code (with tests)

### 1. Multi-tenant isolation
Enforced at the application layer by `forTenant(tenantId)` (a Prisma client
extension): reads inject `where.tenantId`, writes stamp it, and unsafe single-row
ops are refused on tenant models. **Regression-tested** in `hardening.test.ts`
(cross-tenant read/write blocked, auto-stamp, forbidden ops).
> Production hardening: adopt Postgres **RLS** as a DB-level backstop (deferred — see
> `07-Database-Schema.md §14`). RLS makes isolation hold even if app code forgets a filter.

### 2. Token rotation / revocation
`rotateClusterToken` issues a new token and puts the old one in a grace window;
`verifyAgentToken` rejects revoked/expired tokens. Tested end-to-end.

### 3. Audit logging
`AuditLog` records security-sensitive actions (login, logout, cluster create, token
rotate) with actor, target, and IP. Readable via `audit.list` (owner/admin only).

### 6. Observability (core)
`/metrics` exposes Prometheus counters (`http_requests_total` by route/status);
Fastify structured request logging is on. Health/readiness at `/health` `/ready`.

---

## ⚙️ Operational — how to complete in a real environment

### Encryption at rest
- **Postgres/Timescale:** enable storage encryption on the managed instance (RDS/Cloud SQL
  encryption, or `pgcrypto` for column-level on sensitive fields). Agent tokens are already
  stored **hashed** (SHA-256), never plaintext.
- **Object storage:** enable SSE (S3 default encryption / MinIO KES). Reports contain only
  aggregate cost data, no secrets.
- **Verify:** confirm `Encrypted: true` on the DB instance and bucket default-encryption.

### mTLS drills at scale
Terminate mTLS at the ingress (or app) for the `/ingest` path; store the client-cert
fingerprint per cluster alongside the token hash. Drill: rotate/revoke at N clusters,
confirm old certs are rejected within the grace window.

### Load / scale testing
Target: hundreds of services, many clusters, thousands of workloads per tenant.
- Seed synthetic tenants/clusters/workloads + usage; drive `/ingest` and the dashboard API
  with k6/Artillery.
- Watch: ingestion queue depth, analysis job duration, dashboard p95 (< 2s NFR), Timescale
  cardinality. If per-tenant series outgrow Timescale → the **ClickHouse** decision.

### Ingestion replay at scale
Idempotency is proven (unique `(clusterId, idempotencyKey)` + worker P2002 dedupe). Remaining:
drill agent disconnect/reconnect with buffered replay and duplicate floods; confirm
at-least-once delivery without double-writes.

### Full observability (OTel → Grafana)
Instrument ingest/worker/engine with the OpenTelemetry Node SDK → Tempo (traces),
Prometheus (metrics), Loki (logs). The `/metrics` endpoint is the local placeholder.

### Beta validation vs manual review
Compare recommendations against expert manual review on real clusters; tune thresholds
(headroom, min-reduction, data-sufficiency windows) and confirm the ≥90% accuracy KPI —
now **measurable** via the Phase 5 feedback loop (`optimization_outcome` + `feedback.summary`).
