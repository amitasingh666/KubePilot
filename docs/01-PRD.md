# KubePilot — Product Requirements Document (PRD)

**Version:** 1.1
**Author:** Amita Singh
**Last updated:** 2026-06-29
**Status:** Draft for review

---

## 1. Document Control

| Field | Value |
|---|---|
| Product name | KubePilot |
| Category | Kubernetes Cost Optimization Platform (FinOps) |
| Delivery model | SaaS, multi-tenant |
| Primary tech stack | Node.js / TypeScript |
| Metrics source | Customer's existing Prometheus (reuse) |

---

## 2. Overview

KubePilot is a multi-tenant SaaS platform that continuously analyzes Kubernetes
cluster resource usage and produces **actionable, cost-saving recommendations**.
Where existing tools (Prometheus, Grafana) show *what is happening*, KubePilot
tells engineers *what to do about it* and *how much money it saves*.

Customers install a lightweight agent (via Helm chart) in their cluster. The
agent reads their existing Prometheus metrics plus the Kubernetes API and pushes
summarized data to the hosted KubePilot backend over a secure, outbound-only
channel. KubePilot analyzes the data and surfaces recommendations in a dashboard.

---

## 3. Problem Statement

Kubernetes gives teams scalability and flexibility but is hard to optimize. To
avoid outages, developers over-allocate CPU and memory. Over time this causes:

- Over-provisioned Pods
- Underutilized Nodes
- Unused Kubernetes resources
- High cloud infrastructure costs
- Heavy, manual monitoring and optimization effort

Monitoring tools provide metrics but **no prescriptive action**. As clusters grow
to hundreds of services, manual utilization analysis becomes slow and error-prone.

---

## 4. Goals & Objectives

| # | Objective | Why it matters |
|---|---|---|
| O1 | Reduce cloud infrastructure cost | Direct, measurable business value |
| O2 | Improve CPU/memory utilization | Higher efficiency per dollar |
| O3 | Minimize manual analysis by DevOps | Frees engineering time |
| O4 | Provide data-driven recommendations | Removes guesswork & experience dependency |
| O5 | Give org-wide cost visibility | Enables FinOps & accountability |

### Non-Goals (v1)
- Automatic, unattended application of changes (deferred to future scope; v1 is **recommend-only**).
- Building a replacement for Prometheus/Grafana (we consume, not replace).
- Supporting non-Kubernetes workloads (VMs, serverless).
- AI/ML-based forecasting (future scope).

---

## 5. Target Users & Personas

| Persona | Primary need from KubePilot |
|---|---|
| DevOps Engineer | Concrete rightsizing actions, safe-to-apply suggestions |
| Platform Engineer | Cluster-wide efficiency, idle node detection |
| Cloud Architect | Capacity & cost-model insight across clusters |
| Engineering Manager | Utilization & savings trends per team/namespace |
| FinOps Team | Cost attribution and savings reporting |

---

## 6. Key Features (v1 Scope)

### 6.1 Cluster Integration
- Connect a cluster via a Helm chart in **< 10 minutes**.
- Secure, **outbound-only** communication (no inbound ports opened in customer cluster).
- Per-cluster credentials; one tenant may connect many clusters.

### 6.2 Metrics Collection (via Prometheus reuse)
Collect and summarize:
- CPU usage (actual vs requests/limits)
- Memory usage (actual vs requests/limits)
- Pods (count, restarts, status)
- Nodes (capacity, allocatable, utilization)
- Deployments / workloads (replicas, specs)
- Resource Requests & Limits

### 6.3 Recommendation Engine
Generate recommendations for:
- **CPU optimization** — rightsizing requests/limits from observed percentiles.
- **Memory optimization** — rightsizing from observed percentiles + headroom.
- **Replica optimization** — scale-down for low-utilization deployments.
- **Idle node detection** — nodes safe to drain/remove.
- **Unused resource cleanup** — orphaned PVCs, zero-traffic services, stale workloads.

Each recommendation includes: current state, proposed state, confidence, estimated
monthly savings, and a generated `kubectl`/YAML patch (copy-paste, recommend-only).

