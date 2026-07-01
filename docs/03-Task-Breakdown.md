# KubePilot — Phased Task Breakdown

**Version:** 2.0 (revised — aligned to `02-Architecture.md` v2.0)
**Companion to:** `01-PRD.md`, `02-Architecture.md`
**Approach:** Build the data pipeline first (agent → ingestion → storage), then the
intelligence (recommendations + node-level cost), then the experience (dashboard/reports).
Each phase ends with a demoable milestone.

> **What changed in v2.0:** Security essentials (RLS, rotatable token + mTLS, signed payloads,
> PodSpec stripping) are pulled **forward** into the phases that create the relevant surface,
> not deferred to a final hardening phase. The recommendation phase now includes
> **autoscaler-awareness, peak-based memory, and constraint-aware bin-packing**; the cost phase
> is **node-level with effective pricing**; and a **confidence + outcome feedback loop** is
> first-class. New collection (constraints, autoscalers, stability signals) is in Phase 1.

---

## Phase 0 — Foundations & Setup
**Goal:** Repos, environments, and contracts in place so all later work plugs in cleanly.

- [ ] Monorepo (or multi-repo) scaffold: `agent`, `backend`, `frontend`, `helm`, `infra`.
- [ ] TypeScript baseline: lint, format, tsconfig, CI (build + test).
- [ ] Provision dev infra: Postgres + TimescaleDB extension, **two Redis instances** (queue w/ AOF + cache/sessions), object storage.
- [ ] Define the **ingestion contract v2** (snapshot JSON schema) — usage (CPU p95 / mem MAX), inventory, **scheduling constraints, autoscaler objects, PDBs, DaemonSets, stability signals, GitOps annotations**; include the **idempotency key** and **agent_version**.
- [ ] Base data model & migrations: `tenant`, `user`, `cluster` — with **Postgres Row-Level Security enabled from the first migration**.
- [ ] Secrets management & config strategy (per environment).

**Milestone:** Empty services build, deploy to dev, talk to the databases, and RLS blocks cross-tenant reads in a test.

---

## Phase 1 — Cluster Integration & Secure Metrics Pipeline
**Goal:** A real cluster connects securely and pushes metrics + topology that land in storage.

- [ ] **Agent (Helm):** chart + read-only RBAC `ServiceAccount`.
- [ ] Agent: Kubernetes API inventory collection (deployments, replicas, requests/limits, nodes w/ instance type & allocatable, pods, PVCs, services).
- [ ] Agent: collect **scheduling constraints, HPA/VPA/KEDA, PDBs, DaemonSets, OOMKill/restart signals, GitOps ownership** (per contract v2).
- [ ] Agent: **PodSpec stripping** — remove env values, container args, non-allowlisted annotations before egress (tested allowlist).
- [ ] Agent: Prometheus PromQL collection — **CPU p95 + memory MAX** over windows — with **self-throttling** and an **onboarding metric-compatibility probe**.
- [ ] Agent: **workload-level** summarization (avoid pod-cardinality blowup); push granular rollups for server-side recompute.
- [ ] Agent: scheduled push with buffering, retry/backoff, and **idempotency keys**.
- [ ] **Ingestion API:** per-cluster token **+ mTLS + payload signature** verification → resolve tenant/cluster → enqueue; **per-cluster rate limit + per-tenant fairness quota**.
- [ ] Queue + ingestion workers: **dedupe by idempotency key** → write workload usage (TSDB) + inventory/constraints/autoscalers (Postgres, RLS).
- [ ] Cluster registration flow: create connection → issue **rotatable token** → emit `helm install` command; **token rotation endpoint**.
- [ ] "Last seen / connection health" tracking per cluster.

**Milestone:** Install the Helm chart in a test cluster; sanitized inventory + usage + autoscaler/constraint data appear in storage within minutes, over a mutually-authenticated channel; cross-tenant isolation holds.

---

## Phase 2 — Recommendation Engine (safe & autoscaler-aware)
**Goal:** Turn stored data into trustworthy, prioritized, *non-destructive* recommendations.

- [ ] **Per-tenant sharded** analysis jobs (not one global cron), at least daily, with fairness.
- [ ] **Data-sufficiency gating** (min window per signal; CPU ≥7d, memory/periodicity 14–30d); mark early recs preliminary.
- [ ] **Autoscaler detection** + rule matrix (HPA/VPA/KEDA/owner-kind gates which rules run).
- [ ] CPU rightsizing rule (p95 + headroom; **no CPU-limit tightening**).
- [ ] **HPA-on-CPU coupling** handling (adjust HPA target OR re-simulate replica count before claiming savings).
- [ ] Memory rightsizing rule (**MAX + headroom, never percentile**; OOMKill guardrail; LimitRange floors).
- [ ] Replica optimization rule (sustained, **peak-aware** low utilization; PDB minimums); HPA→`minReplicas` variant.
- [ ] **Constraint-aware bin-packing simulator** (FFD) — fit checks for affinity/anti-affinity, taints, topology spread, PVC affinity, DaemonSet overhead, PDBs, GPU.
- [ ] Idle node detection rule built on the simulator (**provable evacuability only**; else "blocked by …").
- [ ] CronJob/Job + DaemonSet handling (per-run peak; not "idle").
- [ ] Unused resource cleanup rule (orphaned PVCs, zero-traffic services, stale workloads).
- [ ] **Single reconciled optimization plan** record (rightsize → re-pack → drain) to prevent double-counting.
- [ ] Recommendation records: current vs proposed, **defined confidence score**, status lifecycle, link to plan.
- [ ] **GitOps-aware patch generation** (manifest diff / PR-ready YAML for Argo/Flux; imperative `kubectl` otherwise); re-validate against latest state at view time.

