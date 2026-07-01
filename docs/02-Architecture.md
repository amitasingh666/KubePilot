# KubePilot — System Architecture

**Version:** 2.0 (revised)
**Companion to:** `01-PRD.md`
**Stack decisions:** SaaS multi-tenant · Node.js/TypeScript · reuse customer Prometheus

> **What changed in v2.0:** This revision resolves the critical correctness, safety, and
> security issues found in the v1.0 review. The headline changes are: (1) savings are now
> modeled at the **node layer** via bin-packing simulation, not per-pod request deltas;
> (2) recommendations are **autoscaler-aware** (HPA/VPA/KEDA) and memory is sized from
> **peak + headroom**, never a mid-percentile; (3) drain feasibility is a **constraint-aware
> proof**; (4) tenant isolation (RLS), agent token rotation, mTLS, and PodSpec stripping are
> **v1 requirements, not later hardening**; (5) a **confidence + outcome feedback loop** makes
> the accuracy KPI measurable. Each fix is tagged `[FIX]` next to the relevant section.

---

## 1. Architecture Goals
- **Secure by default:** agent is outbound-only; KubePilot never gets inbound/write access to customer clusters in v1.
- **Multi-tenant isolation:** every record scoped by `tenant_id`; enforced by Postgres **Row-Level Security (RLS)**, not app-layer filtering alone.
- **Low customer footprint:** reuse existing Prometheus; ship a thin agent that throttles its own query load.
- **Scalable ingestion & analysis:** handle hundreds of services per cluster, many clusters per tenant.
- **Recommend-only, but truthful:** v1 produces patches it never applies — and only claims dollar savings it can defend at the node layer.

---

## 2. High-Level Diagram

```
   CUSTOMER CLUSTER (per connection)            KUBEPILOT SAAS (multi-tenant)
 ┌───────────────────────────────────┐       ┌────────────────────────────────────────────┐
 │  ┌─────────────┐   ┌─────────────┐ │       │  ┌───────────────┐                          │
 │  │ Prometheus  │   │  K8s API    │ │       │  │ Ingestion API │  (token + mTLS, signed)  │
 │  └──────┬──────┘   └──────┬──────┘ │       │  └───────┬───────┘                          │
 │   PromQL│ (throttled)     │ list   │       │          │ enqueue (idempotency key)        │
 │      ┌──┴─────────────────┴──┐     │ HTTPS │      ┌───┴────┐                              │
 │      │   KubePilot Agent     │─────┼──────▶│      │ Queue  │ (Redis/BullMQ, AOF, queue-   │
 │      │ (Helm, outbound-only, │     │ push  │      └───┬────┘  only instance)              │
 │      │  PodSpec stripping)   │     │       │          │                                  │
 │      └───────────────────────┘     │       │   ┌──────┴───────┐  ┌────────────────────┐  │
 └───────────────────────────────────┘       │   │ Ingestion    │  │ Recommendation     │  │
                                              │   │ Workers      │  │ Engine (sharded    │  │
                                              │   │ (dedupe by   │  │ per-tenant jobs)   │  │
                                              │   │  idem. key)  │  │  ├ rules           │  │
                                              │   └──────┬───────┘  │  ├ bin-pack sim    │  │
                                              │          │          │  └ autoscaler-aware│  │
                                              │   ┌──────┴──────────┴┴─────────┐         │  │
                                              │   │  Time-series DB + Postgres  │◀────────┘  │
                                              │   │  (workload-level usage)     │            │
                                              │   │  (metadata, recs, cost,RLS) │            │
                                              │   └──────┬──────────────────────┘            │
                                              │          │                                   │
                                              │   ┌──────┴───────┐   ┌────────────────────┐  │
                                              │   │  Public API  │◀──│  Cost Engine       │  │
                                              │   │ (REST/GraphQL│   │ (node-level model, │  │
                                              │   │  tenant-RLS) │   │  effective pricing)│  │
                                              │   └──────┬───────┘   └────────────────────┘  │
                                              └──────────┼───────────────────────────────────┘
                                                         │
                                                  ┌──────┴───────┐
                                                  │  Dashboard   │  (React/TS, SSO/OIDC)
                                                  └──────────────┘
```

---

## 3. Components

