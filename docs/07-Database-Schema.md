# KubePilot — Database Schema Design

**Version:** 1.0
**Companion to:** `02-Architecture.md` (v2.0), `06-Tech-Stack.md`
**Engines:** PostgreSQL 16 (relational; app-layer tenant scoping · RLS deferred) + TimescaleDB extension (usage time-series)
**Scope:** v1 tables **plus** forward-compatible structures for every PRD future-scope item
(ML recs, forecasting, budgets/alerts, incident RCA, AI assistant, write-back with approval).

> **⚠️ Decision update (2026-07) — RLS deferred.** This project uses **application-layer tenant
> scoping** (every query filters by `tenant_id` in the data-access layer) as its tenant-isolation
> mechanism. **Postgres Row-Level Security (RLS) is deferred as a recommended production-hardening
> step and is not implemented.** §14 and every mention of RLS policies, `FORCE ROW LEVEL
> SECURITY`, `forTenant()` / `SET LOCAL app.tenant_id`, or `app_current_tenant()` describe the
> *future/production* design, not current behavior. The `tenant_id` column on every table stays —
> app-layer scoping relies on it.

> **How this doc is organized:** §1 design principles → §2 conventions → §3–§12 schema by
> domain (DDL + notes) → §13 TimescaleDB specifics → §14 RLS → §15 indexing → §16 future-scope
> tables → §17 ERD overview. DDL is illustrative (Postgres dialect); column lists favor clarity
> over exhaustiveness.

---

## 1. Design principles
1. **Tenant-first.** Every tenant-owned row carries `tenant_id`; **Row-Level Security** is the
   isolation boundary, not app code alone. `cluster_id` implies a tenant but `tenant_id` is
   denormalized onto child tables so RLS is a single, cheap predicate everywhere.
2. **Current state vs history.** Inventory tables hold the **latest known state** per object
   (fast dashboard reads). Change history that matters (spec/request/replica changes — needed by
   the feedback loop) is append-only in `*_revision` tables. High-volume usage lives in
   **TimescaleDB hypertables**, never in the relational inventory tables.
3. **Aggregate at workload level.** Usage series are keyed by workload (+ node), **not** by
   ephemeral pod, to keep cardinality bounded.
4. **Idempotent ingestion.** Every snapshot is recorded with its idempotency key; workers
   upsert, so at-least-once delivery never double-counts.
5. **One reconciled plan owns savings.** `optimization_plan` holds the single node-level savings
   number; `recommendation` rows *contribute* to a plan (no per-rec dollar summing).
6. **Extensible by design.** `source` columns (rule vs ML), `jsonb` detail columns, and
   status-lifecycle enums let future scope (ML, write-back, forecasting) slot in **without
   breaking v1 rows**. Future-scope tables (§16) are drawn now so foreign keys are stable later.
7. **Soft lifecycle, hard audit.** Status enums + `archived_at` over hard deletes for
   business objects; `audit_log` is append-only and immutable.

---

## 2. Conventions
- **PK:** `id uuid primary key default gen_random_uuid()` (via `pgcrypto`).
- **Timestamps:** `created_at timestamptz not null default now()`, `updated_at timestamptz`.
- **Tenant column:** `tenant_id uuid not null references tenant(id)` on every tenant-owned table.
- **Enums:** Postgres `CREATE TYPE ... AS ENUM` for stable sets; `text + CHECK` where values
  will grow often. (Shown inline below.)
- **JSONB:** used for open-ended, schema-flexible detail (`labels`, `spec_json`, rule inputs).
- **Money:** store as `numeric(14,6)` in a canonical currency (USD) + `currency` code; rates are
  hourly unless suffixed `_monthly`.

```sql
create extension if not exists pgcrypto;
create extension if not exists timescaledb;
```

---

## 2A. Build tiers & table roles (read this first)

There look like a lot of tables, but you don't build them all at once. Every table is tagged
**T1 / T2 / T3** below and again on its section heading.

- **T1 — Core v1 (build first, Phases 0–3):** the ~12 tables that make the main loop work.
- **T2 — v1 supporting (build as features land, Phases 1–5):** make v1 *safe & correct* (the
  safety/feasibility tables) and *fast* (rollups), plus auth extras and reporting.