### 6.4 Cost Dashboard
- Current infrastructure cost (per cluster / namespace / deployment)
- Estimated monthly savings
- Resource utilization (CPU/mem, requested vs used)
- Cluster health overview
- Ranked optimization opportunities

### 6.5 Reporting
- Cost & optimization reports by **cluster**, **namespace**, **deployment**.
- Exportable (PDF/CSV) and schedulable (email digest).

---

## 7. User Flows

### 7.1 Onboarding
1. Sign up → create organization (tenant).
2. Create a cluster connection → receive Helm install command + token.
3. `helm install kubepilot-agent ...` in the target cluster.
4. Agent connects, first metrics arrive, dashboard populates within minutes.

### 7.2 Optimization (KubePilot vs manual)

**Manual (today):** Monitor metrics → analyze graphs → identify waste → estimate
savings → update resources. *Repetitive, experience-dependent.*

**With KubePilot:** Connect cluster → collect metrics → analyze historical data →
generate recommendations → estimate savings → display dashboard. *Engineers get
ready-to-use recommendations instead of interpreting raw metrics.*

---

## 8. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Tenant can register an org and invite users with roles | Must |
| FR-2 | Tenant can connect ≥1 cluster via Helm chart + token | Must |
| FR-3 | Agent reads Prometheus + K8s API and pushes summarized metrics | Must |
| FR-4 | Backend ingests, validates, and stores tenant-scoped time-series data | Must |
| FR-5 | Engine produces CPU/memory rightsizing recommendations | Must |
| FR-6 | Engine produces replica, idle-node, and cleanup recommendations | Must |
| FR-7 | Cost model converts resource deltas to monthly $ savings | Must |
| FR-8 | Dashboard shows cost, utilization, health, and ranked opportunities | Must |
| FR-9 | Reports exportable/schedulable by cluster/namespace/deployment | Should |
| FR-10 | Each recommendation provides a copy-paste patch (recommend-only) | Should |

---

## 9. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Security | Tenant data isolation; outbound-only agent; encrypted transit (TLS) & at rest; scoped per-cluster tokens; SSO/OIDC for users |
| Scalability | Support clusters with hundreds of services; thousands of workloads per tenant |
| Performance | Dashboard queries < 2s p95; recommendation refresh at least daily |
| Reliability | Ingestion resilient to agent disconnects; at-least-once delivery |
| Privacy | Collect metrics & metadata only — never application data/secrets |
| Observability | Platform self-monitoring, audit logs of recommendations viewed/applied |
| Cost accuracy | Savings estimates within a documented, defensible margin |

---

## 10. Success Criteria & Metrics

KubePilot is successful if it:
- Accurately identifies inefficient resource allocation (precision validated against manual review).
- Produces reliable recommendations engineers trust enough to apply.
- Demonstrably reduces Kubernetes infrastructure cost.
- Reduces manual optimization effort.
- Improves overall resource efficiency.

**Quantifiable KPIs (targets, tune after beta):**
- ≥ 20% identified savings on a typical unoptimized cluster.
- ≥ 50% of surfaced recommendations rated "would apply" by users.
- Onboarding (Helm install → first recommendation) in < 30 minutes.
- ≥ 90% recommendation confidence accuracy vs post-apply outcomes.

---

## 11. Assumptions & Dependencies
- Customer clusters run a reachable Prometheus (or compatible) instance.
- Customer can install a Helm chart with appropriate RBAC (read-only).
- Cloud pricing data is available per provider/region/instance type.
- v1 is **recommend-only**; no write access to customer clusters.

---

## 12. Future Scope (Post-v1)
- AI-powered optimization recommendations
- Cost forecasting & budgets/alerts
- Incident root-cause analysis
- Predictive autoscaling
- AI-powered Kubernetes assistant (chat over cluster state)
- Automatic optimization with an approval workflow (write-back)

---

## 13. Open Questions
- Which cloud providers to support for pricing at launch (AWS / GCP / Azure)?
- Minimum Prometheus retention required for reliable percentile analysis?
- Pricing/packaging model (per cluster, per node, per spend)?
- Compliance targets needed for enterprise (SOC 2, ISO 27001)?