### 3.1 KubePilot Agent (in customer cluster)
- **Form:** Helm chart → a small Node/TS Deployment + read-only RBAC `ServiceAccount`.
- **Responsibilities:**
  - Query Prometheus (PromQL) for CPU/memory usage over time windows — **CPU as p95, memory as MAX (working set)** per window.
  - Query Kubernetes API for inventory & specs: deployments, replicas, requests/limits, nodes, pods, PVCs, services — **plus** scheduling constraints, autoscaler objects, PDBs, DaemonSets, and stability signals (see §3.1.1).
  - Push **granular workload-level rollups** (not only final percentiles) so percentile/peak math can be recomputed server-side. `[FIX: server-side flexibility]`
  - Aggregate at **workload level, not pod level**, to avoid cardinality explosion from ephemeral pods. `[FIX: cardinality]`
- **Prometheus safety:** self-throttle PromQL (concurrency + range caps); run a **metric-compatibility probe** at onboarding to detect the Prometheus flavor and required series. Never degrade the customer's production Prometheus. `[FIX: Prometheus reuse fragility]`
- **Security & privacy:** outbound HTTPS only; per-cluster bearer token **+ mTLS** (v1, not optional); request bodies are **signed** to prevent tampering/replay. The agent **strips env var values, container args, and non-allowlisted annotations** from PodSpecs before egress so secrets/PII never leave the cluster. Collects metrics/metadata only. `[FIX: token integrity + "never secrets" enforceability]`
- **Resilience:** local buffer + retry/backoff on disconnect; every snapshot carries an **idempotency key** `(cluster_id, target, window_start, window_end, agent_version)` for safe at-least-once delivery. `[FIX: duplicate/double-count]`

#### 3.1.1 Data the agent collects (ingestion contract, v2)
The recommendation/cost engines need more than raw usage. The contract includes:
1. **Usage:** CPU **p95** + memory **MAX** per window, as granular workload rollups.
2. **Inventory & specs:** deployments, statefulsets, daemonsets, cronjobs/jobs, replicas, requests/limits, services, PVCs, QoS class, priorityClass.
3. **Node facts:** instance type, node-group/pool, spot-vs-on-demand, capacity, **allocatable** (capacity − kube/system-reserved), taints, labels.
4. **Scheduling constraints (per pod):** nodeSelector, required/preferred affinity & anti-affinity, tolerations, topology spread, PVC node-affinity/local-storage.
5. **Autoscalers:** HPA (`autoscaling/v2`), VPA (CRD if present, with `updateMode`), KEDA `ScaledObject`.
6. **Stability & safety:** PodDisruptionBudgets; OOMKill/restart reasons (`kube-state-metrics`, `lastState.terminated`); GitOps ownership annotations (ArgoCD/Flux).

### 3.2 Ingestion API
- Authenticates the cluster token **+ mTLS** and verifies the payload **signature**; resolves `tenant_id` + `cluster_id`.
- Validates payload schema; **rate-limits per cluster** and enforces per-tenant fairness quotas so one tenant can't starve ingestion. `[FIX: noisy tenant]`
- Enqueues raw snapshots with their idempotency key (fast ack, async processing).

### 3.3 Queue + Ingestion Workers
- **Queue:** Redis + BullMQ on a **dedicated, AOF-persisted Redis instance** — separate from cache/sessions to bound blast radius and guarantee at-least-once durability. `[FIX: Redis triple-duty]`
- **Workers:** normalize snapshots, **dedupe by idempotency key**, write workload-level usage to the time-series store and inventory/spec/autoscaler/constraint data to Postgres. Maintain "latest known state" per workload.

### 3.4 Data Stores
| Store | Purpose | Candidate |
|---|---|---|
| Time-series DB | Workload-level usage metrics (CPU p95 / mem MAX over time) | TimescaleDB (Postgres ext.); ClickHouse if cardinality demands |
| Relational DB | Tenants, users, clusters, workloads, autoscalers, constraints, recommendations, plans, cost configs, audit | PostgreSQL (**RLS enforced**) |
| Object storage | Generated reports (PDF/CSV) | S3-compatible |
| Cache / Sessions | Dashboard query cache, sessions | Redis (separate instance from the queue) |

> **Cardinality note:** usage is aggregated to **workload** granularity, never per ephemeral
> pod, to keep series count bounded. TimescaleDB is the v1 default; migrate the usage path to
> ClickHouse if per-tenant series counts exceed Timescale's comfortable range. `[FIX: cardinality]`