- **T3 — Future scope (do NOT build yet):** empty in v1, defined only so foreign keys and RLS
  stay stable when those features arrive. Skip until you start that feature.

> Mental model — each table answers one question, in order:
> **who** (`tenant`,`app_user`,`membership`) → **connected what** (`cluster`,`agent_credential`)
> → **running what** (`node`,`workload`,…safety tables) → **using how much** (`usage_metric_*`,
> `stability_event`) → **so we advise** (`optimization_plan`,`recommendation`,`recommendation_patch`)
> → **worth how much** (`pricing_catalog`,`cost_rollup`) → **did it work** (`workload_revision`,
> `recommendation_outcome`).

| Table | Tier | Why it exists | Where it's used (writes → reads) |
|---|---|---|---|
| `tenant` | **T1** | The customer company; root of all data + isolation | signup → every query (RLS) |
| `app_user` | **T1** | A person who logs in | signup/invite → Auth, dashboard |
| `membership` | **T1** | Links user↔tenant with a **role** (permissions) | invite → Auth on every request |
| `cluster` | **T1** | One connected group of computers | connect + agent heartbeat → dashboard, engine |
| `agent_credential` | **T1** | Hashed, rotatable token the agent authenticates with | connect/rotate → Ingestion API |
| `node` | **T1** | Each server — **what actually costs money** | ingestion workers → bin-pack sim, cost engine |
| `workload` | **T1** | Each app + its reservations + autoscaler flag | ingestion workers → recommendation engine |
| `usage_metric_workload` | **T1** | What each app really used (vs reserved = waste) | ingestion workers → recommendation engine |
| `optimization_plan` | **T1** | One run per cluster; **the single honest $ total** | engine → dashboard, cost engine |
| `recommendation` | **T1** | Each piece of advice | engine → dashboard; feedback updates |
| `recommendation_patch` | **T1** | The copy-paste snippet per recommendation | engine → dashboard (user copies) |
| `pricing_catalog` | **T1** | Real (discounted) prices → turns resources into $ | pricing/billing import → cost engine |
| `container_spec` | **T2** | Per-container reservations behind a workload | workers → engine (per-container sizing) |
| `workload_revision` | **T2** | History of spec changes → detect "advice applied" | workers append → feedback loop |
| `scheduling_constraint` | **T2** | Where apps can/can't run → **safe drain checks** | workers → bin-pack simulator |
| `autoscaler` | **T2** | HPA/VPA/KEDA → don't fight existing autoscalers | workers → engine (rule gating) |
| `pod_disruption_budget` | **T2** | Customer's "don't disrupt >N" rules | workers → simulator |
| `pvc` | **T2** | Storage volumes → orphaned-volume cleanup | workers → engine |
| `k8s_service` | **T2** | Network services → zero-traffic cleanup | workers → engine |
| `usage_metric_node` | **T2** | Server busyness → idle-node detection | workers → engine |
| `stability_event` | **T2** | OOMKills/crashes → **never suggest a crash-causing cut** | workers → memory rule |
| `recommendation_outcome` | **T2** | Report card: applied? prediction right? (KPI) | feedback loop → analytics/dashboard |
| `ingestion_snapshot` | **T2** | Dedupe receipt (at-least-once safety) | Ingestion API/workers |
| `cost_rollup` | **T2** | Pre-summed costs for fast dashboard reads | cost engine → dashboard |
| `storage_catalog` | **T2** | Storage prices (separate from compute) | pricing import → cost engine |
| `billing_import` | **T2** | Raw cloud bill → real discounted rates | importer → feeds `pricing_catalog` |
| `report` | **T2** | Generated PDF/CSV reports | reporting → dashboard |
| `audit_log` | **T2** | Immutable diary for trust/compliance | everything appends → admins |
| `sso_connection` | **T2** | Per-tenant enterprise SSO config | settings → Auth |
| `api_key` | **T2** | Programmatic API access | settings → Public API |
| `ml_model` | **T3** | Future ML-based recommendations | — (empty in v1) |
| `budget` | **T3** | Future budgets | — |
| `cost_forecast` | **T3** | Future spend forecasting | — |
| `alert_rule` / `alert_event` | **T3** | Future budget/anomaly alerts | — |
| `incident` | **T3** | Future incident root-cause analysis | — |
| `chat_session` / `chat_message` | **T3** | Future AI Kubernetes assistant | — |
| `change_request` / `approval` / `automation_policy` | **T3** | Future auto-apply *with approval* (write-back) | — |