**Milestone:** For a connected cluster, KubePilot lists ranked recommendations that respect autoscalers, never recommend OOM-risky memory, and only propose drains that are provably feasible.

---

## Phase 3 — Cost Engine (node-level, effective pricing)
**Goal:** Attach *defensible* dollars to every plan and aggregate cost.

- [ ] **Effective pricing catalog**: ingest actual billing (start with one cloud — AWS CUR / GCP / Azure export) + per-tenant negotiated-rate overrides; model spot/Savings-Plans/CUD/RIs. Plus a **storage (per-GB-month) catalog**.
- [ ] Current-cost computation per cluster / namespace / deployment (node-based).
- [ ] **Node-level savings** from the optimization plan: `baseline_node_cost − simulated_node_cost`; report **waste vs realized** separately.
- [ ] **Realizability labeling** (Karpenter/CA auto-realizable vs "requires manual node-pool resize"); optional Karpenter-optimal instance re-selection mode.
- [ ] Cost aggregation & rollups for dashboard queries.

**Milestone:** Each recommendation shows realized monthly savings (not request-delta fiction), labeled by realizability; cost viewable by cluster/namespace/deployment.

---

## Phase 4 — API & Dashboard
**Goal:** Users can see cost, utilization, health, and act on recommendations.

- [ ] Public API (REST/GraphQL), tenant-scoped authorization on every endpoint **backed by RLS**.
- [ ] Auth: OIDC/SSO login + RBAC roles (Owner, Admin, Viewer, FinOps).
- [ ] Frontend: onboarding/connect-cluster flow (incl. Prometheus compatibility check).
- [ ] Frontend: cost & utilization overview (**waste vs realized savings shown distinctly**).
- [ ] Frontend: cluster detail (health, nodes, workloads, autoscalers).
- [ ] Frontend: recommendations view (ranked, with confidence, realizability, and GitOps-aware patches).

**Milestone:** A user signs up, connects a cluster, and sees defensible cost + safe recommendations end-to-end in the UI.

---

## Phase 5 — Reporting & Feedback Loop
**Goal:** Shareable reports, and measurable recommendation accuracy.

- [ ] Report generation by cluster / namespace / deployment.
- [ ] Export to PDF/CSV (stored in object storage).
- [ ] Scheduled email digests.
- [ ] **Outcome feedback loop:** diff later inventory snapshots to infer applied recs; compare predicted vs actual usage/cost; surface accuracy (makes the ≥90% KPI measurable).

**Milestone:** Users generate/export/schedule reports; KubePilot reports its own recommendation accuracy.

---

## Phase 6 — Hardening & Launch Readiness
**Goal:** Production-grade scale and reliability (security essentials already shipped earlier).

- [ ] Multi-tenant isolation **regression** tests (RLS on relational **and** time-series paths).
- [ ] Token-rotation + mTLS **operational** drills (rotation at scale, revocation).
- [ ] Encryption at rest verified across all stores; full audit logging.
- [ ] Load/scale testing (hundreds of services, many clusters; cardinality stress → ClickHouse decision).
- [ ] Ingestion resilience testing (agent disconnect/replay; idempotency under duplication).
- [ ] Data-residency / region-pinning validation.
- [ ] Platform self-observability (metrics, logs, traces, alerts).
- [ ] Beta validation: compare recommendations against manual review; tune thresholds, headroom, and KPIs.

**Milestone:** KubePilot meets the PRD's non-functional requirements and is ready for beta/GA.

---

## Future Scope (tracked, not in v1)
AI-powered recommendations · cost forecasting · incident RCA · predictive autoscaling ·
AI Kubernetes assistant · **automatic optimization with approval workflow (write-back)**.
The Phase 2 rule layer is intentionally pluggable so ML models can augment or replace rules
later; the bin-packing simulator and feedback loop become the safety + training substrate for write-back.

---

## Dependency Order (critical path)
```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5  →  Phase 6
(setup +   (secure     (safe recs  (node-level (UI/API)    (reports +  (scale +
 RLS)       pipeline)   + binpack)  cost)                   feedback)   reliability)
```
- Security essentials (RLS, token rotation, mTLS, signing, PodSpec stripping) ship **inside Phases 0–1**, not deferred.
- The **bin-packing simulator (Phase 2)** is a hard dependency for both idle-node recs and node-level savings (Phase 3) — build it before either.
- Phase 3 (cost) can begin once the optimization-plan record exists (late Phase 2).
- Frontend scaffolding (early Phase 4) can start during Phase 2 against mock data.
```