### 3.5 Recommendation Engine `[FIX: CRIT-3, CRIT-4, CRIT-5, periodicity, cold-start]`
- **Scheduling:** per-tenant **sharded** jobs (not one global cron), at least daily, with fairness so large tenants don't block others. `[FIX: cron SPOF/bottleneck]`
- **Data-sufficiency gate:** a workload needs a minimum history window before *trustworthy* recs (e.g. 7+ days for CPU; 14–30 days for memory & periodicity). Earlier recs are flagged **preliminary / low-confidence**. Resolves the "first rec < 30 min" vs percentile-window tension by labeling, not by pretending. `[FIX: cold-start]`
- **Autoscaler detection (runs first):** build `managedBy[workload]` from HPA/VPA/KEDA/owner-kind, then gate each rule:

  | Workload | Replica rec | Request rec | Notes |
  |---|---|---|---|
  | Bare Deployment | ✅ lower replicas if sustained low util | ✅ rightsize | static capacity unless autoscaler reclaims |
  | **HPA-managed** | ❌ no fixed replicas → ✅ lower `minReplicas` | ✅ rightsize **+ adjust HPA target** (see below) | HPA owns replicas |
  | **VPA Auto/Recreate** | ✅ | ❌ skip (VPA owns requests) | don't fight VPA |
  | **VPA Off/Initial** | ✅ | ✅ rightsize | VPA only recommends |
  | **KEDA** | ❌ skip | ✅ rightsize | replicas external-metric driven |
  | **DaemonSet** | ❌ n/a | ✅ rightsize (savings × node count) | per-node overhead |
  | **CronJob/Job** | ❌ not "idle" | ✅ size from per-run peak | idle 23h/day ≠ waste |