---

## 3. Identity, Tenancy & Access &nbsp;·&nbsp; `tenant` T1 · `app_user` T1 · `membership` T1 · `sso_connection` T2 · `api_key` T2

```sql
create type user_role as enum ('owner','admin','viewer','finops');

create table tenant (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  data_region   text not null default 'us',          -- residency (GDPR/enterprise)
  billing_plan  text,                                 -- packaging model
  status        text not null default 'active',       -- active|suspended|archived
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create table app_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text,
  idp_subject   text,                                 -- OIDC 'sub'
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique (email)
);

-- A user may belong to multiple tenants (agencies/MSPs) → membership join table.
create table membership (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  role       user_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table sso_connection (                          -- per-tenant SSO/OIDC config
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  provider    text not null,                           -- workos|auth0|okta|azuread...
  config_json jsonb not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

create table api_key (                                 -- programmatic access to Public API
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  key_hash    text not null,                           -- store hash only
  scopes      text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
```

---

## 4. Clusters, Agents & Ingestion &nbsp;·&nbsp; `cluster` T1 · `agent_credential` T1 · `ingestion_snapshot` T2

```sql
create type cluster_status as enum ('pending','connected','stale','disconnected','archived');

create table cluster (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  name            text not null,
  provider        text,                                -- aws|gcp|azure|onprem
  region          text,
  distribution    text,                                -- eks|gke|aks|openshift|k3s...
  autoscaler      text,                                -- none|cluster-autoscaler|karpenter
  prometheus_flavor text,                              -- kube-prometheus-stack|custom (compat probe)
  gitops          text,                                -- none|argocd|flux
  status          cluster_status not null default 'pending',
  last_seen_at    timestamptz,
  agent_version   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  unique (tenant_id, name)
);

-- Rotatable per-cluster credentials; multiple active during rotation.
create table agent_credential (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  cluster_id      uuid not null references cluster(id) on delete cascade,
  token_hash      text not null,                       -- opaque bearer token (hash only)
  mtls_fingerprint text,
  status          text not null default 'active',      -- active|rotating|revoked
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- Idempotency ledger: dedupe at-least-once delivery. Workers upsert here first.
create table ingestion_snapshot (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant(id) on delete cascade,
  cluster_id       uuid not null references cluster(id) on delete cascade,
  idempotency_key  text not null,                      -- (cluster,target,win_start,win_end,agent_ver)
  agent_version    text not null,
  payload_kind     text not null,                      -- inventory|usage|autoscalers|events
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  status           text not null default 'received',   -- received|processed|failed
  unique (cluster_id, idempotency_key)
);
```

---

## 5. Cluster Inventory (current state) &nbsp;·&nbsp; `node` T1 · `workload` T1 · `container_spec` T2 · `workload_revision` T2 · `scheduling_constraint` T2 · `autoscaler` T2 · `pod_disruption_budget` T2 · `pvc` T2 · `k8s_service` T2

All inventory tables carry `tenant_id` + `cluster_id`, and a `last_seen_at` so stale objects can
be aged out. Full raw spec kept in `spec_json` (secrets already stripped by the agent).

```sql
create table node (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  cluster_id    uuid not null references cluster(id) on delete cascade,
  name          text not null,
  node_group    text,                                  -- nodepool / ASG / karpenter pool
  instance_type text,
  capacity_provider text,                              -- on-demand|spot|preemptible
  cpu_capacity_m       integer,                        -- millicores
  mem_capacity_bytes   bigint,
  cpu_allocatable_m    integer,                        -- capacity - kube/system reserved
  mem_allocatable_bytes bigint,
  taints_json   jsonb,
  labels_json   jsonb,
  status        text,                                  -- ready|notready|cordoned
  last_seen_at  timestamptz not null default now(),
  unique (cluster_id, name)
);

create type workload_kind as enum
  ('deployment','statefulset','daemonset','cronjob','job','replicaset','rollout');

create table workload (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  cluster_id    uuid not null references cluster(id) on delete cascade,
  namespace     text not null,
  name          text not null,
  kind          workload_kind not null,
  replicas      integer,
  -- aggregate requests/limits across containers (per-container detail in container_spec)
  cpu_request_m        integer,
  cpu_limit_m          integer,
  mem_request_bytes    bigint,
  mem_limit_bytes      bigint,
  qos_class     text,                                  -- guaranteed|burstable|besteffort
  priority_class text,
  managed_by    text,                                  -- none|hpa|vpa|keda  (denormalized)
  gitops_owned  boolean not null default false,
  gitops_source jsonb,                                 -- repo/path/app for PR-style patches
  labels_json   jsonb,
  spec_json     jsonb,
  last_seen_at  timestamptz not null default now(),
  archived_at   timestamptz,
  unique (cluster_id, namespace, name, kind)
);

create table container_spec (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  workload_id   uuid not null references workload(id) on delete cascade,
  container     text not null,
  cpu_request_m integer, cpu_limit_m integer,
  mem_request_bytes bigint, mem_limit_bytes bigint,
  unique (workload_id, container)
);

-- Append-only history of spec changes → powers the feedback loop (detect "applied") & drift.
create table workload_revision (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  workload_id   uuid not null references workload(id) on delete cascade,
  observed_at   timestamptz not null default now(),
  replicas      integer,
  cpu_request_m integer, mem_request_bytes bigint,
  cpu_limit_m   integer, mem_limit_bytes bigint,
  spec_hash     text                                   -- cheap change detection
);

create table scheduling_constraint (                   -- for bin-packing feasibility
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  workload_id   uuid not null references workload(id) on delete cascade,
  node_selector jsonb, affinity jsonb, anti_affinity jsonb,
  tolerations   jsonb, topology_spread jsonb, pvc_affinity jsonb
);

create table autoscaler (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  cluster_id    uuid not null references cluster(id) on delete cascade,
  workload_id   uuid references workload(id) on delete cascade,
  kind          text not null,                         -- hpa|vpa|keda
  min_replicas  integer, max_replicas integer,
  metric        text,                                  -- cpu|memory|custom|external
  target_json   jsonb,                                 -- e.g. averageUtilization:60
  update_mode   text,                                  -- vpa: Off|Initial|Auto|Recreate
  spec_json     jsonb,
  last_seen_at  timestamptz not null default now()
);

create table pod_disruption_budget (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  cluster_id   uuid not null references cluster(id) on delete cascade,
  namespace    text, name text,
  min_available text, max_unavailable text,
  selector_json jsonb,
  last_seen_at timestamptz not null default now()
);

create table pvc (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  cluster_id   uuid not null references cluster(id) on delete cascade,
  namespace    text, name text,
  storage_class text, capacity_bytes bigint,
  volume_type  text,                                   -- gp3|io2|pd-ssd... (→ storage_catalog)
  bound        boolean, mounted boolean,               -- orphan detection
  last_seen_at timestamptz not null default now()
);

create table k8s_service (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  cluster_id   uuid not null references cluster(id) on delete cascade,
  namespace    text, name text, type text,             -- ClusterIP|LoadBalancer...
  has_traffic  boolean,                                -- zero-traffic detection
  last_seen_at timestamptz not null default now()
);
```

---

## 6. Usage Metrics & Stability Events (TimescaleDB) &nbsp;·&nbsp; `usage_metric_workload` T1 · `usage_metric_node` T2 · `stability_event` T2

```sql
-- Workload-level usage. Hypertable partitioned on ts. CPU as p95, memory as MAX per window.
create table usage_metric_workload (
  tenant_id     uuid not null,
  cluster_id    uuid not null,
  workload_id   uuid not null,
  ts            timestamptz not null,                  -- window end
  window_sec    integer not null,                      -- window length
  cpu_p95_m           integer,
  cpu_avg_m           integer,
  mem_max_bytes       bigint,                           -- MAX working set (for safe mem sizing)
  mem_avg_bytes       bigint,
  restarts            integer default 0
);
select create_hypertable('usage_metric_workload','ts', chunk_time_interval => interval '1 day');

create table usage_metric_node (
  tenant_id  uuid not null, cluster_id uuid not null, node_id uuid not null,
  ts timestamptz not null, window_sec integer not null,
  cpu_used_m integer, mem_used_bytes bigint,
  cpu_alloc_pct numeric(5,2), mem_alloc_pct numeric(5,2)  -- utilization for idle detection
);
select create_hypertable('usage_metric_node','ts', chunk_time_interval => interval '1 day');

-- OOMKills/restarts → memory guardrail + confidence input.
create table stability_event (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  cluster_id  uuid not null,
  workload_id uuid,
  ts          timestamptz not null,
  kind        text not null,                            -- oomkill|restart|evicted|crashloop
  detail_json jsonb
);
select create_hypertable('stability_event','ts', chunk_time_interval => interval '7 days');
```