- **Rules (v1, deterministic):**
  - **CPU rightsizing:** `cpu_req' = p95_cpu × (1 + headroom)`. Do **not** recommend tightening CPU *limits* (throttling); optionally suggest removing an over-tight limit. `[FIX: CPU limits]`
  - **HPA-on-CPU coupling:** lowering a request raises utilization% → HPA scales *up*, erasing savings. So either (a) lower the HPA `averageUtilization` target proportionally, or (b) re-simulate the post-change replica count and fold it into the savings calc before claiming any saving. Never change requests on an HPA-CPU workload without (a) or (b). `[FIX: CRIT-4 coupling]`
  - **Memory rightsizing:** `mem_req' = MAX_workingset × (1 + headroom)` over a 14–30 day window — **peak, never p95/p99** (memory is non-compressible → under-sizing = OOMKill). Guardrail: if any OOMKill occurred in the window, **raise, never lower**; respect LimitRange minimums; lower confidence on high variance/recent restarts. `[FIX: CRIT-3]`
  - **Replica optimization:** require *sustained, peak-aware* low utilization (don't cut below weekly/monthly peaks); respect PDB minimums.
  - **Idle node detection:** a node is a drain candidate **only if proven evacuable** by the constraint-aware bin-packing simulator (§3.5.1) — not "sum of requests fits." `[FIX: CRIT-5]`
  - **Unused cleanup:** orphaned PVCs, zero-traffic services, stale/never-scaled workloads (PVC savings priced against the **storage** catalog, see §3.6).
- **Output:** every rec links to a single reconciled **optimization plan** (§3.5.1) and includes current vs proposed, **defined confidence** (§3.5.2), node-level $ savings, and a **GitOps-aware** patch (§3.5.3).

#### 3.5.1 Optimization plan = one reconciled plan (no double-counting) `[FIX: CRIT-2]`
Savings are computed once, on a single plan, in order — never as the sum of independent rules:
```
1. RIGHTSIZE each eligible pod (CPU p95+headroom; mem MAX+headroom; skip per autoscaler matrix)
2. RE-PACK all pods (with new requests) onto the minimum node set via constraint-aware
   bin-packing (First-Fit-Decreasing v1), reserving per-node DaemonSet requests, packing
   against allocatable, leaving an 80–85% scheduling buffer.
3. DRAIN = baseline nodes unused in the packed plan AND provably evacuable.
4. (savings priced by Cost Engine, §3.6)
```
**Constraint-aware feasibility:** a pod may only move to a node satisfying CPU+mem fit,
nodeSelector/affinity, anti-affinity, taints/tolerations, topology spread, PVC node-affinity,
PDBs, and special resources (GPU). If a drain can't be proven feasible, surface it as
**"blocked by PDB / anti-affinity / PVC"** instead of recommending it.

#### 3.5.2 Confidence score (defined) `[FIX: CRIT-6 definition]`
Confidence is a function of: **data sufficiency** (window vs required), **variance/periodicity**,
**stability history** (recent OOMKills/restarts lower memory confidence), **headroom margin**
(distance from observed peak), and **autoscaler realizability** (automatic via CA/Karpenter vs
requires-manual-node-resize).

#### 3.5.3 GitOps-aware patches `[FIX: stale + GitOps revert]`
- Detect GitOps ownership (ArgoCD/Flux annotations/owner refs). For GitOps workloads emit a
  **manifest diff / PR-ready YAML** keyed to the source path — **not** an imperative
  `kubectl patch` (which Argo/Flux would revert and alarm on).
- Re-validate every patch against the **latest** workload state at view time so stale
  point-in-time patches aren't applied blindly.

### 3.6 Cost Engine `[FIX: CRIT-1, MAJ-2, MAJ-3]`
- **Node-level savings, not request deltas.** You bill for nodes, so a dollar is only saved
  when a node is removed. The engine reports **two distinct numbers**:
  - **Waste / efficiency gap** = `Σ(request − usage)` — informational leading indicator.
  - **Realized savings** = `baseline_node_cost − simulated_node_cost` from the §3.5.1 packed
    plan — the dollar headline.
- **Effective pricing, not list price.** Support ingestion of actual billing
  (AWS CUR / GCP billing export / Azure cost export) and per-tenant negotiated-rate overrides,
  accounting for **spot/preemptible, Savings Plans / CUD / RIs, and enterprise discounts**.
  Clearly separate "list-price estimate" from "effective-rate estimate."
- **Realizability labeling:** Karpenter/Cluster-Autoscaler → savings auto-realizable (Karpenter
  mode may re-provision cheaper instance types); **no autoscaler → "requires manual node-pool
  resize," lower confidence.** Never count manual-only savings as automatic.
- **Storage & non-compute:** PVC-cleanup savings priced against a **per-GB-month storage
  catalog**. Load balancers, egress, and control-plane fees are flagged **out-of-model in v1**
  so totals aren't silently wrong.
- Aggregates cost by cluster / namespace / deployment.

### 3.7 Public API
- REST (or GraphQL) for the dashboard: clusters, utilization, recommendations, plans, cost, reports.
- **Tenant-scoped authorization on every query, backed by Postgres RLS** (defense-in-depth, not just app-layer `WHERE`). `[FIX: MAJ-6]`

### 3.8 Dashboard (Frontend)
- React + TypeScript SPA.
- Views: overview/cost (waste vs realized savings shown separately), cluster detail,
  recommendations (ranked, with confidence + GitOps-aware patches), reports.
- Auth via SSO/OIDC; role-based access (Owner, Admin, Viewer, FinOps).

---

## 4. Multi-Tenancy & Security Model `[FIX: MAJ-6, MAJ-7, MAJ-8]`
- **Isolation:** `tenant_id` on every row, enforced by **Postgres Row-Level Security (v1, mandatory)** plus app-layer scoping. Isolation also enforced on the **time-series path** (Timescale/ClickHouse), which is easy to forget. Cluster tokens map to exactly one tenant. Cross-tenant isolation tests are part of v1, not just hardening.
- **Agent auth (v1):** per-cluster opaque token (**rotatable from day one**) **+ mTLS** + **signed payloads** (replay/tamper protection). Tokens are treated as secrets in Helm values (documented secure handling); rotation endpoint shipped in Phase 1.
- **User auth:** OIDC/SSO; RBAC roles.
- **Data minimization (enforced):** agent strips env values, container args, and non-allowlisted annotations from PodSpecs before egress; only metrics + sanitized metadata leave the cluster.
- **Audit:** log recommendation views/exports, plan generation, and config changes.
- **Encryption:** TLS in transit; encryption at rest for all stores.
- **Data residency:** region-pinned tenant data option for GDPR/enterprise (EU customers' infra data stays in-region). `[FIX: MIN-8]`

---

## 5. Key Data Entities (relational)
- `tenant` (org)
- `user` (belongs to tenant, role)
- `cluster` (tenant_id, name, token_hash, mtls_fingerprint, status, last_seen)
- `node` (cluster_id, instance_type, node_group, spot, capacity, allocatable, taints, labels)
- `workload` / `pod` inventory (cluster_id, specs, requests/limits, qos, priority_class)
- `scheduling_constraint` (workload_id: nodeSelector, affinity, tolerations, topology_spread, pvc_affinity)
- `autoscaler` (workload_id, kind HPA|VPA|KEDA, min/max, metric/target, update_mode)
- `pdb`, `daemonset` overhead
- `usage_metric` (time-series: **workload**/node, cpu_p95, mem_max, ts) — in TSDB
- `optimization_plan` (cluster_id, baseline_node_cost, simulated_node_cost, realized_savings, status)
- `recommendation` (plan_id, cluster_id, type, target, current, proposed, confidence, est_savings, patch, patch_mode imperative|gitops, status)
- `pricing_catalog` / `cost_config` (effective rates, billing-import source) · `storage_catalog`
- `recommendation_outcome` (rec_id, detected_applied_at, predicted_vs_actual) — feedback loop
- `report` · `audit_log`

---

## 6. Data Flow (end to end)
1. Agent collects Prometheus usage (CPU p95 / mem MAX) + K8s inventory + constraints + autoscalers → strips secrets → summarizes (workload-level) → pushes signed snapshot with idempotency key.
2. Ingestion API authenticates (token + mTLS + signature) → rate-limits → enqueues.
3. Workers dedupe by idempotency key → write workload usage to TSDB, inventory/constraints/autoscalers to Postgres (RLS).
4. Recommendation Engine (sharded per tenant) gates on data sufficiency → detects autoscalers → applies rules → builds a single reconciled **optimization plan** via constraint-aware bin-packing.
5. Cost Engine prices the plan at the **node layer** with effective rates → emits waste vs realized savings.
6. Dashboard reads via Public API (RLS); users review recs, confidence, and GitOps-aware patches.
7. **Feedback loop:** later inventory snapshots are diffed to infer applied recs; predicted vs actual usage/cost is scored to measure accuracy (closes the KPI). `[FIX: CRIT-6]`

---

## 7. Deployment & Ops (SaaS)
- Backend services containerized; run on KubePilot's own Kubernetes (Helm/Kustomize).
- Managed Postgres/Timescale + **two managed Redis instances** (queue vs cache/sessions).
- CI/CD with environment promotion (dev → staging → prod).
- Platform self-observability (metrics, logs, traces, alerting).
- Agent chart published to a Helm repo; **versioned**, with the ingestion contract supporting **multiple concurrent agent versions** (agents are customer-upgraded on their own schedule). `[FIX: fleet versioning]`

---

## 8. Technology Choices (summary)
| Layer | Choice |
|---|---|
| Agent | Node/TS, Helm chart, read-only RBAC, PodSpec stripping, PromQL throttling |
| Backend services | Node/TS (NestJS or Fastify) |
| Queue | Redis + BullMQ (dedicated AOF instance) |
| Time-series | TimescaleDB (workload-level); ClickHouse if cardinality demands |
| Relational | PostgreSQL + Row-Level Security |
| Object store | S3-compatible |
| Frontend | React + TypeScript |
| Auth | OIDC/SSO + per-cluster token (rotatable) + mTLS + signed payloads |
| Pricing | Effective rates via billing import (CUR/GCP/Azure) + negotiated overrides; storage catalog |
| Infra | Kubernetes, Helm, CI/CD |

---

## 9. Key Risks & Mitigations
| Risk | Mitigation |
|---|---|
| **Savings overstated (request≠dollars)** | Node-level bin-pack simulation; report waste vs realized separately; realizability labeling `[FIX: CRIT-1]` |
| **Double-counted savings** | Single reconciled optimization plan owns one savings number `[FIX: CRIT-2]` |
| **Memory under-sizing → OOMKill** | Peak+headroom (not percentile); OOMKill guardrail `[FIX: CRIT-3]` |
| **Recs fight autoscalers** | HPA/VPA/KEDA detection + rule matrix + HPA-coupling math `[FIX: CRIT-4]` |
| **Undrainable nodes recommended** | Constraint-aware feasibility proof `[FIX: CRIT-5]` |
| **Accuracy KPI unmeasurable** | Defined confidence + snapshot-diff outcome feedback loop `[FIX: CRIT-6]` |
| **List price ≠ real bill** | Effective-rate billing import + negotiated overrides `[FIX: MAJ-2]` |
| **GitOps reverts patches** | GitOps-aware manifest-diff output `[FIX: MAJ-5]` |
| **Tenant data leakage** | Postgres RLS (incl. TSDB path) + isolation tests in v1 `[FIX: MAJ-6]` |
| **Token leak / metric poisoning** | Rotatable token + mTLS + signed payloads in v1 `[FIX: MAJ-7]` |
| **Secrets leave cluster** | Agent strips env/args/annotations; tested allowlist `[FIX: MAJ-8]` |
| **Cardinality blowup** | Workload-level aggregation; ClickHouse fallback `[FIX: MIN-3]` |
| **Prometheus overload / incompat** | PromQL throttling + onboarding compatibility probe `[FIX: MIN-4]` |
| Customer lacks Prometheus | Document prereq; future bundled collector fallback |
| Recommendation distrust | Transparent inputs, defined confidence, recommend-only, data-sufficiency gating |
</content>