See §13 for compression, retention, and continuous aggregates on these hypertables.

---

## 7. Recommendations & Optimization Plans &nbsp;·&nbsp; `optimization_plan` T1 · `recommendation` T1 · `recommendation_patch` T1 · `recommendation_outcome` T2

```sql
create type plan_status as enum ('draft','active','superseded','archived');
create type rec_type as enum
  ('cpu_rightsizing','mem_rightsizing','replica_optimization','hpa_min_tuning',
   'idle_node','pvc_cleanup','service_cleanup','stale_workload');
create type rec_status as enum
  ('open','preliminary','dismissed','snoozed','applied','expired','blocked');
create type rec_source as enum ('rule','ml','hybrid');       -- future: ML
create type patch_mode as enum ('imperative_kubectl','gitops_manifest');

-- One reconciled plan per cluster run → owns the single node-level savings number.
create table optimization_plan (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  cluster_id          uuid not null references cluster(id) on delete cascade,
  generated_at        timestamptz not null default now(),
  window_start        timestamptz, window_end timestamptz,
  baseline_node_cost_monthly  numeric(14,6),
  simulated_node_cost_monthly numeric(14,6),
  realized_savings_monthly    numeric(14,6),           -- baseline - simulated (node level)
  waste_gap_monthly           numeric(14,6),           -- informational Σ(request-usage)
  realizability      text,                             -- automatic|requires_manual_resize
  currency           text not null default 'USD',
  status             plan_status not null default 'active',
  detail_json        jsonb                             -- packed node set, sim assumptions
);

create table recommendation (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  cluster_id     uuid not null references cluster(id) on delete cascade,
  plan_id        uuid references optimization_plan(id) on delete set null,
  workload_id    uuid references workload(id) on delete cascade,
  node_id        uuid references node(id) on delete cascade,
  type           rec_type not null,
  source         rec_source not null default 'rule',
  status         rec_status not null default 'open',
  -- current vs proposed (nullable per type)
  current_json   jsonb not null,                       -- {cpu_req, mem_req, replicas...}
  proposed_json  jsonb not null,
  confidence     numeric(4,3),                         -- 0..1, defined score (see notes)
  confidence_factors jsonb,                            -- data_sufficiency, variance, stability...
  est_savings_monthly numeric(14,6),                   -- contribution (NOT summed into totals)
  rule_inputs_json jsonb,                              -- transparency: windows, percentiles used
  blocked_reason text,                                 -- 'pdb'|'anti_affinity'|'pvc'|'vpa_managed'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  expires_at     timestamptz                           -- re-validate against latest state
);

create table recommendation_patch (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  recommendation_id uuid not null references recommendation(id) on delete cascade,
  mode           patch_mode not null,
  content        text not null,                        -- kubectl cmd OR manifest diff
  target_ref     jsonb,                                -- gitops repo/path or k8s object ref
  validated_against_revision uuid references workload_revision(id),
  created_at     timestamptz not null default now()
);

-- Feedback loop: infer "applied" from later inventory, then score prediction vs actual.
create table recommendation_outcome (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  recommendation_id uuid not null references recommendation(id) on delete cascade,
  detected_applied_at timestamptz,                     -- from workload_revision diff
  applied_source text,                                 -- inferred|user_marked|writeback(future)
  predicted_json jsonb,                                -- expected usage/cost post-change
  actual_json    jsonb,                                -- observed after apply
  accuracy_score numeric(4,3),                         -- powers the ≥90% KPI
  oomkilled_after boolean default false,               -- safety regression signal
  evaluated_at   timestamptz
);
```

**Confidence** = f(data sufficiency, variance/periodicity, stability history, headroom margin,
autoscaler realizability). Stored both as a scalar (`confidence`) and its inputs
(`confidence_factors`) for transparency and later ML training.

---

## 8. Cost & Pricing &nbsp;·&nbsp; `pricing_catalog` T1 · `storage_catalog` T2 · `billing_import` T2 · `cost_rollup` T2

```sql
-- Effective compute pricing (not list). Time-ranged so historical cost stays reproducible.
create table pricing_catalog (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenant(id) on delete cascade,  -- null = global/list price
  provider      text not null, region text not null,
  instance_type text not null,
  capacity_provider text not null,                     -- on-demand|spot|ri|savings_plan|cud
  cpu_core_hour numeric(14,6), mem_gb_hour numeric(14,6),
  node_hour     numeric(14,6),                          -- whole-node rate (preferred)
  source        text not null,                          -- list|cur_import|negotiated
  effective_from timestamptz not null, effective_to timestamptz,
  created_at    timestamptz not null default now()
);

create table storage_catalog (                          -- PVC cleanup pricing
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references tenant(id) on delete cascade,
  provider     text, region text, volume_type text,
  gb_month     numeric(14,6),
  effective_from timestamptz not null, effective_to timestamptz
);

-- Raw billing import (CUR / GCP export / Azure export) for effective-rate reconciliation.
create table billing_import (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  provider     text not null, source_uri text,
  period_start date, period_end date,
  status       text not null default 'pending',        -- pending|imported|failed
  summary_json jsonb,
  imported_at  timestamptz
);

-- Precomputed cost rollups for fast dashboard reads (also a continuous-agg candidate).
create table cost_rollup (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  cluster_id   uuid not null references cluster(id) on delete cascade,
  scope        text not null,                          -- cluster|namespace|deployment
  scope_ref    text not null,
  period       date not null,                          -- daily/monthly bucket
  cost_monthly numeric(14,6), waste_monthly numeric(14,6),
  currency     text not null default 'USD',
  unique (tenant_id, cluster_id, scope, scope_ref, period)
);
```

---

## 9. Reporting & Audit &nbsp;·&nbsp; `report` T2 · `audit_log` T2

```sql
create table report (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  scope        text not null,                          -- cluster|namespace|deployment|org
  scope_ref    text,
  format       text not null,                          -- pdf|csv
  object_key   text,                                   -- S3/R2 location
  schedule_cron text,                                  -- null = one-off
  status       text not null default 'pending',
  created_by   uuid references app_user(id),
  created_at   timestamptz not null default now(),
  generated_at timestamptz
);

-- Append-only, immutable. No RLS DELETE/UPDATE policies (see §14).
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  actor_user  uuid references app_user(id),
  actor_kind  text not null default 'user',            -- user|system|agent|api_key
  action      text not null,                           -- rec.viewed|rec.dismissed|report.exported|token.rotated|writeback.approved...
  target_kind text, target_id uuid,
  detail_json jsonb,
  created_at  timestamptz not null default now()
);
```

---

## 10. Enumerated status lifecycles (reference)
- `cluster.status`: pending → connected ⇄ stale ⇄ disconnected → archived
- `recommendation.status`: open/preliminary → (dismissed | snoozed | applied | blocked | expired)
- `optimization_plan.status`: draft → active → superseded → archived
- `agent_credential.status`: active → rotating → revoked

---

## 11. Data lifecycle & retention
- **Usage hypertables:** compress chunks older than 7 days; retain raw ~30–90 days (enough for
  14–30 day windows + periodicity), keep **daily/weekly continuous aggregates** ~13 months for
  trends/forecasting. (§13)
- **Inventory:** aged out when `last_seen_at` exceeds a threshold (object gone) → `archived_at`.
- **audit_log / recommendation_outcome:** long retention (compliance / KPI history).
- **Per-tenant purge:** cascade from `tenant` for offboarding/GDPR erasure; residency honored via
  `tenant.data_region` routing.

---

## 12. Multi-region / residency
`tenant.data_region` drives which regional Postgres/Timescale a tenant's rows live in (row-level
routing at the app/connection layer, or per-region deployments). Global tables (list-price
`pricing_catalog` with `tenant_id = null`) may be replicated read-only to all regions.

---

## 13. TimescaleDB specifics

```sql
-- Compression (columnar) for old chunks.
alter table usage_metric_workload set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, workload_id',
  timescaledb.compress_orderby   = 'ts desc'
);
select add_compression_policy('usage_metric_workload', interval '7 days');
select add_retention_policy  ('usage_metric_workload', interval '90 days');

-- Continuous aggregate: daily rollup for dashboards & the recommendation engine's windows.
create materialized view usage_workload_daily
with (timescaledb.continuous) as
select tenant_id, cluster_id, workload_id,
       time_bucket('1 day', ts) as day,
       max(mem_max_bytes)       as mem_max_bytes,       -- MAX preserved for safe mem sizing
       percentile_cont(0.95) within group (order by cpu_p95_m) as cpu_p95_m,
       sum(restarts)            as restarts
from usage_metric_workload
group by tenant_id, cluster_id, workload_id, day;
select add_continuous_aggregate_policy('usage_workload_daily',
  start_offset => interval '30 days', end_offset => interval '1 hour',
  schedule_interval => interval '1 hour');
```
Notes: `segmentby` on `tenant_id` keeps tenant data physically grouped and RLS-friendly;
**memory rollup preserves MAX** (never averaged) so the OOM-safe sizing rule holds even off the
aggregate.

---

## 14. Tenant isolation

**Current (v1): application-layer scoping.** Every table carries `tenant_id`, and the
data-access layer adds `tenant_id = <current tenant>` to every read and sets it on every write
(via a shared scoped-client / repository helper). This is the isolation boundary today.

**Deferred (production hardening): Row-Level Security.** The RLS design below is **recommended
for production but not implemented** — it makes the *database* enforce isolation so a forgotten
`WHERE tenant_id` in app code can't leak data. Kept here as the target hardening step.

```sql
-- DEFERRED / production-hardening pattern (NOT applied in v1):
-- Pattern applied to EVERY tenant-owned table.
-- Pattern applied to EVERY tenant-owned table.
alter table workload enable row level security;
alter table workload force row level security;         -- applies to table owner too

create policy tenant_isolation on workload
  using      (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
```
- The API sets `SET LOCAL app.tenant_id = '<uuid>'` per request/transaction (from the
  authenticated session); Drizzle runs queries inside that transaction.
- **`FORCE` RLS** so even the app's DB role can't bypass it; a separate migration role manages DDL.
- **audit_log** gets a SELECT/INSERT-only policy (no UPDATE/DELETE) → immutability.
- Apply the same tenant predicate on the **Timescale** hypertables (isolation must not stop at
  the relational boundary).

---

## 15. Indexing strategy (high-value indexes)
- `membership (user_id)`, `membership (tenant_id, role)` — auth lookups.
- `cluster (tenant_id, status)`; `workload (cluster_id, namespace)`; `workload (managed_by)`.
- `recommendation (tenant_id, cluster_id, status, type)`; `recommendation (plan_id)`;
  `recommendation (workload_id)`.
- `ingestion_snapshot (cluster_id, idempotency_key)` unique — dedupe.
- `usage_metric_workload (tenant_id, workload_id, ts desc)` — engine reads (Timescale auto-indexes ts).
- `cost_rollup (tenant_id, cluster_id, scope, period)`.
- `audit_log (tenant_id, created_at desc)`; GIN on key `jsonb` columns queried by filter
  (`labels_json`, `detail_json`).

---

## 16. Future-scope tables (drawn now, populated later) &nbsp;·&nbsp; **ALL T3 — do not build in v1**

These are **defined up front** so foreign keys and RLS are stable when the features land. Empty
in v1; no impact on v1 queries.

```sql
-- 16.1 ML recommendations & model registry (recs already carry source='ml')
create table ml_model (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenant(id) on delete cascade,   -- null = global model
  name text not null, version text not null,
  kind text,                                                -- rightsizing|forecast|anomaly
  artifact_uri text, metrics_json jsonb,
  status text not null default 'shadow',                    -- shadow|active|retired
  trained_at timestamptz, created_at timestamptz not null default now()
);

-- 16.2 Cost forecasting & budgets/alerts
create table budget (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  scope text not null, scope_ref text,                      -- cluster|namespace|org
  amount_monthly numeric(14,6), currency text default 'USD',
  period text not null default 'monthly',
  created_at timestamptz not null default now()
);
create table cost_forecast (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  cluster_id uuid references cluster(id) on delete cascade,
  scope text, scope_ref text, horizon_days int,
  forecast_json jsonb,                                      -- points + confidence band
  model_id uuid references ml_model(id),
  generated_at timestamptz not null default now()
);
create table alert_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  kind text not null,                                       -- budget_breach|spend_spike|anomaly|oom_risk
  condition_json jsonb not null, channels jsonb,            -- email|slack|webhook
  budget_id uuid references budget(id),
  enabled boolean default true, created_at timestamptz not null default now()
);
create table alert_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  alert_rule_id uuid references alert_rule(id) on delete cascade,
  fired_at timestamptz not null default now(),
  status text default 'firing', payload_json jsonb
);

-- 16.3 Incident root-cause analysis
create table incident (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  cluster_id uuid references cluster(id) on delete cascade,
  started_at timestamptz, resolved_at timestamptz,
  severity text, summary text, rca_json jsonb, created_at timestamptz not null default now()
);

-- 16.4 AI Kubernetes assistant (chat over cluster state)
create table chat_session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  user_id uuid references app_user(id), cluster_id uuid references cluster(id),
  title text, created_at timestamptz not null default now()
);
create table chat_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  session_id uuid not null references chat_session(id) on delete cascade,
  role text not null,                                       -- user|assistant|tool
  content text, tool_calls_json jsonb, tokens int,
  created_at timestamptz not null default now()
);

-- 16.5 Write-back / automatic optimization WITH approval workflow
create type change_status as enum
  ('proposed','pending_approval','approved','rejected','applying','applied','failed','rolled_back');
create table change_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  cluster_id uuid not null references cluster(id) on delete cascade,
  plan_id uuid references optimization_plan(id),
  recommendation_id uuid references recommendation(id),
  status change_status not null default 'proposed',
  patch_content text, patch_mode patch_mode,
  requested_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create table approval (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  change_request_id uuid not null references change_request(id) on delete cascade,
  approver uuid references app_user(id),
  decision text not null,                                   -- approve|reject
  comment text, decided_at timestamptz not null default now()
);
create table automation_policy (                             -- guardrails for auto-apply
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  scope text, scope_ref text,
  auto_apply boolean default false,
  max_change_pct int,                                        -- safety: cap magnitude
  require_approval boolean default true,
  rollback_on_oom boolean default true,
  window_cron text,                                          -- only apply in maintenance windows
  created_at timestamptz not null default now()
);
```
All future-scope tables follow the same `tenant_id` + RLS pattern. `change_request` reuses the
existing `recommendation`/`optimization_plan`/`patch` structures, so v1's recommend-only patches
become write-back candidates **without a schema migration** — only new rows.

---

## 17. ERD overview (textual)

```
tenant ─┬─< membership >─ app_user
        ├─< sso_connection
        ├─< api_key
        └─< cluster ─┬─< agent_credential
                     ├─< ingestion_snapshot
                     ├─< node ───────────< usage_metric_node (TSDB)
                     ├─< workload ─┬─< container_spec
                     │             ├─< workload_revision   (feedback loop)
                     │             ├─< scheduling_constraint
                     │             ├─< autoscaler
                     │             └─< usage_metric_workload (TSDB) + stability_event (TSDB)
                     ├─< pod_disruption_budget / pvc / k8s_service
                     ├─< optimization_plan ─< recommendation ─┬─< recommendation_patch
                     │                                        └─< recommendation_outcome
                     ├─< cost_rollup           pricing_catalog / storage_catalog / billing_import
                     ├─< report
                     └─< audit_log

FUTURE: ml_model · budget/cost_forecast/alert_rule/alert_event · incident ·
        chat_session/chat_message · change_request/approval/automation_policy
```

---

## 18. Why this schema holds up over time
- **Isolation is structural** (tenant_id + RLS + FORCE, on relational *and* time-series) — not a
  coding convention that one missing `WHERE` can break.
- **Savings can't be double-counted** — the number lives on `optimization_plan`; recs only contribute.
- **Memory safety survives aggregation** — MAX is preserved through continuous aggregates.
- **The accuracy KPI is backed by tables** — `workload_revision` + `recommendation_outcome` make
  "applied" detectable and prediction-vs-actual measurable.
- **Every future-scope feature already has a home** — ML, forecasting, budgets/alerts, RCA, chat,
  and approval-gated write-back attach via stable FKs, so v1 rows never need rewriting.
```
